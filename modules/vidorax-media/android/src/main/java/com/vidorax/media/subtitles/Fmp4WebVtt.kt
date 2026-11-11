package com.vidorax.media.subtitles

/**
 * #370: WebVTT carried inside fragmented MP4 (`wvtt`, ISO/IEC 14496-30), read into the cues of one `.vtt` file. Pure:
 * bytes in, cues out; nothing is fetched here.
 *
 * - The init segment's `moov` names the `wvtt` track (its id and timescale, and the `trex` defaults).
 * - Each `moof` + `mdat` of a media segment gives that track's samples: a sample is a time span holding `vttc` cue
 *   boxes (`payl` text, `sttg` settings) or a `vtte` empty box (no cue then).
 * - A cue that spans several samples or segments is repeated in each; [assemble] joins those again.
 * Anything malformed is skipped rather than guessed at; times come only from `tfdt` and the sample durations.
 */
internal object Fmp4WebVtt {
  /** The `wvtt` track of an init segment. Durations and sizes are the `trex` defaults (null when not given). */
  data class Track(val trackId: Long, val timescale: Long, val defaultDuration: Long?, val defaultSize: Long?)

  /** One media segment's cues (ms on the track's timeline) and when its first fragment starts. */
  data class Fragments(val cues: List<WebVtt.Cue>, val startMs: Long?)

  /** Bounds against hostile files; a real subtitle track is far below them. */
  const val MAX_CUES = 50_000
  private const val MAX_SAMPLES_PER_RUN = 100_000

  private class Box(val type: String, val start: Int, val payload: Int, val end: Int)

  /** The `wvtt` track of [init] (an init segment, or a whole single-file track); null when it has none. */
  fun trackOf(init: ByteArray): Track? {
    val moov = children(init, 0, init.size).firstOrNull { it.type == "moov" } ?: return null
    val moovBoxes = children(init, moov.payload, moov.end)
    val defaults = HashMap<Long, Pair<Long?, Long?>>()
    moovBoxes.firstOrNull { it.type == "mvex" }?.let { mvex ->
      for (trex in children(init, mvex.payload, mvex.end).filter { it.type == "trex" }) {
        if (trex.end - trex.payload < 24) continue
        val id = u32(init, trex.payload + 4)
        defaults[id] = u32(init, trex.payload + 12) to u32(init, trex.payload + 16)
      }
    }
    for (trak in moovBoxes.filter { it.type == "trak" }) {
      val trakBoxes = children(init, trak.payload, trak.end)
      val trackId = trakBoxes.firstOrNull { it.type == "tkhd" }?.let { trackIdOf(init, it) } ?: continue
      val mdia = trakBoxes.firstOrNull { it.type == "mdia" } ?: continue
      val mdiaBoxes = children(init, mdia.payload, mdia.end)
      val timescale = mdiaBoxes.firstOrNull { it.type == "mdhd" }?.let { timescaleOf(init, it) } ?: continue
      if (timescale <= 0) continue
      val minf = mdiaBoxes.firstOrNull { it.type == "minf" } ?: continue
      val stbl = children(init, minf.payload, minf.end).firstOrNull { it.type == "stbl" } ?: continue
      val stsd = children(init, stbl.payload, stbl.end).firstOrNull { it.type == "stsd" } ?: continue
      // stsd: version/flags (4), entry_count (4), then the sample entries.
      if (stsd.end - stsd.payload < 8) continue
      val entry = children(init, stsd.payload + 8, stsd.end).firstOrNull() ?: continue
      if (entry.type != "wvtt") continue
      val (duration, size) = defaults[trackId] ?: (null to null)
      return Track(trackId, timescale, duration, size)
    }
    return null
  }

  /** The cues of [track] in [segment] (one or more `moof` + `mdat` pairs). */
  fun fragments(segment: ByteArray, track: Track): Fragments {
    val top = children(segment, 0, segment.size)
    val cues = ArrayList<WebVtt.Cue>()
    var startMs: Long? = null
    var nextDecodeTime: Long? = null
    for ((index, moof) in top.withIndex()) {
      if (moof.type != "moof") continue
      val mdat = top.drop(index + 1).firstOrNull { it.type == "mdat" || it.type == "moof" }?.takeIf { it.type == "mdat" }
        ?: continue
      for (traf in children(segment, moof.payload, moof.end).filter { it.type == "traf" }) {
        val trafBoxes = children(segment, traf.payload, traf.end)
        val tfhd = trafBoxes.firstOrNull { it.type == "tfhd" }?.let { parseTfhd(segment, it) } ?: continue
        if (tfhd.trackId != track.trackId) continue
        var decodeTime = trafBoxes.firstOrNull { it.type == "tfdt" }?.let { parseTfdt(segment, it) } ?: nextDecodeTime ?: 0L
        if (startMs == null) startMs = toMs(decodeTime, track.timescale)
        val base = tfhd.baseDataOffset?.toInt() ?: moof.start
        for (trun in trafBoxes.filter { it.type == "trun" }) {
          val run = parseTrun(segment, trun) ?: continue
          var position = run.dataOffset?.let { base + it } ?: mdat.payload
          for (sample in run.samples) {
            val duration = sample.duration ?: tfhd.defaultDuration ?: track.defaultDuration ?: 0L
            val size = (sample.size ?: tfhd.defaultSize ?: track.defaultSize ?: 0L).toInt()
            if (size < 0 || position < 0 || position + size > segment.size) break
            val start = decodeTime + sample.compositionOffset
            readCues(segment, position, position + size, toMs(start, track.timescale), toMs(start + duration, track.timescale), cues)
            if (cues.size > MAX_CUES) return Fragments(cues.subList(0, MAX_CUES).toList(), startMs)
            position += size
            decodeTime += duration
          }
        }
        nextDecodeTime = decodeTime
      }
    }
    return Fragments(cues, startMs)
  }

  /**
   * One WebVTT file: cues moved by -[offsetMs] (so the track starts where the downloaded video does), in time order,
   * a cue repeated across samples or segments joined back into one, nothing before zero.
   */
  fun assemble(cues: List<WebVtt.Cue>, offsetMs: Long = 0L): String {
    val joined = ArrayList<WebVtt.Cue>()
    for (cue in cues.sortedBy { it.startMs }) {
      val moved = cue.copy(startMs = (cue.startMs - offsetMs).coerceAtLeast(0), endMs = cue.endMs - offsetMs)
      if (moved.endMs <= moved.startMs) continue
      val same = joined.indexOfLast { it.text == moved.text && it.settings == moved.settings && it.endMs >= moved.startMs - 1 }
      if (same >= 0 && joined.size - same <= OVERLAPPING_CUES) {
        val previous = joined[same]
        joined[same] = previous.copy(endMs = maxOf(previous.endMs, moved.endMs))
        continue
      }
      joined += moved
    }
    return WebVtt.write(joined)
  }

  /** Cues shown at the same time (several `vttc` in one sample) that a repeat may continue. */
  private const val OVERLAPPING_CUES = 8

  private fun readCues(data: ByteArray, from: Int, to: Int, startMs: Long, endMs: Long, out: MutableList<WebVtt.Cue>) {
    if (endMs <= startMs) return
    for (box in children(data, from, to)) {
      if (box.type != "vttc") continue // vtte: no cue in this span; vtta: a comment
      var text: String? = null
      var settings = ""
      for (part in children(data, box.payload, box.end)) {
        when (part.type) {
          "payl" -> text = utf8(data, part.payload, part.end)
          "sttg" -> settings = utf8(data, part.payload, part.end).trim()
        }
      }
      val lines = text?.replace("\r\n", "\n")?.replace('\r', '\n')?.trimEnd('\n')?.split('\n')
        ?.filter { it.isNotEmpty() } ?: continue
      if (lines.isEmpty()) continue
      out += WebVtt.Cue(startMs, endMs, settings, lines)
    }
  }

  private class Tfhd(val trackId: Long, val baseDataOffset: Long?, val defaultDuration: Long?, val defaultSize: Long?)

  private fun parseTfhd(data: ByteArray, box: Box): Tfhd? {
    if (box.end - box.payload < 8) return null
    val flags = u32(data, box.payload) and 0xFFFFFF
    var at = box.payload + 4
    val trackId = u32(data, at)
    at += 4
    fun take(bytes: Int): Long? = if (at + bytes > box.end) null else (if (bytes == 8) u64(data, at) else u32(data, at)).also { at += bytes }
    val base = if (flags and 0x1L != 0L) take(8) else null
    if (flags and 0x2L != 0L) take(4)
    val duration = if (flags and 0x8L != 0L) take(4) else null
    val size = if (flags and 0x10L != 0L) take(4) else null
    return Tfhd(trackId, base?.takeIf { it in 0..Int.MAX_VALUE }, duration, size)
  }

  private fun parseTfdt(data: ByteArray, box: Box): Long? {
    if (box.end - box.payload < 8) return null
    val version = data[box.payload].toInt() and 0xFF
    return if (version == 1) {
      if (box.end - box.payload < 12) null else u64(data, box.payload + 4).takeIf { it >= 0 }
    } else {
      u32(data, box.payload + 4)
    }
  }

  private class Sample(val duration: Long?, val size: Long?, val compositionOffset: Long)

  private class Run(val dataOffset: Int?, val samples: List<Sample>)

  private fun parseTrun(data: ByteArray, box: Box): Run? {
    if (box.end - box.payload < 8) return null
    val version = data[box.payload].toInt() and 0xFF
    val flags = u32(data, box.payload) and 0xFFFFFF
    val count = u32(data, box.payload + 4)
    if (count > MAX_SAMPLES_PER_RUN) return null
    var at = box.payload + 8
    fun next(): Long? = if (at + 4 > box.end) null else u32(data, at).also { at += 4 }
    val dataOffset = if (flags and 0x1L != 0L) (next() ?: return null).toInt() else null
    if (flags and 0x4L != 0L) next() ?: return null
    val samples = ArrayList<Sample>(count.toInt())
    repeat(count.toInt()) {
      val duration = if (flags and 0x100L != 0L) next() ?: return null else null
      val size = if (flags and 0x200L != 0L) next() ?: return null else null
      if (flags and 0x400L != 0L) next() ?: return null
      val offset = if (flags and 0x800L != 0L) {
        val raw = next() ?: return null
        if (version == 1) raw.toInt().toLong() else raw
      } else {
        0L
      }
      samples += Sample(duration, size, offset)
    }
    return Run(dataOffset, samples)
  }

  private fun trackIdOf(data: ByteArray, tkhd: Box): Long? {
    val version = data.getOrNull(tkhd.payload)?.toInt()?.and(0xFF) ?: return null
    val at = tkhd.payload + if (version == 1) 20 else 12
    return if (at + 4 > tkhd.end) null else u32(data, at)
  }

  private fun timescaleOf(data: ByteArray, mdhd: Box): Long? {
    val version = data.getOrNull(mdhd.payload)?.toInt()?.and(0xFF) ?: return null
    val at = mdhd.payload + if (version == 1) 20 else 12
    return if (at + 4 > mdhd.end) null else u32(data, at)
  }

  /** The boxes between [from] and [to]; stops at the first one that does not fit. */
  private fun children(data: ByteArray, from: Int, to: Int): List<Box> {
    val out = ArrayList<Box>()
    var at = from
    val limit = minOf(to, data.size)
    while (at + 8 <= limit) {
      var size = u32(data, at)
      val type = String(data, at + 4, 4, Charsets.ISO_8859_1)
      var header = 8
      if (size == 1L) {
        if (at + 16 > limit) break
        size = u64(data, at + 8)
        header = 16
      } else if (size == 0L) {
        size = (limit - at).toLong()
      }
      if (size < header || at + size > limit) break
      out += Box(type, at, at + header, (at + size).toInt())
      at += size.toInt()
    }
    return out
  }

  private fun toMs(time: Long, timescale: Long): Long = time * 1000 / timescale

  private fun utf8(data: ByteArray, from: Int, to: Int): String = String(data, from, to - from, Charsets.UTF_8)

  private fun u32(data: ByteArray, at: Int): Long =
    ((data[at].toLong() and 0xFF) shl 24) or ((data[at + 1].toLong() and 0xFF) shl 16) or
      ((data[at + 2].toLong() and 0xFF) shl 8) or (data[at + 3].toLong() and 0xFF)

  private fun u64(data: ByteArray, at: Int): Long = (u32(data, at) shl 32) or u32(data, at + 4)
}
