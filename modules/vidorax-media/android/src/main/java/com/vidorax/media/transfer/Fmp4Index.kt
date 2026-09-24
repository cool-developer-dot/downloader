package com.vidorax.media.transfer

import java.io.RandomAccessFile

/**
 * Makes concatenated fMP4 HLS segments one file a player can time and seek.
 *
 * Packagers put a `sidx` (segment index) inside each fMP4 segment, describing that segment alone. Joined end to end,
 * a player reads those as the index of the whole file (Media3 reported a 2 s duration for an 8 s download). No
 * sample byte is touched to fix that — this is indexing, not remuxing:
 *  1. a `free` box sized for one index is reserved right after the init section ([writePlaceholder]);
 *  2. each segment's own `sidx` boxes are renamed `free` as the segment lands ([neutralizeSegmentIndexes]) — same
 *     size, ignored by every parser;
 *  3. once every segment is on disk, the reserved box becomes a single `sidx` over all fragments ([writeGlobalIndex]),
 *     with durations from each fragment's own `tfdt`, so duration and seeking are exact.
 */
internal object Fmp4Index {
  private val MARKER = "VIDORAX-SIDX".toByteArray(Charsets.US_ASCII)

  /** sidx v1: box header 12 + reference_ID 4 + timescale 4 + EPT 8 + first_offset 8 + reserved 2 + count 2. */
  private const val SIDX_FIXED = 40L
  private const val SIDX_REFERENCE = 12L

  fun placeholderSize(segments: Int): Long = SIDX_FIXED + SIDX_REFERENCE * segments.coerceAtLeast(1)

  /** Writes the reserved box at [at] and returns the offset after it. */
  fun writePlaceholder(raf: RandomAccessFile, at: Long, segments: Int): Long {
    val size = placeholderSize(segments)
    val payload = ByteArray((size - 8).toInt())
    MARKER.copyInto(payload)
    raf.seek(at)
    raf.write(u32(size))
    raf.write("free".toByteArray(Charsets.US_ASCII))
    raf.write(payload)
    return at + size
  }

  /** Renames every top-level `sidx` in `[from, to)` to `free`, in place. */
  fun neutralizeSegmentIndexes(raf: RandomAccessFile, from: Long, to: Long) {
    var offset = from
    val header = ByteArray(16)
    while (offset + 8 <= to) {
      raf.seek(offset)
      raf.readFully(header, 0, 8)
      var size = be32(header, 0)
      if (size == 1L) {
        if (offset + 16 > to) return
        raf.readFully(header, 8, 8)
        size = be64(header, 8)
      } else if (size == 0L) {
        size = to - offset
      }
      if (size < 8) return
      if (String(header, 4, 4, Charsets.ISO_8859_1) == "sidx") {
        raf.seek(offset + 4)
        raf.write("free".toByteArray(Charsets.US_ASCII))
      }
      offset += size
    }
  }

  /**
   * Replaces the reserved box at [indexOffset] (of [indexSize] bytes) with a `sidx` referencing every fragment
   * (`moof`) after it; fragments are grouped when there are more than the reserved space can list. Returns false —
   * leaving the file playable, only unindexed — when the fragments cannot be timed.
   */
  fun writeGlobalIndex(raf: RandomAccessFile, indexOffset: Long, indexSize: Long, totalDurationUs: Long): Boolean {
    val video = videoTrack(raf, indexOffset) ?: return false
    val end = raf.length()
    val fragments = mutableListOf<Pair<Long, Long>>() // (moof offset, video tfdt)
    var offset = indexOffset + indexSize
    val header = ByteArray(16)
    while (offset + 8 <= end) {
      raf.seek(offset)
      raf.readFully(header, 0, 8)
      var size = be32(header, 0)
      var headerSize = 8
      if (size == 1L) {
        raf.readFully(header, 8, 8)
        size = be64(header, 8)
        headerSize = 16
      } else if (size == 0L) {
        size = end - offset
      }
      if (size < headerSize) return false
      if (String(header, 4, 4, Charsets.ISO_8859_1) == "moof") {
        if (size > MAX_MOOF_BYTES) return false
        val moof = ByteArray((size - headerSize).toInt())
        raf.seek(offset + headerSize)
        raf.readFully(moof)
        val tfdt = videoDecodeTime(moof, video.trackId) ?: return false
        fragments += offset to tfdt
      }
      offset += size
    }
    if (fragments.isEmpty()) return false

    val capacity = ((indexSize - SIDX_FIXED) / SIDX_REFERENCE).toInt()
    if (capacity < 1) return false
    val step = (fragments.size + capacity - 1) / capacity
    val boundaries = fragments.filterIndexed { i, _ -> i % step == 0 }
    val totalTicks = totalDurationUs * video.timescale / 1_000_000
    val references = boundaries.mapIndexed { i, (moofOffset, tfdt) ->
      val nextOffset = boundaries.getOrNull(i + 1)?.first ?: end
      val duration = boundaries.getOrNull(i + 1)?.let { it.second - tfdt }
        ?: (totalTicks - (tfdt - boundaries.first().second))
      Triple(nextOffset - moofOffset, duration.coerceAtLeast(1), moofOffset)
    }
    if (references.any { it.first >= (1L shl 31) || it.second > 0xFFFFFFFFL }) return false

    val sidxSize = SIDX_FIXED + SIDX_REFERENCE * references.size
    val sidxEnd = indexOffset + sidxSize
    val tail = indexSize - sidxSize
    val out = java.io.ByteArrayOutputStream(indexSize.toInt())
    out.write(u32(sidxSize))
    out.write("sidx".toByteArray(Charsets.US_ASCII))
    out.write(byteArrayOf(1, 0, 0, 0)) // version 1, flags 0
    out.write(u32(video.trackId))
    out.write(u32(video.timescale))
    out.write(u64(boundaries.first().second)) // earliest presentation time: the first fragment's decode time
    out.write(u64(references.first().third - sidxEnd)) // first_offset: skip the tail and segment 0's lead-in
    out.write(byteArrayOf(0, 0))
    out.write(byteArrayOf((references.size ushr 8).toByte(), references.size.toByte()))
    for ((size, duration, _) in references) {
      out.write(u32(size)) // reference_type 0 (media)
      out.write(u32(duration))
      out.write(u32(0x80000000L)) // starts_with_SAP
    }
    if (tail > 0) {
      out.write(u32(tail))
      out.write("free".toByteArray(Charsets.US_ASCII))
      out.write(ByteArray((tail - 8).toInt()))
    }
    raf.seek(indexOffset)
    raf.write(out.toByteArray())
    return true
  }

  private data class VideoTrack(val trackId: Long, val timescale: Long)

  /** The video track's id and media timescale, from the `moov` of the init section before [limit]. */
  private fun videoTrack(raf: RandomAccessFile, limit: Long): VideoTrack? {
    var offset = 0L
    val header = ByteArray(8)
    while (offset + 8 <= limit) {
      raf.seek(offset)
      raf.readFully(header)
      val size = be32(header, 0)
      if (size < 8) return null
      if (String(header, 4, 4, Charsets.ISO_8859_1) == "moov") {
        if (size > MAX_MOOV_BYTES) return null
        val moov = ByteArray((size - 8).toInt())
        raf.readFully(moov)
        for (trak in children(moov, 0, moov.size, "trak")) {
          val mdia = children(moov, trak.first, trak.second, "mdia").firstOrNull() ?: continue
          val hdlr = children(moov, mdia.first, mdia.second, "hdlr").firstOrNull() ?: continue
          if (String(moov, hdlr.first + 8, 4, Charsets.ISO_8859_1) != "vide") continue
          val tkhd = children(moov, trak.first, trak.second, "tkhd").firstOrNull() ?: continue
          val mdhd = children(moov, mdia.first, mdia.second, "mdhd").firstOrNull() ?: continue
          val tkhdV1 = moov[tkhd.first].toInt() == 1
          val trackId = be32(moov, tkhd.first + if (tkhdV1) 20 else 12)
          val mdhdV1 = moov[mdhd.first].toInt() == 1
          val timescale = be32(moov, mdhd.first + if (mdhdV1) 20 else 12)
          return if (timescale > 0) VideoTrack(trackId, timescale) else null
        }
        return null
      }
      offset += size
    }
    return null
  }

  /** `tfdt` of the `traf` for [trackId] inside a `moof` payload. */
  private fun videoDecodeTime(moof: ByteArray, trackId: Long): Long? {
    for (traf in children(moof, 0, moof.size, "traf")) {
      val tfhd = children(moof, traf.first, traf.second, "tfhd").firstOrNull() ?: continue
      if (be32(moof, tfhd.first + 4) != trackId) continue
      val tfdt = children(moof, traf.first, traf.second, "tfdt").firstOrNull() ?: return null
      return if (moof[tfdt.first].toInt() == 1) be64(moof, tfdt.first + 4) else be32(moof, tfdt.first + 4)
    }
    return null
  }

  /** Payload ranges (start, end) of the direct child boxes named [type] within `[from, to)`. */
  private fun children(data: ByteArray, from: Int, to: Int, type: String): List<Pair<Int, Int>> {
    val found = mutableListOf<Pair<Int, Int>>()
    var offset = from
    while (offset + 8 <= to) {
      val size = be32(data, offset).toInt()
      if (size < 8 || offset + size > to) break
      if (String(data, offset + 4, 4, Charsets.ISO_8859_1) == type) found += (offset + 8) to (offset + size)
      offset += size
    }
    return found
  }

  private fun be32(data: ByteArray, offset: Int): Long =
    ((data[offset].toLong() and 0xFF) shl 24) or ((data[offset + 1].toLong() and 0xFF) shl 16) or
      ((data[offset + 2].toLong() and 0xFF) shl 8) or (data[offset + 3].toLong() and 0xFF)

  private fun be64(data: ByteArray, offset: Int): Long {
    var v = 0L
    for (i in 0 until 8) v = (v shl 8) or (data[offset + i].toLong() and 0xFF)
    return v
  }

  private fun u32(v: Long) = byteArrayOf((v ushr 24).toByte(), (v ushr 16).toByte(), (v ushr 8).toByte(), v.toByte())

  private fun u64(v: Long) = ByteArray(8) { i -> (v ushr (56 - 8 * i)).toByte() }

  private const val MAX_MOOF_BYTES = 4L * 1024 * 1024
  private const val MAX_MOOV_BYTES = 8L * 1024 * 1024
}
