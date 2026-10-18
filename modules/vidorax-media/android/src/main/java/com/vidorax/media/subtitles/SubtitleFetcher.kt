package com.vidorax.media.subtitles

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.UriUtil
import androidx.media3.exoplayer.dash.manifest.DashManifestParser
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.MediaRequest
import com.vidorax.media.plan.HlsKeys
import com.vidorax.media.plan.Probe
import java.io.ByteArrayInputStream
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * H19: lists a stream's subtitle tracks and fetches the chosen ones after the video completed — through the same
 * [HttpClient] as every download (public addresses only, redirect checks, the download's own request headers and
 * cookie choice, Advanced network options). Bounded in size and count. Never throws: a subtitle that cannot be
 * fetched or converted is reported, and the video is never touched.
 */
@OptIn(UnstableApi::class)
internal class SubtitleFetcher(private val http: HttpClient) {
  /** One written subtitle file. */
  data class Written(val track: SubtitleTrack, val file: File)

  data class Outcome(val written: List<Written>, val failed: Int, val note: String?)

  /** The subtitle tracks of the HLS or DASH stream at [url]; empty for anything else or when it cannot be read. */
  suspend fun list(url: String, kind: SourceKind?, context: RequestContext): List<SubtitleTrack> =
    withContext(Dispatchers.IO) { runCatching { listBlocking(url, kind, context) }.getOrDefault(emptyList()) }

  /** Fetches the tracks of [trackIds] and writes them beside [video] as `<video>.<lang>.vtt`. */
  suspend fun fetch(url: String, kind: SourceKind?, context: RequestContext, trackIds: List<String>, video: File): Outcome =
    withContext(Dispatchers.IO) {
      val tracks = runCatching { listBlocking(url, kind, context) }.getOrNull()
        ?: return@withContext Outcome(emptyList(), trackIds.size, NOTE_UNREADABLE)
      val chosen = trackIds.mapNotNull { id -> tracks.firstOrNull { it.id == id } }
      if (chosen.isEmpty()) return@withContext Outcome(emptyList(), trackIds.size, NOTE_GONE)
      val written = ArrayList<Written>()
      var failed = trackIds.size - chosen.size
      var note: String? = if (failed > 0) NOTE_GONE else null
      for (track in chosen) {
        val text = runCatching { textOf(track, context) }.getOrNull()
        if (text == null) {
          failed += 1
          note = if (track.format == SubtitleFormat.TTML) NOTE_NOT_CONVERTED else NOTE_FAILED
          continue
        }
        val file = runCatching { SubtitleFiles.write(video, track.language, text) }.getOrNull()
        if (file == null) {
          failed += 1
          note = NOTE_FAILED
        } else {
          written += Written(track, file)
        }
      }
      Outcome(written, failed, note)
    }

  private fun listBlocking(url: String, kind: SourceKind?, context: RequestContext): List<SubtitleTrack> {
    if (kind != SourceKind.HLS && kind != SourceKind.DASH) return emptyList()
    val (finalUrl, bytes) = get(url, context, MAX_MANIFEST_BYTES) ?: throw java.io.IOException("manifest unreadable")
    return if (kind == SourceKind.HLS) {
      val playlist = HlsPlaylistParser().parse(Uri.parse(finalUrl), ByteArrayInputStream(bytes))
      if (playlist is HlsMultivariantPlaylist) SubtitleTracks.fromHls(playlist) else emptyList()
    } else {
      SubtitleTracks.fromDash(DashManifestParser().parse(Uri.parse(finalUrl), ByteArrayInputStream(bytes)))
    }
  }

  /** The WebVTT text of [track], or null when it cannot be fetched, is protected, or does not convert. */
  private fun textOf(track: SubtitleTrack, context: RequestContext): String? {
    if (track.refused != null) return null
    track.embedded?.let { return fmp4WebVtt(it.init, it.segments, it.offsetMs, context) }
    val url = track.url ?: return null
    return when {
      track.id.startsWith("hls:") -> hlsWebVtt(url, context)
      track.format == SubtitleFormat.TTML -> get(url, context, MAX_FILE_BYTES)?.let { TtmlToVtt.convert(String(it.second, Charsets.UTF_8)) }
      else -> get(url, context, MAX_FILE_BYTES)?.let { String(it.second, Charsets.UTF_8) }?.takeIf(WebVtt::isWebVtt)
        ?.let { WebVtt.assemble(listOf(it)) }
    }
  }

  /** An HLS subtitle rendition: its media playlist of WebVTT segments (or, on some sites, the WebVTT file itself). */
  private fun hlsWebVtt(url: String, context: RequestContext): String? {
    val (finalUrl, bytes) = get(url, context, MAX_MANIFEST_BYTES) ?: return null
    val text = String(bytes, Charsets.UTF_8)
    if (WebVtt.isWebVtt(text)) return WebVtt.assemble(listOf(text))
    if (HlsKeys.declaresEncryption(text)) return null
    val playlist = HlsPlaylistParser().parse(Uri.parse(finalUrl), ByteArrayInputStream(bytes)) as? HlsMediaPlaylist ?: return null
    if (playlist.segments.size > MAX_SEGMENTS) return null
    // #370: fMP4 segments (EXT-X-MAP) carry WebVTT as `wvtt` samples; the first segment stays at the video's start.
    playlist.segments.firstNotNullOfOrNull { it.initializationSegment }?.let { init ->
      return fmp4WebVtt(hlsRef(playlist, init), playlist.segments.map { hlsRef(playlist, it) }, offsetMs = null, context)
    }
    var total = 0L
    val segments = ArrayList<String>(playlist.segments.size)
    for (segment in playlist.segments) {
      val segmentUrl = UriUtil.resolve(playlist.baseUri, segment.url)
      val body = get(segmentUrl, context, MAX_SEGMENT_BYTES)?.second ?: return null
      total += body.size
      if (total > MAX_FILE_BYTES) return null
      segments += String(body, Charsets.UTF_8)
    }
    return WebVtt.assemble(segments)
  }

  /**
   * #370: the WebVTT of a track inside fMP4 — the `wvtt` track named by [init] (or by the one file, when there is no
   * init segment), read from [segments] in order. [offsetMs] moves its cues onto the video's timeline; null starts
   * the first segment at zero (HLS, as for WebVTT text segments). Null when anything cannot be fetched or read.
   */
  private fun fmp4WebVtt(init: SegmentRef?, segments: List<SegmentRef>, offsetMs: Long?, context: RequestContext): String? {
    if (segments.isEmpty() || segments.size > MAX_SEGMENTS) return null
    val track = init?.let { ref -> fetch(ref, context, MAX_SEGMENT_BYTES)?.let(Fmp4WebVtt::trackOf) ?: return null }
    var total = 0L
    var firstStartMs: Long? = null
    val cues = ArrayList<WebVtt.Cue>()
    for (segment in segments) {
      // A single-file track (no init segment) holds its own moov and every fragment: it is read whole.
      val body = fetch(segment, context, if (init == null) MAX_FILE_BYTES else MAX_SEGMENT_BYTES) ?: return null
      total += body.size
      if (total > MAX_FILE_BYTES) return null
      val fragments = Fmp4WebVtt.fragments(body, track ?: Fmp4WebVtt.trackOf(body) ?: return null)
      if (firstStartMs == null) firstStartMs = fragments.startMs
      cues += fragments.cues
      if (cues.size > Fmp4WebVtt.MAX_CUES) return null
    }
    return Fmp4WebVtt.assemble(cues, offsetMs ?: firstStartMs ?: 0L)
  }

  private fun hlsRef(playlist: HlsMediaPlaylist, segment: HlsMediaPlaylist.Segment): SegmentRef {
    val url = UriUtil.resolve(playlist.baseUri, segment.url)
    return if (segment.byteRangeLength != C.LENGTH_UNSET.toLong()) {
      SegmentRef(url, segment.byteRangeOffset, segment.byteRangeOffset + segment.byteRangeLength - 1)
    } else {
      SegmentRef(url)
    }
  }

  private fun fetch(ref: SegmentRef, context: RequestContext, maxBytes: Int): ByteArray? =
    get(ref.url, context, maxBytes, ref.rangeStart, ref.rangeEnd)?.second

  /** (final URL, body) of a 2xx answer within [maxBytes]; null otherwise, and for YouTube (refused by policy). */
  private fun get(
    url: String,
    context: RequestContext,
    maxBytes: Int,
    rangeStart: Long? = null,
    rangeEnd: Long? = null,
  ): Pair<String, ByteArray>? {
    if (Probe.isPolicyBlockedHost(url)) return null
    val request = MediaRequest(url = url, context = context, rangeStart = rangeStart, rangeEnd = rangeEnd)
    return http.execute(request).use { response ->
      if (response.status !in 200..299) return null
      val body = response.readBounded(maxBytes) ?: return null
      // A redirect onto a refused host is refused too.
      if (Probe.isPolicyBlockedHost(response.finalUrl)) return null
      response.finalUrl to body
    }
  }

  companion object {
    const val MAX_MANIFEST_BYTES = 4 * 1024 * 1024
    const val MAX_SEGMENT_BYTES = 1024 * 1024
    const val MAX_FILE_BYTES = 10 * 1024 * 1024
    const val MAX_SEGMENTS = 5_000

    /** The notes Download Details shows (JavaScript translates them by these codes). */
    const val NOTE_UNREADABLE = "unreadable"
    const val NOTE_GONE = "gone"
    const val NOTE_FAILED = "failed"
    const val NOTE_NOT_CONVERTED = "not_converted"
  }
}

/** `<video base name>.<lang>.vtt` beside the video; `.<lang>.2.vtt`, `.3`, … when that name is taken. */
internal object SubtitleFiles {
  private val LANGUAGE = Regex("[^A-Za-z0-9-]")

  fun languageTag(language: String?): String =
    language?.replace(LANGUAGE, "")?.take(16)?.takeIf { it.isNotEmpty() } ?: "und"

  fun fileFor(video: File, language: String?): File {
    val folder = video.parentFile ?: throw java.io.IOException("no folder")
    val base = video.nameWithoutExtension
    val tag = languageTag(language)
    var copy = 1
    while (true) {
      val name = if (copy == 1) "$base.$tag.vtt" else "$base.$tag.$copy.vtt"
      val file = File(folder, name)
      if (!file.exists()) return file
      copy += 1
    }
  }

  /** Written whole or not at all: a temporary file renamed into place. */
  fun write(video: File, language: String?, text: String): File {
    val target = fileFor(video, language)
    val temp = File(target.parentFile, ".${target.name}.part")
    temp.writeText(text, Charsets.UTF_8)
    if (!temp.renameTo(target)) {
      temp.delete()
      throw java.io.IOException("could not save the subtitle")
    }
    return target
  }
}
