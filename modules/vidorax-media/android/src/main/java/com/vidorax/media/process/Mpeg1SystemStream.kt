package com.vidorax.media.process

import com.vidorax.media.model.DownloadErrorCode
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * MPEG-1 system streams (ISO/IEC 11172-1) re-packaged as MPEG-2 program streams (13818-1), payload untouched (F4).
 * Media3's PS extractor reads only MPEG-2 packaging, yet many `.mpg` files — VCDs and most older ones — are MPEG-1.
 * Only the headers differ: a 12-byte pack header becomes the 14-byte one (same clock reference and mux rate), and each
 * packet's MPEG-1 header (stuffing, buffer size, PTS/DTS) becomes the MPEG-2 PES header with the same PTS/DTS. System
 * headers, padding and private-stream-2 packets are copied as they are.
 */
internal object Mpeg1SystemStream {
  private const val PACK_START = 0xBA
  private const val SYSTEM_HEADER = 0xBB
  private const val PROGRAM_END = 0xB9
  private const val PADDING = 0xBE
  private const val PRIVATE_STREAM_2 = 0xBF
  private const val PROGRAM_STREAM_MAP = 0xBC
  private const val MAX_PACKET = 0xFFFF

  /** The file starts with an MPEG-1 pack header (`0010` after the start code). */
  fun isMpeg1(file: File): Boolean = runCatching {
    FileInputStream(file).use { stream ->
      val head = ByteArray(5)
      stream.read(head) == 5 && head[0].toInt() == 0 && head[1].toInt() == 0 && head[2].toInt() == 1 &&
        head[3].toInt() and 0xFF == PACK_START && head[4].toInt() and 0xF0 == 0x20
    }
  }.getOrDefault(false)

  /**
   * Writes [input] as an MPEG-2 program stream to [output]. Bytes between packets that are not a start code (damage,
   * trailing junk) are skipped. Throws [ProcessingException] when nothing could be read; [ensureActive] is called
   * between packets.
   */
  fun rewrap(input: File, output: File, ensureActive: () -> Unit = {}) {
    output.delete()
    var packets = 0
    try {
      BufferedInputStream(FileInputStream(input), BUFFER_BYTES).use { source ->
        BufferedOutputStream(FileOutputStream(output), BUFFER_BYTES).use { sink ->
          val reader = Reader(source)
          val payload = ByteArray(MAX_PACKET)
          while (true) {
            val id = reader.nextStartCode() ?: break
            if (packets % 256 == 0) ensureActive()
            when {
              id == PACK_START -> writePackHeader(reader, sink)
              id == PROGRAM_END -> sink.write(startCode(PROGRAM_END))
              id < SYSTEM_HEADER -> continue // a start code inside damaged data: look for the next packet
              id == SYSTEM_HEADER || id == PADDING || id == PRIVATE_STREAM_2 || id == PROGRAM_STREAM_MAP || id >= 0xF0 -> {
                // Same syntax in MPEG-1 and MPEG-2: copied as it is.
                val length = reader.u16()
                reader.readFully(payload, length)
                sink.write(startCode(id))
                sink.write(length ushr 8)
                sink.write(length and 0xFF)
                sink.write(payload, 0, length)
              }
              else -> writePesPacket(id, reader, sink, payload)
            }
            packets++
          }
        }
      }
    } catch (e: ProcessingException) {
      output.delete()
      throw e
    } catch (e: EOFException) {
      // A cut last packet: every whole packet before it is already written.
      if (packets > 0) return
      output.delete()
      throw ProcessingException(DownloadErrorCode.INVALID_MEDIA, "not an MPEG-1 system stream", e)
    } catch (e: Exception) {
      output.delete()
      throw ProcessingException(DownloadErrorCode.INVALID_MEDIA, "the MPEG-1 system stream could not be read: ${e.message}", e)
    }
    if (packets == 0) {
      output.delete()
      throw ProcessingException(DownloadErrorCode.INVALID_MEDIA, "no MPEG-1 system stream packets")
    }
  }

  /** MPEG-1 pack header (after its start code: 8 bytes) → MPEG-2 pack header (10 bytes, no stuffing). */
  private fun writePackHeader(reader: Reader, sink: OutputStream) {
    val h = reader.bytes(8)
    if (h[0] and 0xF0 != 0x20) {
      // Already MPEG-2 (a mixed file): the rest of its header and its stuffing follow as they are.
      val rest = reader.bytes(2)
      val stuffing = reader.bytes(rest[1] and 0x07)
      sink.write(startCode(PACK_START))
      h.forEach { sink.write(it) }
      rest.forEach { sink.write(it) }
      stuffing.forEach { sink.write(it) }
      return
    }
    // SCR: 3 + 15 + 15 bits across bytes 0–4; mux rate: 22 bits across bytes 5–7.
    val scr = (((h[0] shr 1) and 0x7).toLong() shl 30) or
      ((((h[1] shl 7) or (h[2] shr 1)) and 0x7FFF).toLong() shl 15) or
      (((h[3] shl 7) or (h[4] shr 1)) and 0x7FFF).toLong()
    val muxRate = ((h[5] and 0x7F) shl 15) or (h[6] shl 7) or (h[7] shr 1)
    sink.write(startCode(PACK_START))
    // '01', SCR_base[32..30], marker, SCR_base[29..28]
    sink.write(0x40 or (((scr shr 30) and 0x7).toInt() shl 3) or 0x04 or ((scr shr 28) and 0x3).toInt())
    sink.write(((scr shr 20) and 0xFF).toInt())
    // SCR_base[19..15], marker, SCR_base[14..13]
    sink.write((((scr shr 15) and 0x1F).toInt() shl 3) or 0x04 or ((scr shr 13) and 0x3).toInt())
    sink.write(((scr shr 5) and 0xFF).toInt())
    // SCR_base[4..0], marker, SCR_extension[8..7] = 0
    sink.write(((scr and 0x1F).toInt() shl 3) or 0x04)
    // SCR_extension[6..0] = 0, marker
    sink.write(0x01)
    // program_mux_rate (22 bits), marker, marker
    sink.write((muxRate shr 14) and 0xFF)
    sink.write((muxRate shr 6) and 0xFF)
    sink.write(((muxRate and 0x3F) shl 2) or 0x03)
    // reserved (5 bits), pack_stuffing_length = 0
    sink.write(0xF8)
  }

  /** One MPEG-1 packet → the same packet with an MPEG-2 PES header. */
  private fun writePesPacket(id: Int, reader: Reader, sink: OutputStream, payload: ByteArray) {
    val length = reader.u16()
    if (length == 0) {
      sink.write(startCode(id))
      sink.write(0)
      sink.write(0)
      return
    }
    var used = 0
    var b = reader.u8().also { used++ }
    while (b == 0xFF && used < length) b = reader.u8().also { used++ } // stuffing
    if (b and 0xC0 == 0x40) { // STD buffer scale and size: dropped (MPEG-2 PES has no such field here)
      reader.u8()
      used++
      b = reader.u8().also { used++ }
    }
    val timestamps: ByteArray
    val ptsDtsFlags: Int
    when {
      b and 0xF0 == 0x20 -> { // PTS
        timestamps = byteArrayOf(b.toByte()) + reader.bytesAsArray(4)
        used += 4
        ptsDtsFlags = 0x80
      }
      b and 0xF0 == 0x30 -> { // PTS and DTS
        timestamps = byteArrayOf(b.toByte()) + reader.bytesAsArray(9)
        used += 9
        ptsDtsFlags = 0xC0
      }
      b and 0xC0 == 0x80 -> { // already an MPEG-2 PES header
        val rest = reader.bytesAsArray(length - used)
        sink.write(startCode(id))
        sink.write(length ushr 8)
        sink.write(length and 0xFF)
        sink.write(b)
        sink.write(rest)
        return
      }
      else -> { // '0000 1111': no time stamps
        timestamps = ByteArray(0)
        ptsDtsFlags = 0x00
      }
    }
    if (used > length) throw ProcessingException(DownloadErrorCode.INVALID_MEDIA, "an MPEG-1 packet header is longer than its packet")
    val dataLength = length - used
    reader.readFully(payload, dataLength)
    val newLength = 3 + timestamps.size + dataLength
    if (newLength > MAX_PACKET) throw ProcessingException(DownloadErrorCode.INVALID_MEDIA, "an MPEG-1 packet is too long to re-package")
    sink.write(startCode(id))
    sink.write(newLength ushr 8)
    sink.write(newLength and 0xFF)
    sink.write(0x80) // '10', not scrambled, no priority/alignment/copyright flags
    sink.write(ptsDtsFlags)
    sink.write(timestamps.size)
    sink.write(timestamps)
    sink.write(payload, 0, dataLength)
  }

  private fun startCode(id: Int) = byteArrayOf(0, 0, 1, id.toByte())

  private class Reader(private val input: InputStream) {
    /** The id after the next `00 00 01`, or null at the end of the file. */
    fun nextStartCode(): Int? {
      var zeros = 0
      while (true) {
        val b = input.read()
        if (b < 0) return null
        when {
          b == 0 -> zeros++
          b == 1 && zeros >= 2 -> return input.read().takeIf { it >= 0 }
          else -> zeros = 0
        }
      }
    }

    fun u8(): Int = input.read().also { if (it < 0) throw EOFException() }

    fun u16(): Int = (u8() shl 8) or u8()

    fun bytes(count: Int): IntArray = IntArray(count) { u8() }

    fun bytesAsArray(count: Int): ByteArray = ByteArray(count).also { readFully(it, count) }

    fun readFully(into: ByteArray, count: Int) {
      var done = 0
      while (done < count) {
        val n = input.read(into, done, count - done)
        if (n < 0) throw EOFException()
        done += n
      }
    }
  }

  private const val BUFFER_BYTES = 256 * 1024
}
