package com.vidorax.media.transfer

import java.io.RandomAccessFile
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

/**
 * Makes an assembled HLS MPEG-TS file read as one continuous stream.
 *
 * Every TS packet carries a 4-bit continuity counter per PID. HLS packagers number each segment on its own, so the
 * counter jumps at almost every join (all 63 joins of Mux `x36xhzz` 288p). An HLS player ignores the counters
 * (Media3's `TsExtractor.MODE_HLS`), but the assembled `.part` is read as one file — by `process/Remuxer`, and as the
 * kept file of a stream with discontinuities — with the counters checked: a jump resets that PID's reader and drops
 * the access unit it was still assembling, the last frame of the segment before the join; a counter that repeats
 * across a join throws the next segment's first packet away as a duplicate. Found 2026-10-11 on that stream: 60 of
 * 19,039 frames and 48 of 13,656 audio frames lost after the remux, and because its segments do not start on key
 * frames, 41 more frames after five joins would not decode — the player stalled when it seeked into one of them.
 *
 * So every packet of a PID is numbered one after the previous packet of that PID, across segments: the reader then
 * consumes exactly what an HLS player would. Only the low nibble of byte 3 of each packet header changes — no payload,
 * timestamp or packet order. Deterministic (the first packet of a PID keeps its number), so renumbering again gives
 * the same bytes. A region that stops being a run of 188-byte packets is left alone from there on, and the numbering
 * starts over after it.
 */
internal class TsContinuity(initial: Map<Int, Int> = emptyMap()) {
  /** Counter of the last packet written per PID. */
  private val last = HashMap(initial)

  /** What a checkpoint stores so that a resumed download continues the numbering. */
  val state: Map<Int, Int> get() = HashMap(last)

  /** Renumbers the packets in `[start, end)` of [raf] in place (one segment, or a whole older file). */
  suspend fun renumber(raf: RandomAccessFile, start: Long, end: Long) {
    val chunk = ByteArray(CHUNK_PACKETS * PACKET)
    var at = start
    while (end - at >= PACKET) {
      currentCoroutineContext().ensureActive()
      val n = (minOf(chunk.size.toLong(), end - at) / PACKET * PACKET).toInt()
      raf.seek(at)
      raf.readFully(chunk, 0, n)
      val clean = renumberPackets(chunk, n)
      if (clean > 0) {
        diskWrite {
          raf.seek(at)
          raf.write(chunk, 0, clean)
        }
      }
      if (clean < n) {
        last.clear()
        return
      }
      at += n
    }
    // A tail shorter than a packet: not TS from here on.
    if (at < end) last.clear()
  }

  /**
   * Renumbers whole packets in `bytes[0, length)`; returns how many bytes were clean packets (all of them, or up to
   * the first packet that does not start with the sync byte).
   */
  internal fun renumberPackets(bytes: ByteArray, length: Int): Int {
    var p = 0
    while (p + PACKET <= length) {
      if (bytes[p] != SYNC) return p
      val pid = ((bytes[p + 1].toInt() and 0x1F) shl 8) or (bytes[p + 2].toInt() and 0xFF)
      if (pid != NULL_PID) {
        val flags = bytes[p + 3].toInt() and 0xFF
        val counter = last[pid]?.let { (it + 1) and 0x0F } ?: (flags and 0x0F)
        bytes[p + 3] = ((flags and 0xF0) or counter).toByte()
        last[pid] = counter
      }
      p += PACKET
    }
    return p
  }

  companion object {
    const val PACKET = 188
    private const val SYNC = 0x47.toByte()
    private const val NULL_PID = 0x1FFF
    private const val CHUNK_PACKETS = 1024
  }
}
