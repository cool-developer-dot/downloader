package com.vidorax.media.subtitles

import java.util.Locale

/**
 * H19: WebVTT as VidoraX writes it beside a video — one file, one `WEBVTT` header, cues on the video's timeline. Pure.
 *
 * Segmented HLS WebVTT is assembled here: each segment repeats the header (often with an `X-TIMESTAMP-MAP`), and a
 * cue that crosses a segment boundary is repeated in both. Segments whose map differs from the first one's are moved by
 * that difference, so the first segment stays at the video's start (where the downloaded file starts too).
 */
internal object WebVtt {
  private val TIMING = Regex("""^\s*((?:\d+:)?\d{1,2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}\.\d{3})(.*)$""")
  private val MAP = Regex("""X-TIMESTAMP-MAP=([^\r\n]+)""")
  private val MPEGTS = Regex("""MPEGTS:(\d+)""")
  private val LOCAL = Regex("""LOCAL:((?:\d+:)?\d{1,2}:\d{2}\.\d{3})""")

  data class Cue(val startMs: Long, val endMs: Long, val settings: String, val text: List<String>)

  /** Milliseconds of `hh:mm:ss.ttt` or `mm:ss.ttt`; null when it is not a WebVTT timestamp. */
  fun parseTime(value: String): Long? {
    val parts = value.trim().split(':')
    if (parts.size !in 2..3) return null
    val secondsPart = parts.last().split('.')
    if (secondsPart.size != 2 || secondsPart[1].length != 3) return null
    val hours = if (parts.size == 3) parts[0].toLongOrNull() ?: return null else 0L
    val minutes = parts[parts.size - 2].toLongOrNull() ?: return null
    val seconds = secondsPart[0].toLongOrNull() ?: return null
    val millis = secondsPart[1].toLongOrNull() ?: return null
    if (minutes > 59 || seconds > 59) return null
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis
  }

  fun formatTime(ms: Long): String {
    val clamped = ms.coerceAtLeast(0)
    val hours = clamped / 3_600_000
    val minutes = clamped / 60_000 % 60
    val seconds = clamped / 1000 % 60
    return String.format(Locale.ROOT, "%02d:%02d:%02d.%03d", hours, minutes, seconds, clamped % 1000)
  }

  /** The cues of one WebVTT text; NOTE, STYLE and REGION blocks are left out. */
  fun cues(text: String): List<Cue> {
    val blocks = normalize(text).split(Regex("\n{2,}"))
    val out = ArrayList<Cue>()
    for (block in blocks.drop(1)) {
      val lines = block.split('\n').filter { it.isNotEmpty() }
      val timingIndex = lines.indexOfFirst { TIMING.matches(it) }
      if (timingIndex !in 0..1) continue
      val match = TIMING.matchEntire(lines[timingIndex]) ?: continue
      val start = parseTime(match.groupValues[1]) ?: continue
      val end = parseTime(match.groupValues[2]) ?: continue
      if (end < start) continue
      out += Cue(start, end, match.groupValues[3].trim(), lines.drop(timingIndex + 1))
    }
    return out
  }

  /** The `X-TIMESTAMP-MAP` of a segment, as (MPEG-TS ticks at 90 kHz, local ms); null when it has none. */
  fun timestampMap(text: String): Pair<Long, Long>? {
    val header = normalize(text).substringBefore("\n\n")
    val map = MAP.find(header)?.groupValues?.get(1) ?: return null
    val mpegts = MPEGTS.find(map)?.groupValues?.get(1)?.toLongOrNull() ?: return null
    val local = LOCAL.find(map)?.groupValues?.get(1)?.let(::parseTime) ?: return null
    return mpegts to local
  }

  fun isWebVtt(text: String): Boolean = normalize(text).trimStart().startsWith("WEBVTT")

  /** One WebVTT file from the segments of a track, in order. Null when no segment is WebVTT. */
  fun assemble(segments: List<String>): String? {
    if (segments.none(::isWebVtt)) return null
    val firstMap = segments.firstNotNullOfOrNull(::timestampMap)
    val cues = ArrayList<Cue>()
    for (segment in segments) {
      if (!isWebVtt(segment)) continue
      val map = timestampMap(segment)
      // Relative to the first segment's map: a stream whose map never changes is not moved at all.
      val shift = if (map != null && firstMap != null) (map.first - firstMap.first) / 90 - (map.second - firstMap.second) else 0L
      for (cue in cues(segment)) {
        val moved = cue.copy(startMs = cue.startMs + shift, endMs = cue.endMs + shift)
        // A cue that crosses a segment boundary is repeated in the next segment.
        if (cues.lastOrNull()?.let { it.startMs == moved.startMs && it.endMs == moved.endMs && it.text == moved.text } == true) continue
        cues += moved
      }
    }
    return write(cues)
  }

  fun write(cues: List<Cue>): String {
    val out = StringBuilder("WEBVTT\n")
    for (cue in cues) {
      out.append('\n')
      out.append(formatTime(cue.startMs)).append(" --> ").append(formatTime(cue.endMs))
      if (cue.settings.isNotEmpty()) out.append(' ').append(cue.settings)
      out.append('\n')
      cue.text.forEach { out.append(it).append('\n') }
    }
    return out.toString()
  }

  private fun normalize(text: String): String = text.removePrefix("\uFEFF").replace("\r\n", "\n").replace('\r', '\n')
}
