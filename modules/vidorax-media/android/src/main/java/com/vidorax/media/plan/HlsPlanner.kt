package com.vidorax.media.plan

import android.media.MediaCodecList
import android.media.MediaFormat
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
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
import com.vidorax.media.net.Redact
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** One resource of an HLS media playlist: a media segment or an `EXT-X-MAP` init section. */
internal data class HlsSegmentRef(
  /** Absolute URL, exactly as the playlist resolved it — signed queries and tokens intact. */
  val url: String,
  /** `EXT-X-BYTERANGE` sub-range of [url]; both null when the whole resource is the segment. */
  val byteRangeOffset: Long? = null,
  val byteRangeLength: Long? = null,
)

internal data class HlsPlannedSegment(
  val media: HlsSegmentRef,
  val durationUs: Long,
  /** Index into [HlsPlan.inits] of the init section this segment needs, or null (MPEG-TS without a map). */
  val initIndex: Int?,
)

/**
 * A resolved, classified, downloadable segment track: one media playlist of one variant (VOD, unencrypted) — or,
 * built by the DASH planner, one segmented representation. Segment order is what the transfer writes. When the
 * variant keeps its sound in a separate rendition, [audio] is that rendition's own plan (merged after the download).
 */
internal data class HlsPlan(
  /** The enqueued playlist URL after redirects (a multivariant or a media playlist). */
  val sourceUrl: String,
  /** The selected media playlist after redirects; segment URLs were resolved against it. */
  val mediaPlaylistUrl: String,
  val inits: List<HlsSegmentRef>,
  val segments: List<HlsPlannedSegment>,
  val durationUs: Long,
  /** The chosen variant, or null when a media playlist was enqueued directly. */
  val selected: ProbeVariant?,
  /** Every variant of the multivariant playlist, best first (quality metadata); empty for a media playlist. */
  val variants: List<ProbeVariant>,
  /** fMP4 when the playlist maps init sections, else MPEG-TS; the transfer confirms it from the bytes. */
  val containerHint: Container,
  val hasDiscontinuities: Boolean,
  /** Identity of the playlist's *structure* (not its tokens), so a resume never splices another rendition in. */
  val fingerprint: String,
  /** Average-bitrate estimate of the final size; null when the playlist does not say. */
  val estimatedBytes: Long?,
  /** The variant's separate audio rendition (`EXT-X-MEDIA TYPE=AUDIO` with a URI), downloaded and merged in. */
  val audio: HlsPlan? = null,
  /** What [audio] is, for the quality sheet. */
  val audioInfo: ProbeAudioTrack? = null,
)

internal sealed interface HlsPlanResult {
  data class Ready(val plan: HlsPlan) : HlsPlanResult

  data class Refused(val failure: ProbeResult.Failure) : HlsPlanResult
}

/** Whether this device has a decoder for a variant's video codec. Best effort: never blocks an unknown codec. */
internal fun interface DecoderSupport {
  fun canDecode(codecs: String?, width: Int?, height: Int?): Boolean

  companion object {
    val ASSUME_ALL = DecoderSupport { _, _, _ -> true }
  }
}

/** The real check, over the platform codec list. */
internal object AndroidDecoderSupport : DecoderSupport {
  private val codecList by lazy { runCatching { MediaCodecList(MediaCodecList.REGULAR_CODECS) }.getOrNull() }

  override fun canDecode(codecs: String?, width: Int?, height: Int?): Boolean {
    val list = codecList ?: return true
    val mimes = HlsCodecs.videoMimeTypes(codecs)
    if (mimes.isEmpty()) return true
    return mimes.all { mime ->
      runCatching {
        list.findDecoderForFormat(MediaFormat.createVideoFormat(mime, width ?: 640, height ?: 360)) != null
      }.getOrDefault(true)
    }
  }
}

/** `EXT-X-KEY` / `EXT-X-SESSION-KEY` as written in the playlist text. */
internal object HlsKeys {
  private val METHOD = Regex("""(?:^|,)\s*METHOD\s*=\s*"?([A-Za-z0-9\-]+)"?""")

  /** True when any key tag names a method other than NONE (AES-128, SAMPLE-AES*, or anything unknown). */
  fun declaresEncryption(playlist: String): Boolean =
    playlist.lineSequence().map { it.trim() }.any { line ->
      val attributes = when {
        line.startsWith("#EXT-X-KEY:") -> line.removePrefix("#EXT-X-KEY:")
        line.startsWith("#EXT-X-SESSION-KEY:") -> line.removePrefix("#EXT-X-SESSION-KEY:")
        else -> return@any false
      }
      val method = METHOD.find(attributes)?.groupValues?.get(1)?.uppercase()
      method != "NONE"
    }
}

/** RFC 6381 codec strings as HLS `CODECS` carries them. */
internal object HlsCodecs {
  private val VIDEO_PREFIXES = mapOf(
    "avc1" to "video/avc",
    "avc3" to "video/avc",
    "hvc1" to "video/hevc",
    "hev1" to "video/hevc",
    "vp09" to "video/x-vnd.on2.vp9",
    "vp9" to "video/x-vnd.on2.vp9",
    "vp08" to "video/x-vnd.on2.vp8",
    "vp8" to "video/x-vnd.on2.vp8",
    "av01" to "video/av01",
    "dvh1" to "video/dolby-vision",
    "dvhe" to "video/dolby-vision",
    "dva1" to "video/dolby-vision",
    "dvav" to "video/dolby-vision",
    "mp4v" to "video/mp4v-es",
  )

  val VIDEO_TOKENS: Set<String> get() = VIDEO_PREFIXES.keys

  fun tokens(codecs: String?): List<String> =
    codecs.orEmpty().split(',').map { it.trim().trim('"') }.filter { it.isNotEmpty() }

  fun videoTokens(codecs: String?): List<String> =
    tokens(codecs).filter { it.substringBefore('.').lowercase() in VIDEO_PREFIXES }

  fun videoMimeTypes(codecs: String?): Set<String> =
    videoTokens(codecs).mapNotNull { VIDEO_PREFIXES[it.substringBefore('.').lowercase()] }.toSet()

  /** CODECS present and naming no video codec: an audio-only rendition (or captions), not a video. */
  fun isAudioOnly(codecs: String?): Boolean = tokens(codecs).isNotEmpty() && videoTokens(codecs).isEmpty()
}

/**
 * Turns an HLS URL into exactly one downloadable media playlist, or a truthful refusal.
 *
 *     playlist URL → fetch (session context, redirects checked) → Media3 HlsPlaylistParser
 *       multivariant → variants → select the exact variant → fetch its media playlist
 *       media playlist → classify: live? encrypted/DRM? gaps? separate audio? → segments
 *
 * Parsing is Media3's; this class only decides. It never fetches a key, never decrypts, never downloads a media
 * segment ([confirmMedia] reads at most the first bytes of the first one). Refusals: live (no `EXT-X-ENDLIST`) → LIVE_UNSUPPORTED; any `EXT-X-KEY` other than NONE, session keys or
 * sample-level DRM → DRM_PROTECTED; separate audio renditions, audio-only, gaps, format changes mid-stream →
 * UNSUPPORTED_FORMAT; HTTP/transport failures keep their transient classification.
 */
@OptIn(UnstableApi::class)
internal class HlsPlanner(
  private val http: HttpClient,
  private val decoders: DecoderSupport = DecoderSupport.ASSUME_ALL,
) {
  suspend fun plan(url: String, context: RequestContext, choice: VariantChoice?): HlsPlanResult =
    withContext(Dispatchers.IO) { planBlocking(url, context, choice) }

  /**
   * A playlist can say "VOD, unencrypted"; only the bytes say *what* it carries. A media playlist found on its own
   * may be the subtitle or audio rendition of a stream (players load those next to the video). Reads the init
   * section, or the first bytes of the first segment, with the plan's session and token handling, and refuses what
   * is not a video: WebVTT, packed audio, a track list without video, Common Encryption boxes. A read that fails is
   * no verdict: the transfer checks the bytes again before it writes any.
   */
  suspend fun confirmMedia(plan: HlsPlan, context: RequestContext): ProbeResult.Failure? =
    withContext(Dispatchers.IO) { confirmMediaBlocking(plan, context) }

  /**
   * The same check for one track of a split stream (an HLS audio rendition, a DASH segment representation): an
   * audio track's first bytes must be sound (TS, packed audio, an init with a sound track), a video track's a
   * picture; Common Encryption is protection. A read that fails is no verdict.
   */
  suspend fun confirmTrack(plan: HlsPlan, context: RequestContext, role: TrackRole): ProbeResult.Failure? =
    withContext(Dispatchers.IO) { confirmTrackBlocking(plan, context, role) }

  private fun confirmTrackBlocking(plan: HlsPlan, context: RequestContext, role: TrackRole): ProbeResult.Failure? {
    val first = plan.segments.firstOrNull() ?: return null
    val init = first.initIndex?.let { plan.inits.getOrNull(it) }
    val head = peek(init ?: first.media, plan.mediaPlaylistUrl, context, if (init != null) INIT_PEEK_BYTES else SEGMENT_PEEK_BYTES)
      ?: return null
    if (MediaSniffer.hasEncryptionEvidence(head) || MediaSniffer.trackSummary(head).encrypted) {
      return failure(ProbeFailure.DRM_PROTECTED, null, "encrypted stream (Common Encryption)")
    }
    val missing = if (role == TrackRole.AUDIO) ProbeFailure.AUDIO_TRACK_MISSING else ProbeFailure.VIDEO_TRACK_MISSING
    if (HlsSegmentFormat.isPackedAudio(head)) {
      return if (role == TrackRole.AUDIO) null else failure(missing, null, "audio-only stream (packed audio)")
    }
    val container = HlsSegmentFormat.containerOf(head)
      ?: return failure(missing, null, HlsSegmentFormat.refusal(head))
    if (container == Container.TS) return null
    val summary = MediaSniffer.trackSummary(head)
    return when (role) {
      TrackRole.AUDIO -> if (summary.hasAudio == false) failure(missing, null, "the audio track has no sound") else null
      TrackRole.VIDEO -> if (summary.hasVideo == false) failure(missing, null, "the video track has no picture") else null
    }
  }

  private fun confirmMediaBlocking(plan: HlsPlan, context: RequestContext): ProbeResult.Failure? {
    // The separate audio rendition is checked like the video: it must be sound, and not encrypted.
    plan.audio?.let { audio -> confirmTrackBlocking(audio, context, TrackRole.AUDIO)?.let { return it } }
    val first = plan.segments.firstOrNull() ?: return null
    val init = first.initIndex?.let { plan.inits.getOrNull(it) }
    val limit = if (init != null) INIT_PEEK_BYTES else SEGMENT_PEEK_BYTES
    val head = peek(init ?: first.media, plan.mediaPlaylistUrl, context, limit) ?: return null
    if (init == null) {
      if (HlsSegmentFormat.containerOf(head) != null) return null
      return failure(ProbeFailure.UNSUPPORTED_FORMAT, null, HlsSegmentFormat.refusal(head))
    }
    if (MediaSniffer.hasEncryptionEvidence(head)) {
      return failure(ProbeFailure.DRM_PROTECTED, null, "encrypted HLS (Common Encryption in the init section)")
    }
    val handlers = MediaSniffer.trackHandlers(head)
    if (handlers.isNullOrEmpty() || "vide" in handlers) return null
    val what = if ("soun" in handlers) "audio-only HLS stream" else "subtitle playlist, not video"
    return failure(ProbeFailure.UNSUPPORTED_FORMAT, null, what)
  }

  /** The first bytes of [ref] (its byte range honoured), or null when the server does not hand them over. */
  private fun peek(ref: HlsSegmentRef, playlistUrl: String, context: RequestContext, limit: Int): ByteArray? {
    val (status, bytes) = peekOnce(ref.url, ref, context, limit)
    if (bytes != null || status !in AUTH_STATUS) return bytes
    // Token-auth CDNs expect the playlist's query on segments as well; the transfer does the same.
    val propagated = withParentQuery(ref.url, playlistUrl) ?: return null
    return peekOnce(propagated, ref, context, limit).second
  }

  /** The HTTP status (null when there was no response) and the bytes, when they are the start of [ref]. */
  private fun peekOnce(url: String, ref: HlsSegmentRef, context: RequestContext, limit: Int): Pair<Int?, ByteArray?> {
    val offset = ref.byteRangeOffset ?: 0L
    val length = minOf(ref.byteRangeLength ?: Long.MAX_VALUE, limit.toLong())
    val response = try {
      http.execute(MediaRequest(url = url, context = context, rangeStart = offset, rangeEnd = offset + length - 1))
    } catch (e: MediaRefusedException) {
      return null to null
    } catch (e: MediaNetworkException) {
      return null to null
    }
    response.use {
      val status = it.status
      val atStart = (status == 206 && it.contentRange?.start == offset) || (status == 200 && offset == 0L)
      if (!atStart) return status to null
      val bytes = try {
        it.readPrefix(length.toInt())
      } catch (e: java.io.IOException) {
        return status to null
      }
      return status to (if (bytes.isEmpty()) null else bytes)
    }
  }

  private fun planBlocking(url: String, context: RequestContext, choice: VariantChoice?): HlsPlanResult {
    if (Probe.isPolicyBlockedHost(url)) return refuse(ProbeFailure.POLICY_BLOCKED, "This source is not supported")
    val source = when (val fetched = fetchPlaylist(url, parentUrl = null, context)) {
      is Fetched.Failed -> return HlsPlanResult.Refused(fetched.failure)
      is Fetched.Ok -> fetched
    }
    return when (val playlist = source.playlist) {
      is HlsMediaPlaylist -> classify(source.finalUrl, source.finalUrl, playlist, selected = null, variants = emptyList())
      is HlsMultivariantPlaylist -> planMultivariant(source.finalUrl, playlist, context, choice)
      else -> refuse(ProbeFailure.UNSUPPORTED_FORMAT, "unrecognized HLS playlist")
    }
  }

  private fun planMultivariant(
    sourceUrl: String,
    master: HlsMultivariantPlaylist,
    context: RequestContext,
    choice: VariantChoice?,
  ): HlsPlanResult {
    if (master.sessionKeyDrmInitData.isNotEmpty()) {
      return refuse(ProbeFailure.DRM_PROTECTED, "stream declares a session key (DRM)")
    }
    val candidates = master.variants.mapNotNull { variant ->
      val absolute = resolve(sourceUrl, variant.url.toString()) ?: return@mapNotNull null
      Candidate(absolute, variant.format, needsAudioMux(master, variant), variant.audioGroupId).also {
        it.decodable = decoders.canDecode(it.format.codecs, it.width, it.height)
      }
    }
    if (candidates.isEmpty()) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "multivariant playlist lists no variants")

    // The quality the user picked is downloaded exactly, or refused with the reason — never swapped for another.
    choice?.videoId?.let { wanted ->
      val match = candidates.firstOrNull { it.url == wanted }
        ?: candidates.firstOrNull { Redact.url(it.url) == Redact.url(wanted) }
      if (match != null && !match.eligible) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, whyNothingEligible(listOf(match)))
    }
    val selected = select(candidates, choice)
      ?: return refuse(ProbeFailure.UNSUPPORTED_FORMAT, whyNothingEligible(candidates))
    if (Probe.isPolicyBlockedHost(selected.url)) return refuse(ProbeFailure.POLICY_BLOCKED, "This source is not supported")

    val media = when (val fetched = fetchPlaylist(selected.url, parentUrl = sourceUrl, context, master)) {
      is Fetched.Failed -> return HlsPlanResult.Refused(fetched.failure)
      is Fetched.Ok -> fetched
    }
    val playlist = media.playlist as? HlsMediaPlaylist
      ?: return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "variant is not a media playlist")
    val variants = candidates.sortedWith(BEST_FIRST).map { it.toProbeVariant(playlist.durationUs) }
    val video = classify(sourceUrl, media.finalUrl, playlist, selected.toProbeVariant(playlist.durationUs), variants)
    if (video !is HlsPlanResult.Ready || !selected.needsAudioMux) return video
    return withSeparateAudio(video.plan, sourceUrl, master, selected, context, choice)
  }

  /**
   * The selected variant's sound lives in its own rendition playlist: pick the rendition (the one asked for, else the
   * group's DEFAULT, else AUTOSELECT, else the first), classify its media playlist like the video's (VOD,
   * unencrypted, no gaps) and attach it. Discontinuities cannot be merged across separate tracks.
   */
  private fun withSeparateAudio(
    video: HlsPlan,
    sourceUrl: String,
    master: HlsMultivariantPlaylist,
    selected: Candidate,
    context: RequestContext,
    choice: VariantChoice?,
  ): HlsPlanResult {
    if (video.hasDiscontinuities) {
      return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "separate audio with discontinuities cannot be merged")
    }
    val renditions = master.audios.filter { it.groupId == selected.audioGroupId && it.url != null }
    val wanted = choice?.audioId
    val rendition = renditions.firstOrNull { wanted != null && Redact.url(resolve(sourceUrl, it.url.toString()) ?: "") == Redact.url(wanted) }
      ?: renditions.firstOrNull { it.format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0 }
      ?: renditions.firstOrNull { it.format.selectionFlags and C.SELECTION_FLAG_AUTOSELECT != 0 }
      ?: renditions.firstOrNull()
      ?: return refuse(ProbeFailure.AUDIO_TRACK_MISSING, "the audio rendition has no playlist")
    val audioUrl = resolve(sourceUrl, rendition.url.toString())
      ?: return refuse(ProbeFailure.AUDIO_TRACK_MISSING, "unusable audio rendition URL")
    if (Probe.isPolicyBlockedHost(audioUrl)) return refuse(ProbeFailure.POLICY_BLOCKED, "This source is not supported")
    val fetched = when (val result = fetchPlaylist(audioUrl, parentUrl = sourceUrl, context, master)) {
      is Fetched.Failed -> return HlsPlanResult.Refused(result.failure)
      is Fetched.Ok -> result
    }
    val playlist = fetched.playlist as? HlsMediaPlaylist
      ?: return refuse(ProbeFailure.AUDIO_TRACK_MISSING, "the audio rendition is not a media playlist")
    val audio = when (val classified = classify(sourceUrl, fetched.finalUrl, playlist, selected = null, variants = emptyList())) {
      is HlsPlanResult.Ready -> classified.plan
      is HlsPlanResult.Refused -> return classified
    }
    if (audio.hasDiscontinuities) {
      return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "separate audio with discontinuities cannot be merged")
    }
    val info = ProbeAudioTrack(
      id = audioUrl,
      language = rendition.format.language,
      label = rendition.format.label ?: rendition.name,
      bitrate = null,
      codec = HlsCodecs.tokens(rendition.format.codecs).firstOrNull()
        ?: HlsCodecs.tokens(selected.format.codecs).firstOrNull { MimeTypes.getAudioMediaMimeType(it) != null },
      isDefault = rendition.format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0,
    )
    return HlsPlanResult.Ready(video.copy(audio = audio, audioInfo = info))
  }

  // --- media playlist classification ---

  private fun classify(
    sourceUrl: String,
    playlistUrl: String,
    playlist: HlsMediaPlaylist,
    selected: ProbeVariant?,
    variants: List<ProbeVariant>,
  ): HlsPlanResult {
    if (!playlist.hasEndTag) return refuse(ProbeFailure.LIVE_UNSUPPORTED, "live HLS playlist (no EXT-X-ENDLIST)")
    if (playlist.protectionSchemes != null) return refuse(ProbeFailure.DRM_PROTECTED, "DRM-protected HLS")
    if (playlist.segments.isEmpty()) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "HLS playlist has no segments")
    if (playlist.segments.size > MAX_SEGMENTS) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "HLS playlist is too long")

    val inits = mutableListOf<HlsSegmentRef>()
    val initKeys = HashMap<String, Int>()
    val segments = ArrayList<HlsPlannedSegment>(playlist.segments.size)
    var discontinuities = false
    val firstDiscontinuity = playlist.segments.first().relativeDiscontinuitySequence
    for (segment in playlist.segments) {
      if (isEncrypted(segment) || segment.initializationSegment?.let { isEncrypted(it) } == true) {
        return refuse(ProbeFailure.DRM_PROTECTED, "encrypted HLS (EXT-X-KEY)")
      }
      if (segment.hasGapTag) return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "HLS playlist has missing segments")
      if (segment.relativeDiscontinuitySequence != firstDiscontinuity) discontinuities = true
      val media = ref(playlistUrl, segment)
        ?: return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "unusable segment URL")
      // A public playlist must not point the downloader at the user's own network.
      if (!http.allows(media.url)) return refuse(ProbeFailure.POLICY_BLOCKED, "segment on a non-public address")
      val initIndex = segment.initializationSegment?.let { init ->
        val initRef = ref(playlistUrl, init) ?: return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "unusable init URL")
        if (!http.allows(initRef.url)) return refuse(ProbeFailure.POLICY_BLOCKED, "segment on a non-public address")
        val key = "${initRef.url}#${initRef.byteRangeOffset}+${initRef.byteRangeLength}"
        initKeys.getOrPut(key) { inits.add(initRef); inits.size - 1 }
      }
      segments += HlsPlannedSegment(media, segment.durationUs.coerceAtLeast(0), initIndex)
    }

    val container = containerHint(inits)
    if (container == Container.MP4 && (inits.size > 1 || discontinuities)) {
      // fMP4 fragments from different timelines or init sections cannot be joined into one playable file
      // without remuxing, which this product does not do.
      return refuse(ProbeFailure.UNSUPPORTED_FORMAT, "fMP4 stream changes format mid-way")
    }

    val durationUs = playlist.durationUs.takeIf { it > 0 } ?: segments.sumOf { it.durationUs }
    return HlsPlanResult.Ready(
      HlsPlan(
        sourceUrl = sourceUrl,
        mediaPlaylistUrl = playlistUrl,
        inits = inits,
        segments = segments,
        durationUs = durationUs,
        selected = selected,
        variants = variants,
        containerHint = container,
        hasDiscontinuities = discontinuities,
        fingerprint = fingerprint(playlist, selected, segments, inits),
        // Average bitrate × duration (the variant's own estimate): peak BANDWIDTH would overstate the size.
        estimatedBytes = selected?.estimatedBytes,
      ),
    )
  }

  private fun isEncrypted(segment: HlsMediaPlaylist.SegmentBase): Boolean =
    segment.fullSegmentEncryptionKeyUri != null || segment.drmInitData != null

  private fun ref(playlistUrl: String, segment: HlsMediaPlaylist.SegmentBase): HlsSegmentRef? {
    val url = resolve(playlistUrl, segment.url) ?: return null
    val ranged = segment.byteRangeLength != C.LENGTH_UNSET.toLong()
    return HlsSegmentRef(
      url = url,
      byteRangeOffset = if (ranged) segment.byteRangeOffset else null,
      byteRangeLength = if (ranged) segment.byteRangeLength else null,
    )
  }

  private fun containerHint(inits: List<HlsSegmentRef>): Container {
    if (inits.isEmpty()) return Container.TS
    val allTs = inits.all { it.url.toHttpUrlOrNull()?.encodedPath?.endsWith(".ts", ignoreCase = true) == true }
    return if (allTs) Container.TS else Container.MP4
  }

  // --- variant selection ---

  private class Candidate(val url: String, val format: Format, val needsAudioMux: Boolean, val audioGroupId: String?) {
    val height: Int? get() = format.height.takeIf { it != Format.NO_VALUE && it > 0 }
    val width: Int? get() = format.width.takeIf { it != Format.NO_VALUE && it > 0 }
    val bitrate: Long?
      get() = listOf(format.averageBitrate, format.bitrate, format.peakBitrate)
        .firstOrNull { it != Format.NO_VALUE && it > 0 }?.toLong()
    val peakBitrate: Long?
      get() = listOf(format.peakBitrate, format.bitrate, format.averageBitrate)
        .firstOrNull { it != Format.NO_VALUE && it > 0 }?.toLong()
    val audioOnly: Boolean get() = HlsCodecs.isAudioOnly(format.codecs) && height == null

    /**
     * How well the variant's sound fits the saved file: AAC/Opus (or unstated) copy into an MP4 as they are; AC-3/E-AC-3
     * and others would have to be converted — so of two otherwise equal variants, the one an MP4 carries wins.
     */
    val audioRank: Int
      get() {
        val audio = HlsCodecs.tokens(format.codecs).filter { it.substringBefore('.').lowercase() !in HlsCodecs.VIDEO_TOKENS }
        return when {
          audio.isEmpty() -> 1
          audio.any { it.lowercase().startsWith("mp4a") || it.lowercase().startsWith("opus") } -> 2
          else -> 0
        }
      }
    var decodable: Boolean = true

    /** Separate audio no longer disqualifies a variant: its rendition is downloaded and merged in. */
    val eligible: Boolean get() = !audioOnly && decodable

    fun toProbeVariant(durationUs: Long): ProbeVariant = ProbeVariant(
      id = url,
      width = width,
      height = height,
      bitrate = peakBitrate,
      frameRate = format.frameRate.takeIf { it > 0f }?.toDouble(),
      videoCodec = HlsCodecs.videoTokens(format.codecs).joinToString(",").ifBlank { null },
      needsAudioMux = needsAudioMux,
      estimatedBytes = bitrate?.let { estimateBytes(it, durationUs) },
      decodable = decodable && !audioOnly,
    )
  }

  private fun select(candidates: List<Candidate>, choice: VariantChoice?): Candidate? {
    val eligible = candidates.filter { it.eligible }
    if (eligible.isEmpty()) return null

    choice?.videoId?.let { wanted ->
      eligible.firstOrNull { it.url == wanted }?.let { return it }
      eligible.firstOrNull { Redact.url(it.url) == Redact.url(wanted) }?.let { return it }
    }
    val maxHeight = choice?.maxHeight
    if (maxHeight != null) {
      val fitting = eligible.filter { (it.height ?: 0) <= maxHeight }
      if (fitting.isNotEmpty()) return fitting.sortedWith(BEST_FIRST).first()
      return eligible.minWithOrNull(
        compareBy<Candidate> { it.height ?: Int.MAX_VALUE }.thenByDescending { it.audioRank }.thenBy { it.bitrate ?: 0L },
      )
    }
    // Known video renditions before variants that declare nothing about themselves.
    return eligible.sortedWith(BEST_FIRST).first()
  }

  private fun whyNothingEligible(candidates: List<Candidate>): String = when {
    candidates.all { it.audioOnly } -> "audio-only HLS stream"
    else -> "no variant this device can decode"
  }

  /**
   * A variant whose `AUDIO` group delivers audio only through its own playlists (every rendition has a URI) is
   * video-only: its sound is downloaded from the rendition and merged in. A rendition without a URI means the audio
   * is muxed into the variant itself.
   */
  private fun needsAudioMux(master: HlsMultivariantPlaylist, variant: HlsMultivariantPlaylist.Variant): Boolean {
    val group = variant.audioGroupId ?: return false
    val renditions = master.audios.filter { it.groupId == group }
    return renditions.isNotEmpty() && renditions.all { it.url != null }
  }

  // --- fetching ---

  private sealed interface Fetched {
    class Ok(val finalUrl: String, val playlist: HlsPlaylist) : Fetched

    class Failed(val failure: ProbeResult.Failure) : Fetched
  }

  /**
   * Fetches and parses one playlist. When a child playlist answers 401/403 and carries no query of its own while
   * its parent's URL did, it is retried once with the parent's query: some token-auth CDNs expect the playlist's
   * token on every child request. Standard streams never reach that path.
   */
  private fun fetchPlaylist(
    url: String,
    parentUrl: String?,
    context: RequestContext,
    master: HlsMultivariantPlaylist? = null,
  ): Fetched {
    val first = fetchOnce(url, context, master)
    if (first is Fetched.Failed && first.failure.httpStatus in AUTH_STATUS && parentUrl != null) {
      val propagated = withParentQuery(url, parentUrl)
      if (propagated != null) return fetchOnce(propagated, context, master)
    }
    return first
  }

  private fun fetchOnce(url: String, context: RequestContext, master: HlsMultivariantPlaylist?): Fetched {
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
        it.readBounded(MAX_PLAYLIST_BYTES)
      } catch (e: java.io.IOException) {
        return Fetched.Failed(failure(ProbeFailure.NETWORK, null, "Could not read the playlist"))
      } ?: return Fetched.Failed(failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "HLS playlist is too large"))

      if (!looksLikePlaylist(bytes)) {
        val verdict = MediaSniffer.sniff(bytes, it.contentType, it.finalUrl, bytes.size.toLong())
        val reason = (verdict as? SniffResult.Unsupported)?.reason ?: ProbeFailure.UNSUPPORTED_FORMAT
        return Fetched.Failed(failure(reason, null, "The link did not return an HLS playlist"))
      }
      // Decided from the tags themselves, before and independently of parsing: Media3 records no trace of
      // SAMPLE-AES with an identity key or of FairPlay key formats, and a malformed DRM key line makes the
      // parser throw — neither may ever read as "unencrypted".
      if (HlsKeys.declaresEncryption(String(bytes, Charsets.UTF_8))) {
        return Fetched.Failed(failure(ProbeFailure.DRM_PROTECTED, null, "encrypted HLS (EXT-X-KEY)"))
      }
      val parsed = try {
        // A media playlist of a multivariant stream may import that playlist's EXT-X-DEFINE variables.
        val parser = if (master != null) HlsPlaylistParser(master, null) else HlsPlaylistParser()
        parser.parse(Uri.parse(it.finalUrl), ByteArrayInputStream(bytes))
      } catch (e: Exception) {
        // ParserException and friends: a malformed playlist is a verdict on the source, not a network error.
        return Fetched.Failed(failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "malformed HLS playlist"))
      }
      return Fetched.Ok(it.finalUrl, parsed)
    }
  }

  private fun looksLikePlaylist(bytes: ByteArray): Boolean {
    var start = 0
    if (bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()) start = 3
    while (start < bytes.size && bytes[start].toInt().toChar().isWhitespace()) start++
    return String(bytes, start, minOf(7, bytes.size - start), Charsets.ISO_8859_1) == "#EXTM3U"
  }

  // --- helpers ---

  private fun refuse(reason: ProbeFailure, message: String) = HlsPlanResult.Refused(failure(reason, null, message))

  private fun failure(reason: ProbeFailure, status: Int?, message: String?) =
    ProbeResult.Failure(reason = reason, httpStatus = status, message = message)

  private fun fingerprint(
    playlist: HlsMediaPlaylist,
    selected: ProbeVariant?,
    segments: List<HlsPlannedSegment>,
    inits: List<HlsSegmentRef>,
  ): String {
    val text = buildString {
      append("hls-v1|")
      selected?.let { append("variant:${it.bitrate},${it.width}x${it.height},${it.videoCodec}|") }
      append("seq:${playlist.mediaSequence}|disc:${playlist.discontinuitySequence}|n:${segments.size}|")
      for (segment in segments) {
        append(segment.durationUs).append(',')
          .append(segment.media.byteRangeOffset).append(',')
          .append(segment.media.byteRangeLength).append(',')
          .append(segment.initIndex).append(';')
      }
      append("|inits:")
      for (init in inits) append(init.byteRangeOffset).append(',').append(init.byteRangeLength).append(';')
    }
    return MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
  }

  companion object {
    /** Playlists are text; even a 20 000-segment VOD playlist is a few MB. Anything larger is not a playlist. */
    const val MAX_PLAYLIST_BYTES = 8 * 1024 * 1024
    const val MAX_SEGMENTS = 20_000

    /** An init section is a few hundred bytes to a few KB; a larger one is not read in full (no verdict). */
    private const val INIT_PEEK_BYTES = 64 * 1024

    /** Enough for two MPEG-TS sync bytes, an ID3/ADTS header or a WEBVTT signature. */
    private const val SEGMENT_PEEK_BYTES = 4 * 1024

    private val AUTH_STATUS = setOf(401, 403)

    private val BEST_FIRST = compareByDescending<Candidate> { it.height != null }
      .thenByDescending { it.height ?: 0 }
      .thenByDescending { it.audioRank }
      .thenByDescending { it.bitrate ?: 0L }

    fun estimateBytes(bitsPerSecond: Long, durationUs: Long): Long? =
      if (bitsPerSecond <= 0 || durationUs <= 0) null else bitsPerSecond / 8 * durationUs / 1_000_000

    /** Resolves [child] against [base] (RFC 3986); only http(s) results are usable. */
    fun resolve(base: String, child: String): String? =
      base.toHttpUrlOrNull()?.resolve(child)?.toString()

    /** [child] with [parent]'s query, when the child has none and the parent has one; else null. */
    fun withParentQuery(child: String, parent: String): String? {
      val childUrl = child.toHttpUrlOrNull() ?: return null
      val query = parent.toHttpUrlOrNull()?.encodedQuery ?: return null
      if (childUrl.encodedQuery != null || query.isBlank()) return null
      return childUrl.newBuilder().encodedQuery(query).build().toString()
    }

    fun toProbeResult(plan: HlsPlan): ProbeResult.Success = ProbeResult.Success(
      kind = SourceKind.HLS,
      finalUrl = plan.sourceUrl,
      contentType = "application/vnd.apple.mpegurl",
      // Separate tracks are merged into an MP4.
      container = if (plan.audio != null) Container.MP4 else plan.containerHint,
      sizeBytes = null,
      resumable = true,
      variants = plan.variants,
      audioTracks = listOfNotNull(plan.audioInfo),
      durationMs = plan.durationUs / 1000,
      mergesAudio = plan.audio != null,
    )
  }
}
