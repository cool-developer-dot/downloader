package com.vidorax.media.subtitles

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.dash.DashSegmentIndex
import androidx.media3.exoplayer.dash.manifest.DashManifest
import androidx.media3.exoplayer.dash.manifest.RangedUri
import androidx.media3.exoplayer.dash.manifest.Representation
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist

enum class SubtitleFormat(val wire: String) {
  WEBVTT("webvtt"),
  TTML("ttml"),
}

/** Why a listed subtitle track cannot be downloaded. */
enum class SubtitleRefusal(val wire: String) {
  /** A key or ContentProtection on it. */
  ENCRYPTED("encrypted"),
  /** TTML inside fMP4 segments (`stpp`): not converted. (`wvtt` is read out of its segments, #370.) */
  EMBEDDED("embedded"),
  /** A DASH text track delivered as segments rather than one file (or a `wvtt` one whose segments cannot be listed). */
  SEGMENTED("segmented"),
  /** Another text format. */
  UNSUPPORTED("unsupported"),
}

/**
 * H19: a subtitle track of an HLS or DASH stream. [id] is stable for the same stream across reads of its manifest (no
 * URL in it), so a choice made now finds the same track when it is fetched after the video completes. [url] never
 * leaves native code: it may carry a signature, and it is re-read from the manifest whenever it is needed.
 */
data class SubtitleTrack(
  val id: String,
  /** BCP-47 as the manifest says (HLS LANGUAGE, DASH @lang); null when it does not say. */
  val language: String?,
  /** HLS NAME, DASH Label. */
  val name: String?,
  val format: SubtitleFormat?,
  val isDefault: Boolean,
  val isForced: Boolean,
  val refused: SubtitleRefusal?,
  /** Native only: the subtitle playlist (HLS) or file (DASH). */
  val url: String?,
  /** #370, native only: where a DASH `wvtt` track's fMP4 lives (null for every other track). */
  val embedded: EmbeddedWebVtt? = null,
)

/** One fetch of a track's fMP4: a URL and, for a part of a file, its inclusive byte range. */
data class SegmentRef(val url: String, val rangeStart: Long? = null, val rangeEnd: Long? = null)

/**
 * #370: a DASH track of WebVTT inside fMP4 (`wvtt`): its init segment (null when the one file holds it), its media
 * segments in order, and the presentation time offset (ms) that puts its cues on the video's timeline.
 */
data class EmbeddedWebVtt(val init: SegmentRef?, val segments: List<SegmentRef>, val offsetMs: Long)

/** Subtitle tracks from manifests Media3 parsed. Pure (no network). */
@OptIn(UnstableApi::class)
internal object SubtitleTracks {
  /** The `#EXT-X-MEDIA:TYPE=SUBTITLES` renditions of a multivariant playlist (WebVTT). */
  fun fromHls(master: HlsMultivariantPlaylist): List<SubtitleTrack> {
    val seen = HashSet<String>()
    return master.subtitles.mapNotNull { rendition ->
      val format = rendition.format
      val id = "hls:${rendition.groupId}:${format.language.orEmpty()}:${rendition.name}"
      // Several variants often list the same subtitles in groups of their own: each language and name once.
      if (!seen.add("${format.language.orEmpty()}:${rendition.name}")) return@mapNotNull null
      val mime = format.sampleMimeType ?: format.containerMimeType
      val url = rendition.url?.toString()
      val webVtt = url != null && (mime == null || mime == MimeTypes.TEXT_VTT)
      SubtitleTrack(
        id = id,
        language = format.language,
        name = rendition.name.takeIf { it.isNotBlank() } ?: format.label,
        format = if (webVtt) SubtitleFormat.WEBVTT else null,
        isDefault = format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0,
        isForced = format.selectionFlags and C.SELECTION_FLAG_FORCED != 0,
        refused = if (webVtt) null else SubtitleRefusal.UNSUPPORTED,
        url = url,
      )
    }
  }

  /**
   * The text adaptation sets of the first period: WebVTT or TTML files, and WebVTT inside fMP4 (`wvtt`, #370) whose
   * segments can be listed; segmented text, TTML inside fMP4 (`stpp`) or protected ones refused.
   */
  fun fromDash(manifest: DashManifest): List<SubtitleTrack> {
    if (manifest.periodCount == 0) return emptyList()
    val period = manifest.getPeriod(0)
    val out = ArrayList<SubtitleTrack>()
    for ((setIndex, set) in period.adaptationSets.withIndex()) {
      if (set.type != C.TRACK_TYPE_TEXT) continue
      for ((repIndex, representation) in set.representations.withIndex()) {
        val format = representation.format
        val mime = format.sampleMimeType ?: format.containerMimeType
        val codecs = format.codecs.orEmpty()
        val embedded = format.containerMimeType == MimeTypes.APPLICATION_MP4 || codecs.startsWith("stpp") || codecs.startsWith("wvtt")
        val wvtt = codecs.startsWith("wvtt")
        val subtitleFormat = when {
          // #370: Media3 calls it application/x-mp4-vtt; it is saved as WebVTT.
          wvtt -> SubtitleFormat.WEBVTT
          mime == MimeTypes.TEXT_VTT -> SubtitleFormat.WEBVTT
          mime == MimeTypes.APPLICATION_TTML -> SubtitleFormat.TTML
          else -> null
        }
        val singleFile = representation is Representation.SingleSegmentRepresentation
        val wvttSource = if (wvtt && format.drmInitData == null) wvttSource(manifest, representation) else null
        val refused = when {
          format.drmInitData != null -> SubtitleRefusal.ENCRYPTED
          // #370: read out of its fMP4 after the video completes; refused only when its segments cannot be listed.
          wvtt -> if (wvttSource == null) SubtitleRefusal.SEGMENTED else null
          embedded -> SubtitleRefusal.EMBEDDED
          subtitleFormat == null -> SubtitleRefusal.UNSUPPORTED
          !singleFile -> SubtitleRefusal.SEGMENTED
          else -> null
        }
        // Media3 resolved the BaseURL against the manifest's: the file itself.
        val url = (representation as? Representation.SingleSegmentRepresentation)?.uri?.toString()
        out += SubtitleTrack(
          id = "dash:${set.id.takeIf { it >= 0 } ?: setIndex}:${representation.format.id ?: repIndex}:${format.language.orEmpty()}",
          language = format.language,
          name = format.label,
          format = subtitleFormat,
          // Media3 folds the set's <Role>s into the format: "main" into roleFlags, "forced-subtitle" into selectionFlags.
          isDefault = format.selectionFlags and C.SELECTION_FLAG_DEFAULT != 0 ||
            format.roleFlags and C.ROLE_FLAG_MAIN != 0,
          isForced = format.selectionFlags and C.SELECTION_FLAG_FORCED != 0,
          refused = refused,
          url = url,
          embedded = wvttSource,
        )
      }
    }
    return out
  }

  /** The fMP4 of a DASH `wvtt` representation; null when its segments cannot be listed (live, unbounded, too many). */
  private fun wvttSource(manifest: DashManifest, representation: Representation): EmbeddedWebVtt? {
    val base = representation.baseUrls.firstOrNull()?.url ?: return null
    val offsetMs = representation.presentationTimeOffsetUs / 1000
    if (representation is Representation.SingleSegmentRepresentation) {
      return EmbeddedWebVtt(init = null, segments = listOf(SegmentRef(representation.uri.toString())), offsetMs = offsetMs)
    }
    val index = representation.index ?: return null
    val count = index.getSegmentCount(manifest.getPeriodDurationUs(0))
    if (count == DashSegmentIndex.INDEX_UNBOUNDED.toLong() || count <= 0 || count > SubtitleFetcher.MAX_SEGMENTS) return null
    val first = index.firstSegmentNum
    val segments = (first until first + count).map { ref(index.getSegmentUrl(it), base) }
    return EmbeddedWebVtt(representation.initializationUri?.let { ref(it, base) }, segments, offsetMs)
  }

  private fun ref(uri: RangedUri, base: String): SegmentRef {
    val url = uri.resolveUriString(base)
    return when {
      uri.length != C.LENGTH_UNSET.toLong() -> SegmentRef(url, uri.start, uri.start + uri.length - 1)
      uri.start > 0 -> SegmentRef(url, uri.start, null)
      else -> SegmentRef(url)
    }
  }
}
