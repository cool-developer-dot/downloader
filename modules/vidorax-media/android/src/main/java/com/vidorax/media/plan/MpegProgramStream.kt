package com.vidorax.media.plan

import java.io.File
import java.io.RandomAccessFile

/**
 * MPEG Program Stream (ISO/IEC 11172-1 / 13818-1) facts read from the bytes (F4): what `.mpg`, `.mpeg` and `.vob`
 * files are. A stream starts with a pack header (`00 00 01 BA`) whose next bits say MPEG-1 (`0010`) or MPEG-2 (`01`).
 * A DVD title protected with CSS marks its packets scrambled (the PES header's `PES_scrambling_control` is not `00`):
 * such a stream is refused as protected — VidoraX never decrypts.
 */
internal object MpegProgramStream {
  private const val PACK_START = 0xBA
  private const val SYSTEM_HEADER = 0xBB
  private const val PROGRAM_END = 0xB9
  private const val PRIVATE_STREAM_1 = 0xBD

  /** How much of a finished file is checked for scrambling (the probe checks what it read). */
  const val SCRAMBLING_SCAN_BYTES = 4 * 1024 * 1024

  /** The bytes start with an MPEG-1 or MPEG-2 pack header. */
  fun isProgramStream(prefix: ByteArray): Boolean = packHeaderLength(prefix, 0) != null

  /**
   * Any audio, video or private-stream-1 packet in [data] says it is scrambled. Walks pack by pack; out of step it
   * looks for the next pack header, so a cut or damaged stretch does not stop the check.
   */
  fun isScrambled(data: ByteArray, length: Int = data.size): Boolean {
    var at = 0
    while (at + 6 <= length) {
      if (!isStartCode(data, at)) {
        at = nextPackStart(data, at + 1, length) ?: return false
        continue
      }
      val id = data[at + 3].toInt() and 0xFF
      when {
        id == PACK_START -> at += packHeaderLength(data, at, length) ?: return false
        id == PROGRAM_END -> at += 4
        id < SYSTEM_HEADER -> at = nextPackStart(data, at + 1, length) ?: return false
        else -> {
          val packetLength = ((data[at + 4].toInt() and 0xFF) shl 8) or (data[at + 5].toInt() and 0xFF)
          if (isElementary(id) && at + 6 < length) {
            val flags = data[at + 6].toInt() and 0xFF
            // MPEG-2 PES header ('10' marker): the next two bits are PES_scrambling_control.
            if (flags and 0xC0 == 0x80 && (flags shr 4) and 0x3 != 0) return true
          }
          at += 6 + packetLength
        }
      }
    }
    return false
  }

  /**
   * A video packet (`E0`–`EF`) within [data]. Android's own metadata reader does not see the MPEG-1 video of a system
   * stream, so the stream's packets decide whether it is a video, not that reader.
   */
  fun hasVideoStream(data: ByteArray, length: Int = data.size): Boolean {
    var at = 0
    while (at + 6 <= length) {
      if (!isStartCode(data, at)) {
        at = nextPackStart(data, at + 1, length) ?: return false
        continue
      }
      val id = data[at + 3].toInt() and 0xFF
      when {
        id == PACK_START -> at += packHeaderLength(data, at, length) ?: return false
        id == PROGRAM_END -> at += 4
        id < SYSTEM_HEADER -> at = nextPackStart(data, at + 1, length) ?: return false
        id in 0xE0..0xEF -> return true
        else -> at += 6 + (((data[at + 4].toInt() and 0xFF) shl 8) or (data[at + 5].toInt() and 0xFF))
      }
    }
    return false
  }

  /** [hasVideoStream] over the first [maxBytes] of a file. */
  fun hasVideoStream(file: File, maxBytes: Int = SCRAMBLING_SCAN_BYTES): Boolean = runCatching {
    RandomAccessFile(file, "r").use { raf ->
      val size = minOf(raf.length(), maxBytes.toLong()).toInt()
      val buffer = ByteArray(size)
      raf.readFully(buffer)
      hasVideoStream(buffer, size)
    }
  }.getOrDefault(false)

  /** What a program stream's own bytes say about it (F4): for the library when Android's reader says nothing. */
  data class Info(
    /** From the first and the last clock reference (SCR); null when the file has fewer than two packs. */
    val durationMs: Long?,
    val width: Int?,
    val height: Int?,
    /** `video/mpeg2` for MPEG-2 video (a sequence extension follows the sequence header), `video/mpeg` for MPEG-1. */
    val videoCodec: String?,
    val hasVideo: Boolean,
  )

  /** Reads [Info] from the head (sequence header, first SCR) and the tail (last SCR) of [file]. Null: not a program stream. */
  fun inspect(file: File): Info? = runCatching {
    RandomAccessFile(file, "r").use { raf ->
      val length = raf.length()
      val head = ByteArray(minOf(length, HEAD_SCAN_BYTES.toLong()).toInt())
      raf.readFully(head)
      if (!isProgramStream(head)) return@use null
      val tailStart = maxOf(0L, length - TAIL_SCAN_BYTES)
      val tail = ByteArray((length - tailStart).toInt())
      raf.seek(tailStart)
      raf.readFully(tail)
      val first = clockReference(head, 0)
      val last = lastClockReference(tail)
      val sequence = indexOf(head, SEQUENCE_HEADER)
      val width: Int?
      val height: Int?
      if (sequence >= 0 && sequence + 7 <= head.size) {
        width = ((head[sequence + 4].toInt() and 0xFF) shl 4) or ((head[sequence + 5].toInt() and 0xFF) shr 4)
        height = ((head[sequence + 5].toInt() and 0x0F) shl 8) or (head[sequence + 6].toInt() and 0xFF)
      } else {
        width = null
        height = null
      }
      val mpeg2Video = sequence >= 0 && indexOf(head, SEQUENCE_EXTENSION, sequence).let { it >= 0 && it < sequence + 512 }
      Info(
        durationMs = if (first != null && last != null && last > first) (last - first) / 90 else null,
        width = width?.takeIf { it > 0 },
        height = height?.takeIf { it > 0 },
        videoCodec = if (sequence < 0) null else if (mpeg2Video) "video/mpeg2" else "video/mpeg",
        hasVideo = hasVideoStream(head, head.size),
      )
    }
  }.getOrNull()

  /** The SCR (90 kHz) of the pack header at [at], MPEG-1 or MPEG-2; null when it is not one. */
  private fun clockReference(data: ByteArray, at: Int): Long? {
    if (packHeaderLength(data, at) == null) return null
    val b = IntArray(5) { data[at + 4 + it].toInt() and 0xFF }
    return if (b[0] and 0xC0 == 0x40) {
      (((b[0] shr 3) and 0x7).toLong() shl 30) or ((b[0] and 0x3).toLong() shl 28) or (b[1].toLong() shl 20) or
        (((b[2] shr 3) and 0x1F).toLong() shl 15) or ((b[2] and 0x3).toLong() shl 13) or (b[3].toLong() shl 5) or
        ((b[4] shr 3) and 0x1F).toLong()
    } else {
      (((b[0] shr 1) and 0x7).toLong() shl 30) or ((((b[1] shl 7) or (b[2] shr 1)) and 0x7FFF).toLong() shl 15) or
        (((b[3] shl 7) or (b[4] shr 1)) and 0x7FFF).toLong()
    }
  }

  /** The SCR of the last whole pack header in [data]. */
  private fun lastClockReference(data: ByteArray): Long? {
    var i = data.size - 14
    while (i >= 0) {
      if (isStartCode(data, i) && data[i + 3].toInt() and 0xFF == PACK_START) clockReference(data, i)?.let { return it }
      i--
    }
    return null
  }

  private fun indexOf(data: ByteArray, needle: ByteArray, from: Int = 0): Int {
    outer@ for (i in from..data.size - needle.size) {
      for (j in needle.indices) if (data[i + j] != needle[j]) continue@outer
      return i
    }
    return -1
  }

  private val SEQUENCE_HEADER = byteArrayOf(0, 0, 1, 0xB3.toByte())
  private val SEQUENCE_EXTENSION = byteArrayOf(0, 0, 1, 0xB5.toByte())
  private const val HEAD_SCAN_BYTES = 1024 * 1024
  private const val TAIL_SCAN_BYTES = 256 * 1024L

  /** [isScrambled] over the first [maxBytes] of a file. */
  fun isScrambled(file: File, maxBytes: Int = SCRAMBLING_SCAN_BYTES): Boolean = runCatching {
    RandomAccessFile(file, "r").use { raf ->
      val size = minOf(raf.length(), maxBytes.toLong()).toInt()
      val buffer = ByteArray(size)
      raf.readFully(buffer)
      isScrambled(buffer, size)
    }
  }.getOrDefault(false)

  /** Audio (`C0`–`DF`), video (`E0`–`EF`) or private stream 1 (`BD`: DVD AC-3/LPCM/DTS). */
  private fun isElementary(id: Int): Boolean = id == PRIVATE_STREAM_1 || id in 0xC0..0xEF

  private fun isStartCode(data: ByteArray, at: Int): Boolean =
    data[at].toInt() == 0 && data[at + 1].toInt() == 0 && data[at + 2].toInt() == 1

  private fun nextPackStart(data: ByteArray, from: Int, length: Int): Int? {
    var i = from
    while (i + 4 <= length) {
      if (isStartCode(data, i) && data[i + 3].toInt() and 0xFF == PACK_START) return i
      i++
    }
    return null
  }

  /** The pack header at [at]: 12 bytes (MPEG-1) or 14 plus its stuffing (MPEG-2); null when it is not one. */
  private fun packHeaderLength(data: ByteArray, at: Int, length: Int = data.size): Int? {
    if (at + 5 > length || !isStartCode(data, at) || data[at + 3].toInt() and 0xFF != PACK_START) return null
    val marker = data[at + 4].toInt() and 0xFF
    return when {
      marker and 0xC0 == 0x40 -> if (at + 14 <= length) 14 + (data[at + 13].toInt() and 0x07) else null
      marker and 0xF0 == 0x20 -> 12
      else -> null
    }
  }
}
