package com.vidorax.media.plan

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.dash.DashSegmentIndex
import androidx.media3.exoplayer.dash.manifest.AdaptationSet
import androidx.media3.exoplayer.dash.manifest.DashManifest
import androidx.media3.exoplayer.dash.manifest.DashManifestParser
import androidx.media3.exoplayer.dash.manifest.RangedUri
import androidx.media3.exoplayer.dash.manifest.Representation
import com.vidorax.media.model.Container
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
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Where one DASH track's bytes are: one complete file, or an init section followed by media segments. */
internal sealed interface DashTrackSource {
  /** A `BaseURL` (optionally with `SegmentBase` ranges inside it): the whole file is the track. */
  data class File(val url: String) : DashTrackSource

  /**
   * `SegmentTemplate`/`SegmentList`: the init section and every media segment, in order, as a segment plan the
   * segment transfer downloads into one file (the same plan type as an HLS media playlist).
   */
  data class Segments(val plan: HlsPlan) : DashTrackSource
}

/** One representation the download takes. */
internal data class DashTrack(
  val representationId: String,
  val source: DashTrackSource,
  /** Minus the representation's `presentationTimeOffset`: aligns its sample times with the period's timeline. */
  val timeOffsetUs: Long,
  /** The representation's container (`video/mp4`, `video/webm`, `audio/mp4`…). */
  val containerMimeType: String?,
  val codecs: String?,
)

/**
 * A downloadable DASH stream: the chosen video representation and, when the stream keeps its sound in a separate
 * adaptation set, the audio representation that goes with it.
 */
internal data class DashPlan(
  /** The MPD URL after redirects. */
  val manifestUrl: String,
  val video: DashTrack,
  /** The separate audio track to merge in; null when the video representation carries its own sound or none exists. */
  val audioTrack: DashTrack?,
  val selected: ProbeVariant,
  /** Every downloadable video representation, best first. */
  val variants: List<ProbeVariant>,
  /** The download's audio (its own or the separate track), for the quality sheet. */
  val audio: ProbeAudioTrack?,
  val durationMs: Long?,
) {
  /**
   * The one complete file that already is the whole video (audio muxed in, or no audio anywhere in the manifest):
   * downloaded and classified exactly like a progressive file. Null when the download needs segments or a merge.
   */
  val mediaUrl: String?
    get() = if (audioTrack == null) (video.source as? DashTrackSource.File)?.url else null
}

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
 * Plans a DASH download: VOD, unprotected, one period — any representation layout.
 *
 *     MPD URL → fetch (session context, redirects checked) → ContentProtection? → Media3 DashManifestParser
 *       → live? multi-period? → video representations (single file, or SegmentTemplate/SegmentList with a
 *         bounded segment count) → select the exact representation → its own audio, else the best audio
 *         representation of the separate audio adaptation set
 *
 * Parsing is Media3's (segment timelines, `$Number$`/`$Time$` templates, `SegmentBase` ranges); this class decides and
 * lists what to fetch. It never downloads media: single files are classified by [Probe] from their bytes, segment
 * tracks by the first bytes of their init section. Refusals: `ContentProtection`/DRM data → DRM_PROTECTED;
 * `type="dynamic"` → LIVE_UNSUPPORTED; several periods, audio only, unbounded or oversized segment lists →
 * UNSUPPORTED_FORMAT; HTTP/transport failures keep their transient classification.
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
    val audioSets = sets.filter { it.type == C.TRACK_TYPE_AUDIO }
    val videoSets = sets.filter { it.type == C.TRACK_TYPE_VIDEO }
    if (videoSets.isEmpty()) {
      return refuse(ProbeFailure.UNSUPPORTED_FORMAT, if (audioSets.isNotEmpty()) "audio-only DASH stream" else "DASH manifest has no video")
    }

    val periodDurationUs = manifest.getPeriodDurationUs(0).takeIf { it != C.TIME_UNSET && it > 0 }
    val candidates = videoSets.flatMapIndexed { setIndex, set ->
      set.representations.mapIndexed { repIndex, rep ->
        Candidate(rep.format.id ?: "rep-$setIndex-$repIndex", rep, trackSource(manifestUrl, rep, periodDurationUs, "video")).also {
          it.decodable = decoders.canDecode(it.format.codecs, it.width, it.height)
        }
      }
    }
    if (candidates.isEmpty()) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "DASH manifest lists no video representations")

    // The quality the user picked is downloaded exactly, or refused with the reason — never swapped for another.
    choice?.videoId?.let { wanted ->
      val match = candidates.firstOrNull { it.id == wanted }
      if (match != null && !match.eligible) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, whyNotEligible(listOf(match)))
    }
    val selected = select(candidates, choice)
      ?: return refuse(ProbeFailure.UNSUPPORTED_FORMAT, whyNotEligible(candidates))
    val videoSource = selected.source ?: return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "unusable representation URL")
    unusable(videoSource)?.let { return it }

    // Sound: the representation's own, else the separate audio adaptation set's best representation.
    val audioTrack: DashTrack?
    val audioInfo: ProbeAudioTrack?
    if (selected.muxedAudio || audioSets.isEmpty()) {
      audioTrack = null
      audioInfo = selected.ownAudio()
    } else {
      val audio = selectAudio(manifestUrl, audioSets, choice, periodDurationUs)
        ?: return refuse(ProbeFailure.AUDIO_TRACK_MISSING, "no downloadable audio representation for this video")
      val source = audio.source ?: return refuse(ProbeFailure.AUDIO_TRACK_MISSING, "unusable audio representation URL")
      unusable(source)?.let { return it }
      audioTrack = audio.toTrack(source)
      audioInfo = audio.info()
    }

    val audioBits = audioTrack?.let { track -> audioSets.flatMap { it.representations }.firstOrNull { it.format.id == track.representationId }?.let { bitrateOf(it.format) } }
    val variants = candidates.filter { it.eligible }.sortedWith(BEST_FIRST).map { it.toProbeVariant(periodDurationUs, audioBits) }
    return DashPlanResult.Ready(
      DashPlan(
        manifestUrl = manifestUrl,
        video = selected.toTrack(videoSource),
        audioTrack = audioTrack,
        selected = selected.toProbeVariant(periodDurationUs, audioBits),
        variants = variants,
        audio = audioInfo,
        durationMs = periodDurationUs?.let { it / 1000 },
      ),
    )
  }

  /** A track whose bytes live on a blocked or private host. */
  private fun unusable(source: DashTrackSource): DashPlanResult.Refused? {
    val urls = when (source) {
      is DashTrackSource.File -> listOf(source.url)
      is DashTrackSource.Segments -> source.plan.inits.map { it.url } + source.plan.segments.map { it.media.url }
    }
    for (url in urls.distinct()) {
      if (Probe.isPolicyBlockedHost(url)) return refuse(ProbeFailure.POLICY_BLOCKED, "This source is not supported")
      // A public manifest must not point the downloader at the user's own network.
      if (!http.allows(url)) return refuse(ProbeFailure.POLICY_BLOCKED, "representation on a non-public address")
    }
    return null
  }

  /**
   * One representation's bytes: its single file, or its init section + segments as a segment plan. Null when the
   * segment list is unbounded (a live-style template), empty, too long, or its URLs are not http(s).
   */
  private fun trackSource(manifestUrl: String, rep: Representation, periodDurationUs: Long?, role: String): DashTrackSource? {
    if (rep is Representation.SingleSegmentRepresentation) {
      val url = rep.uri.toString()
      return if (isHttp(url)) DashTrackSource.File(url) else null
    }
    val multi = rep as? Representation.MultiSegmentRepresentation ?: return null
    val base = multi.baseUrls.firstOrNull()?.url ?: return null
    val index: DashSegmentIndex = multi.index ?: return null
    val periodUs = periodDurationUs ?: return null
    val first = index.firstSegmentNum
    val count = index.getSegmentCount(periodUs)
    if (count == DashSegmentIndex.INDEX_UNBOUNDED.toLong() || count <= 0 || count > MAX_SEGMENTS) return null
    val init = multi.initializationUri?.let { ref(it, base) ?: return null }
    val segments = ArrayList<HlsPlannedSegment>(count.toInt())
    for (n in first until first + count) {
      val media = ref(index.getSegmentUrl(n), base) ?: return null
      segments += HlsPlannedSegment(media, index.getDurationUs(n, periodUs).coerceAtLeast(0), if (init != null) 0 else null)
    }
    val webm = MimeTypes.isMatroska(rep.format.containerMimeType)
    val bits = bitrateOf(rep.format)
    val plan = HlsPlan(
      sourceUrl = manifestUrl,
      mediaPlaylistUrl = manifestUrl,
      inits = listOfNotNull(init),
      segments = segments,
      durationUs = segments.sumOf { it.durationUs }.takeIf { it > 0 } ?: periodUs,
      selected = null,
      variants = emptyList(),
      containerHint = if (webm) Container.WEBM else Container.MP4,
      hasDiscontinuities = false,
      fingerprint = fingerprint(role, rep, segments, init),
      estimatedBytes = bits?.let { HlsPlanner.estimateBytes(it, periodUs) },
    )
    return DashTrackSource.Segments(plan)
  }

  private fun ref(ranged: RangedUri, base: String): HlsSegmentRef? {
    val url = ranged.resolveUriString(base)
    if (!isHttp(url)) return null
    val length = ranged.length.takeIf { it != C.LENGTH_UNSET.toLong() }
    val offset = if (length != null || ranged.start > 0) ranged.start else null
    return HlsSegmentRef(url = url, byteRangeOffset = offset, byteRangeLength = length)
  }

  private fun isHttp(url: String): Boolean =
    url.startsWith("https://", ignoreCase = true) || url.startsWith("http://", ignoreCase = true)

  private fun fingerprint(role: String, rep: Representation, segments: List<HlsPlannedSegment>, init: HlsSegmentRef?): String {
    val text = buildString {
      append("dash-v1|").append(role).append('|').append(rep.format.id).append('|').append(rep.format.bitrate)
      append('|').append(rep.format.codecs).append("|n:").append(segments.size).append('|')
      for (segment in segments) {
        append(segment.durationUs).append(',').append(segment.media.byteRangeOffset).append(',')
          .append(segment.media.byteRangeLength).append(';')
      }
      append("|init:").append(init?.byteRangeOffset).append(',').append(init?.byteRangeLength)
    }
    return MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
  }

  private inner class Candidate(val id: String, val representation: Representation, val source: DashTrackSource?) {
    val format: Format get() = representation.format

    /** The representation's own codecs name an audio codec: its file carries the sound. */
    val muxedAudio: Boolean get() = MimeTypes.getAudioMediaMimeType(format.codecs) != null

    val height: Int? get() = format.height.takeIf { it != Format.NO_VALUE && it > 0 }
    val width: Int? get() = format.width.takeIf { it != Format.NO_VALUE && it > 0 }
    val bitrate: Long? get() = bitrateOf(format)
    val peakBitrate: Long?
      get() = listOf(format.peakBitrate, format.bitrate, format.averageBitrate)
        .firstOrNull { it != Format.NO_VALUE && it > 0 }?.toLong()
    var decodable: Boolean = true
    val eligible: Boolean get() = source != null && decodable

    fun toTrack(source: DashTrackSource) = DashTrack(
      representationId = id,
      source = source,
      timeOffsetUs = -representation.presentationTimeOffsetUs,
      containerMimeType = format.containerMimeType,
      codecs = format.codecs,
    )

    fun toProbeVariant(durationUs: Long?, audioBits: Long?): ProbeVariant = ProbeVariant(
      id = id,
      width = width,
      height = height,
      bitrate = peakBitrate,
      frameRate = format.frameRate.takeIf { it > 0f }?.toDouble(),
      videoCodec = HlsCodecs.videoTokens(format.codecs).joinToString(",").ifBlank { null },
      needsAudioMux = false,
      estimatedBytes = bitrate?.let { bits -> durationUs?.let { HlsPlanner.estimateBytes(bits + (audioBits ?: 0L), it) } },
      decodable = decodable,
    )

    fun ownAudio(): ProbeAudioTrack? {
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

  private inner class AudioCandidate(val id: String, val representation: Representation, val source: DashTrackSource?) {
    val format: Format get() = representation.format
    val bitrate: Long? get() = bitrateOf(format)
    val main: Boolean get() = format.roleFlags and C.ROLE_FLAG_MAIN != 0
    val plain: Boolean get() = format.roleFlags == 0

    /** AAC merges into an MP4 as it is; Opus/Vorbis too (or into WebM); anything else has to be converted. */
    val codecRank: Int
      get() = when (MimeTypes.getAudioMediaMimeType(format.codecs) ?: format.sampleMimeType) {
        MimeTypes.AUDIO_AAC -> 3
        MimeTypes.AUDIO_OPUS, MimeTypes.AUDIO_VORBIS -> 2
        else -> 1
      }

    fun toTrack(source: DashTrackSource) = DashTrack(
      representationId = id,
      source = source,
      timeOffsetUs = -representation.presentationTimeOffsetUs,
      containerMimeType = format.containerMimeType,
      codecs = format.codecs,
    )

    fun info() = ProbeAudioTrack(
      id = id,
      language = format.language,
      label = format.label,
      bitrate = bitrate,
      codec = HlsCodecs.tokens(format.codecs).firstOrNull() ?: format.sampleMimeType,
      isDefault = main || plain,
    )
  }

  /**
   * The audio representation to merge in: the one asked for, else the main (or unlabelled) adaptation set's best
   * codec for an MP4 and then its highest bitrate — commentary and description tracks only when nothing else exists.
   */
  private fun selectAudio(
    manifestUrl: String,
    sets: List<AdaptationSet>,
    choice: VariantChoice?,
    periodDurationUs: Long?,
  ): AudioCandidate? {
    val candidates = sets.flatMapIndexed { setIndex, set ->
      set.representations.mapIndexed { repIndex, rep ->
        AudioCandidate(rep.format.id ?: "audio-$setIndex-$repIndex", rep, trackSource(manifestUrl, rep, periodDurationUs, "audio"))
      }
    }.filter { it.source != null }
    if (candidates.isEmpty()) return null
    choice?.audioId?.let { wanted -> candidates.firstOrNull { it.id == wanted }?.let { return it } }
    return candidates.sortedWith(
      compareByDescending<AudioCandidate> { it.main }
        .thenByDescending { it.plain }
        .thenByDescending { it.codecRank }
        .thenByDescending { it.bitrate ?: 0L },
    ).first()
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

  private fun whyNotEligible(candidates: List<Candidate>): String = when {
    candidates.all { it.source == null } -> UNRESOLVABLE_SEGMENTS
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
    /** Same bound as an HLS playlist: even hours of 2 s segments stay well under it. */
    const val MAX_SEGMENTS = HlsPlanner.MAX_SEGMENTS
    const val UNRESOLVABLE_SEGMENTS = "DASH representations list no bounded set of segments"
    const val MULTI_PERIOD = "multi-period DASH is not supported"

    private val BEST_FIRST = compareByDescending<Candidate> { it.height != null }
      .thenByDescending { it.height ?: 0 }
      .thenByDescending { it.bitrate ?: 0L }

    fun bitrateOf(format: Format): Long? =
      listOf(format.averageBitrate, format.bitrate, format.peakBitrate).firstOrNull { it != Format.NO_VALUE && it > 0 }?.toLong()

    /**
     * The manifest's verdict. [media] is the chosen file's own classification when the download is one complete
     * file; for segment or merged downloads the size is the bitrate estimate and the output is an MP4.
     */
    fun toProbeResult(plan: DashPlan, media: ProbeResult.Success?): ProbeResult.Success = ProbeResult.Success(
      kind = SourceKind.DASH,
      finalUrl = plan.manifestUrl,
      contentType = "application/dash+xml",
      container = media?.container ?: Container.MP4,
      sizeBytes = media?.sizeBytes ?: plan.selected.estimatedBytes,
      resumable = media?.resumable ?: true,
      variants = plan.variants,
      audioTracks = listOfNotNull(plan.audio),
      durationMs = plan.durationMs,
      mergesAudio = plan.audioTrack != null,
    )
  }
}
