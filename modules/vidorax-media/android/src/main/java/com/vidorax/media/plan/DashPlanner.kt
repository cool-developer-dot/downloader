package com.vidorax.media.plan

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.dash.manifest.DashManifest
import androidx.media3.exoplayer.dash.manifest.DashManifestParser
import androidx.media3.exoplayer.dash.manifest.Representation
import com.vidorax.media.model.ProbeAudioTrack
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.ProbeVariant
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SourceKind
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRefusedException
import com.vidorax.media.net.MediaRequest
import java.io.ByteArrayInputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The downloadable part of a DASH manifest: one representation whose single file already is the whole video —
 * audio and video muxed together, or video in a manifest that carries no audio at all.
 */
internal data class DashPlan(
  /** The MPD URL after redirects. */
  val manifestUrl: String,
  /** The chosen representation's one file, resolved against the manifest's BaseURLs (signed queries intact). */
  val mediaUrl: String,
  val selected: ProbeVariant,
  /** Every downloadable representation, best first. */
  val variants: List<ProbeVariant>,
  /** The chosen representation's own audio, when its codecs declare one. */
  val audio: ProbeAudioTrack?,
  val durationMs: Long?,
)

internal sealed interface DashPlanResult {
  data class Ready(val plan: DashPlan) : DashPlanResult

  data class Refused(val failure: ProbeResult.Failure) : DashPlanResult
}

/** `ContentProtection` in the manifest text, namespaced or not. */
internal object DashProtection {
  private val ELEMENT = Regex("""<(?:[A-Za-z_][\w.-]*:)?ContentProtection\b""")

  fun declares(manifest: String): Boolean = ELEMENT.containsMatchIn(manifest)
}

/**
 * Classifies a DASH manifest against what the engine can finish without muxing: the answer is one representation
 * that is a single complete file (a `BaseURL`, optionally with `SegmentBase`), or a truthful refusal.
 *
 *     MPD URL → fetch (session context, redirects checked) → ContentProtection? → Media3 DashManifestParser
 *       → live? multi-period? → video adaptation sets → single-file representations that carry their own audio
 *         (or a manifest with no audio at all) → select the exact representation
 *
 * Parsing is Media3's; this class only decides. It never downloads media: the chosen file's bytes are classified
 * by [Probe] like any progressive file, which also catches DRM boxes and audio-only files a manifest mislabels.
 * Refusals: `ContentProtection`/DRM data → DRM_PROTECTED; `type="dynamic"` → LIVE_UNSUPPORTED; separate audio and
 * video, segmented representations (SegmentTemplate/SegmentList), several periods, audio only → UNSUPPORTED_FORMAT;
 * HTTP/transport failures keep their transient classification.
 */
@OptIn(UnstableApi::class)
internal class DashPlanner(
  private val http: HttpClient,
  private val decoders: DecoderSupport = DecoderSupport.ASSUME_ALL,
) {
  suspend fun plan(url: String, context: RequestContext, choice: VariantChoice?): DashPlanResult =
    withContext(Dispatchers.IO) { planBlocking(url, context, choice) }

  private fun planBlocking(url: String, context: RequestContext, choice: VariantChoice?): DashPlanResult {
    if (Probe.isPolicyBlockedHost(url)) return refuse(ProbeFailure.POLICY_BLOCKED, "This source is not supported")
    val fetched = when (val result = fetchManifest(url, context)) {
      is Fetched.Failed -> return DashPlanResult.Refused(result.failure)
      is Fetched.Ok -> result
    }
    return classify(fetched.finalUrl, fetched.manifest, choice)
  }

  // --- classification ---

  private fun classify(manifestUrl: String, manifest: DashManifest, choice: VariantChoice?): DashPlanResult {
    if (manifest.dynamic) return refuse(ProbeFailure.LIVE_UNSUPPORTED, "live DASH stream")
    if (manifest.periodCount == 0) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "DASH manifest has no periods")
    if (manifest.periodCount > 1) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, MULTI_PERIOD)

    val sets = manifest.getPeriod(0).adaptationSets
    // The text scan normally refuses first; parsed DRM data is protection too.
    if (sets.any { set -> set.representations.any { it.format.drmInitData != null } }) {
      return refuse(ProbeFailure.DRM_PROTECTED, "DRM-protected DASH")
    }
    val separateAudio = sets.any { it.type == C.TRACK_TYPE_AUDIO }
    val videoSets = sets.filter { it.type == C.TRACK_TYPE_VIDEO }
    if (videoSets.isEmpty()) {
      return refuse(ProbeFailure.UNSUPPORTED_FORMAT, if (separateAudio) "audio-only DASH stream" else "DASH manifest has no video")
    }

    val durationUs = manifest.getPeriodDurationUs(0).takeIf { it != C.TIME_UNSET && it > 0 }
    val candidates = videoSets.flatMapIndexed { setIndex, set ->
      set.representations.mapIndexed { repIndex, rep ->
        Candidate(rep.format.id ?: "rep-$setIndex-$repIndex", rep, separateAudio).also {
          it.decodable = decoders.canDecode(it.format.codecs, it.width, it.height)
        }
      }
    }
    if (candidates.isEmpty()) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "DASH manifest lists no video representations")

    // The quality the user picked is downloaded exactly, or refused with the reason — never swapped for another.
    choice?.videoId?.let { wanted ->
      val match = candidates.firstOrNull { it.id == wanted }
      if (match != null && !match.eligible) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, whyNothingEligible(listOf(match)))
    }
    val selected = select(candidates, choice)
      ?: return refuse(ProbeFailure.UNSUPPORTED_FORMAT, whyNothingEligible(candidates))
    val mediaUrl = selected.mediaUrl
      ?: return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "unusable representation URL")
    if (Probe.isPolicyBlockedHost(mediaUrl)) return refuse(ProbeFailure.POLICY_BLOCKED, "This source is not supported")
    // A public manifest must not point the downloader at the user's own network.
    if (!http.allows(mediaUrl)) return refuse(ProbeFailure.POLICY_BLOCKED, "representation on a non-public address")

    val variants = candidates.filter { it.eligible }.sortedWith(BEST_FIRST).map { it.toProbeVariant(durationUs) }
    return DashPlanResult.Ready(
      DashPlan(
        manifestUrl = manifestUrl,
        mediaUrl = mediaUrl,
        selected = selected.toProbeVariant(durationUs),
        variants = variants,
        audio = selected.audioTrack(),
        durationMs = durationUs?.let { it / 1000 },
      ),
    )
  }

  private class Candidate(val id: String, val representation: Representation, private val separateAudio: Boolean) {
    val format: Format get() = representation.format
    val singleFile: Boolean get() = representation is Representation.SingleSegmentRepresentation

    /** The representation's one file; only http(s) is usable. */
    val mediaUrl: String?
      get() = (representation as? Representation.SingleSegmentRepresentation)?.uri?.toString()
        ?.takeIf { it.startsWith("https://", ignoreCase = true) || it.startsWith("http://", ignoreCase = true) }

    /** The representation's own codecs name an audio codec: its file carries the sound. */
    val muxedAudio: Boolean get() = MimeTypes.getAudioMediaMimeType(format.codecs) != null

    val height: Int? get() = format.height.takeIf { it != Format.NO_VALUE && it > 0 }
    val width: Int? get() = format.width.takeIf { it != Format.NO_VALUE && it > 0 }
    val bitrate: Long?
      get() = listOf(format.averageBitrate, format.bitrate, format.peakBitrate)
        .firstOrNull { it != Format.NO_VALUE && it > 0 }?.toLong()
    val peakBitrate: Long?
      get() = listOf(format.peakBitrate, format.bitrate, format.averageBitrate)
        .firstOrNull { it != Format.NO_VALUE && it > 0 }?.toLong()
    var decodable: Boolean = true

    /** Saving a video-only file while the stream's sound lives in another adaptation set would need muxing. */
    val needsAudioMux: Boolean get() = separateAudio && !muxedAudio
    val eligible: Boolean get() = singleFile && !needsAudioMux && decodable

    fun toProbeVariant(durationUs: Long?): ProbeVariant = ProbeVariant(
      id = id,
      width = width,
      height = height,
      bitrate = peakBitrate,
      frameRate = format.frameRate.takeIf { it > 0f }?.toDouble(),
      videoCodec = HlsCodecs.videoTokens(format.codecs).joinToString(",").ifBlank { null },
      needsAudioMux = needsAudioMux,
      estimatedBytes = bitrate?.let { bits -> durationUs?.let { HlsPlanner.estimateBytes(bits, it) } },
      decodable = decodable,
    )

    fun audioTrack(): ProbeAudioTrack? {
      if (!muxedAudio) return null
      val codec = HlsCodecs.tokens(format.codecs).firstOrNull { MimeTypes.getAudioMediaMimeType(it) != null }
      return ProbeAudioTrack(
        id = "$id:audio",
        language = format.language,
        label = null,
        bitrate = null,
        codec = codec,
        isDefault = true,
      )
    }
  }

  private fun select(candidates: List<Candidate>, choice: VariantChoice?): Candidate? {
    val eligible = candidates.filter { it.eligible }
    if (eligible.isEmpty()) return null
    choice?.videoId?.let { wanted -> eligible.firstOrNull { it.id == wanted }?.let { return it } }
    val maxHeight = choice?.maxHeight
    if (maxHeight != null) {
      val fitting = eligible.filter { (it.height ?: 0) <= maxHeight }
      if (fitting.isNotEmpty()) return fitting.sortedWith(BEST_FIRST).first()
      return eligible.minWithOrNull(compareBy<Candidate> { it.height ?: Int.MAX_VALUE }.thenBy { it.bitrate ?: 0L })
    }
    return eligible.sortedWith(BEST_FIRST).first()
  }

  private fun whyNothingEligible(candidates: List<Candidate>): String = when {
    candidates.any { it.needsAudioMux } -> SEPARATE_AUDIO
    candidates.all { !it.singleFile } -> SEGMENTED
    else -> "no representation this device can decode"
  }

  // --- fetching ---

  private sealed interface Fetched {
    class Ok(val finalUrl: String, val manifest: DashManifest) : Fetched

    class Failed(val failure: ProbeResult.Failure) : Fetched
  }

  private fun fetchManifest(url: String, context: RequestContext): Fetched {
    val response = try {
      http.execute(MediaRequest(url = url, context = context))
    } catch (e: MediaRefusedException) {
      return Fetched.Failed(failure(e.reason, null, e.message))
    } catch (e: MediaNetworkException) {
      return Fetched.Failed(failure(ProbeFailure.NETWORK, null, "Could not reach the server"))
    }
    response.use {
      when (val status = it.status) {
        in 200..299 -> Unit
        403, 401 -> return Fetched.Failed(failure(ProbeFailure.HTTP_403, status, "Access denied"))
        404, 410 -> return Fetched.Failed(failure(ProbeFailure.HTTP_404, status, "Not found"))
        else -> return Fetched.Failed(failure(ProbeFailure.HTTP_ERROR, status, "Server error"))
      }
      val bytes = try {
        it.readBounded(MAX_MANIFEST_BYTES)
      } catch (e: java.io.IOException) {
        return Fetched.Failed(failure(ProbeFailure.NETWORK, null, "Could not read the manifest"))
      } ?: return Fetched.Failed(failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "DASH manifest is too large"))

      if (!MediaSniffer.isDashManifest(bytes)) {
        val verdict = MediaSniffer.sniff(bytes, it.contentType, it.finalUrl, bytes.size.toLong())
        val reason = (verdict as? SniffResult.Unsupported)?.reason ?: ProbeFailure.UNSUPPORTED_FORMAT
        return Fetched.Failed(failure(reason, null, "The link did not return a DASH manifest"))
      }
      // Decided from the text as well as the parse: Media3 records no DRM data for a ContentProtection element
      // without scheme data (a bare mp4protection, an unknown system), and that is still protected content.
      if (DashProtection.declares(String(bytes, Charsets.UTF_8))) {
        return Fetched.Failed(failure(ProbeFailure.DRM_PROTECTED, null, "DRM-protected DASH (ContentProtection)"))
      }
      val manifest = try {
        DashManifestParser().parse(Uri.parse(it.finalUrl), ByteArrayInputStream(bytes))
      } catch (e: Exception) {
        // ParserException and friends: a malformed manifest is a verdict on the source, not a network error.
        return Fetched.Failed(failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "malformed DASH manifest"))
      }
      return Fetched.Ok(it.finalUrl, manifest)
    }
  }

  // --- helpers ---

  private fun refuse(reason: ProbeFailure, message: String) = DashPlanResult.Refused(failure(reason, null, message))

  private fun failure(reason: ProbeFailure, status: Int?, message: String?) =
    ProbeResult.Failure(reason = reason, httpStatus = status, message = message)

  companion object {
    /** Manifests are text; a VOD MPD is a few KB. Anything much larger is not a manifest worth reading. */
    const val MAX_MANIFEST_BYTES = 4 * 1024 * 1024
    const val SEPARATE_AUDIO = "separate audio and video streams are not supported (they would need muxing)"
    const val SEGMENTED = "segmented DASH (SegmentTemplate/SegmentList) is not supported"
    const val MULTI_PERIOD = "multi-period DASH is not supported"

    private val BEST_FIRST = compareByDescending<Candidate> { it.height != null }
      .thenByDescending { it.height ?: 0 }
      .thenByDescending { it.bitrate ?: 0L }

    /** The manifest's verdict with the chosen file's own classification (size, container, resumability). */
    fun toProbeResult(plan: DashPlan, media: ProbeResult.Success): ProbeResult.Success = ProbeResult.Success(
      kind = SourceKind.DASH,
      finalUrl = plan.manifestUrl,
      contentType = "application/dash+xml",
      container = media.container,
      sizeBytes = media.sizeBytes,
      resumable = media.resumable,
      variants = plan.variants,
      audioTracks = listOfNotNull(plan.audio),
      durationMs = plan.durationMs,
    )
  }
}
