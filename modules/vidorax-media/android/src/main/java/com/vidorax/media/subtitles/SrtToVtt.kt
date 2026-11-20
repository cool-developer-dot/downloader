package com.vidorax.media.subtitles

/**
 * P8 #407: a SubRip (`.srt`) subtitle from an archive as the WebVTT VidoraX keeps beside a video. Cue numbers are
 * dropped, `00:00:01,500` becomes `00:00:01.500`, formatting tags SubRip shares with WebVTT (`<i>`, `<b>`, `<u>`) are
 * kept. Pure; null when no cue could be read.
 */
internal object SrtToVtt {
  private val TIMING = Regex("""^\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3}).*$""")

  fun convert(text: String): String? {
    val blocks = text.removePrefix("﻿").replace("\r\n", "\n").replace('\r', '\n').split(Regex("\n\\s*\n"))
    val cues = ArrayList<WebVtt.Cue>()
    for (block in blocks) {
      val lines = block.split('\n').filter { it.isNotBlank() }
      val timingIndex = lines.indexOfFirst { TIMING.matches(it) }
      if (timingIndex !in 0..1) continue
      val match = TIMING.matchEntire(lines[timingIndex]) ?: continue
      val g = match.groupValues
      val start = millis(g[1], g[2], g[3], g[4]) ?: continue
      val end = millis(g[5], g[6], g[7], g[8]) ?: continue
      if (end < start) continue
      val body = lines.drop(timingIndex + 1).map { it.replace("-->", "->") }
      if (body.isEmpty()) continue
      cues += WebVtt.Cue(start, end, "", body)
    }
    return if (cues.isEmpty()) null else WebVtt.write(cues)
  }

  private fun millis(h: String, m: String, s: String, fraction: String): Long? {
    val minutes = m.toLong()
    val seconds = s.toLong()
    if (minutes > 59 || seconds > 59) return null
    val ms = fraction.padEnd(3, '0').toLong()
    return ((h.toLong() * 60 + minutes) * 60 + seconds) * 1000 + ms
  }
}
