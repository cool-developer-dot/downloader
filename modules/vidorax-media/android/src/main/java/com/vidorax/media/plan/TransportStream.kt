package com.vidorax.media.plan

import java.io.File
import java.io.RandomAccessFile

/**
 * What an MPEG transport stream's first packets prove (a `.ts` file, or the file an HLS download assembled from TS
 * segments): whether its packets are scrambled — conditional access, which VidoraX never decrypts — and which kinds of
 * track its program map lists. Pure and bounded; packets are read only while they stay aligned on the 188-byte grid.
 */
internal object TransportStream {
  private const val PACKET = 188
  private const val SYNC = 0x47
  private const val PAT_PID = 0
  private const val NULL_PID = 0x1FFF
  private const val PAT_TABLE_ID = 0x00
  private const val PMT_TABLE_ID = 0x02

  /** How far into a finished file [isScrambled] looks: a broadcast recording can turn scrambled after a clear start. */
  const val SCRAMBLING_SCAN_BYTES = 4 * 1024 * 1024

  /** ISO/IEC 13818-1 and ATSC stream types that carry a picture (MPEG-1/2, MPEG-4 Part 2, H.264, HEVC, VVC, AVS, VC-1…). */
  private val VIDEO_STREAM_TYPES = setOf(0x01, 0x02, 0x10, 0x1B, 0x20, 0x24, 0x33, 0x42, 0xD1, 0xEA)

  /** Stream types that carry sound (MPEG audio, AAC ADTS/LATM, AC-3, E-AC-3, DTS, TrueHD…). */
  private val AUDIO_STREAM_TYPES = setOf(0x03, 0x04, 0x0F, 0x11, 0x1C, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87)

  /** DVB descriptors that make a private-data stream (type 0x06) sound: AC-3, E-AC-3, DTS, AAC. */
  private val AUDIO_DESCRIPTOR_TAGS = setOf(0x6A, 0x7A, 0x7B, 0x7C)

  /** What the program map lists; null fields never occur — a stream with no readable map has no [Tracks] at all. */
  data class Tracks(val hasVideo: Boolean, val hasAudio: Boolean)

  private class Packet(val pid: Int, val payloadStart: Boolean, val scrambled: Boolean, val payloadFrom: Int, val end: Int)

  /** A packet with a payload whose scrambling bits are set. Null packets are padding and say nothing. */
  fun isScrambled(data: ByteArray, length: Int = data.size): Boolean =
    packets(data, length).any { it.pid != NULL_PID && it.scrambled && it.payloadFrom < it.end }

  /** [isScrambled] over the first [maxBytes] of a finished file; false when the file cannot be read. */
  fun isScrambled(file: File, maxBytes: Int = SCRAMBLING_SCAN_BYTES): Boolean = runCatching {
    RandomAccessFile(file, "r").use { raf ->
      val size = minOf(raf.length(), maxBytes.toLong()).toInt()
      val buffer = ByteArray(size)
      raf.readFully(buffer)
      isScrambled(buffer, size)
    }
  }.getOrDefault(false)

  /**
   * The kinds of track every program map in [data] lists, or null when no complete program map is there (the map is
   * normally repeated within the first packets; a file without one proves nothing from its start).
   */
  fun tracks(data: ByteArray): Tracks? {
    val all = packets(data, data.size)
    val pmtPids = all.asSequence()
      .filter { it.pid == PAT_PID && it.payloadStart }
      .mapNotNull { section(data, it, PAT_TABLE_ID) }
      .map { programMapPids(data, it) }
      .firstOrNull { it.isNotEmpty() } ?: return null
    var found = false
    var video = false
    var audio = false
    for (packet in all) {
      if (packet.pid !in pmtPids || !packet.payloadStart) continue
      val pmt = section(data, packet, PMT_TABLE_ID) ?: continue
      val kinds = streamKinds(data, pmt)
      found = true
      video = video || kinds.hasVideo
      audio = audio || kinds.hasAudio
    }
    return if (found) Tracks(hasVideo = video, hasAudio = audio) else null
  }

  /** The packets aligned from offset 0, stopping at the first one that lost sync or runs past [length]. */
  private fun packets(data: ByteArray, length: Int): List<Packet> {
    val result = ArrayList<Packet>()
    var at = 0
    while (at + PACKET <= minOf(length, data.size) && data[at].toInt() and 0xFF == SYNC) {
      val b1 = data[at + 1].toInt() and 0xFF
      val b3 = data[at + 3].toInt() and 0xFF
      val adaptation = (b3 shr 4) and 0x03
      var payload = at + 4
      if (adaptation == 2 || adaptation == 3) payload += 1 + (data[at + 4].toInt() and 0xFF)
      val end = at + PACKET
      result += Packet(
        pid = ((b1 and 0x1F) shl 8) or (data[at + 2].toInt() and 0xFF),
        payloadStart = b1 and 0x40 != 0,
        scrambled = (b3 shr 6) and 0x03 != 0,
        payloadFrom = if (adaptation == 1 || adaptation == 3) minOf(payload, end) else end,
        end = end,
      )
      at = end
    }
    return result
  }

  /** A section's body range `[start, end)` (after its 3-byte header, before the CRC) when it fits in [packet]. */
  private fun section(data: ByteArray, packet: Packet, tableId: Int): IntRange? {
    if (packet.payloadFrom >= packet.end) return null
    val start = packet.payloadFrom + 1 + (data[packet.payloadFrom].toInt() and 0xFF)
    if (start + 3 > packet.end || data[start].toInt() and 0xFF != tableId) return null
    val sectionLength = ((data[start + 1].toInt() and 0x0F) shl 8) or (data[start + 2].toInt() and 0xFF)
    val end = start + 3 + sectionLength - 4
    if (sectionLength < 9 || end > packet.end) return null
    return (start + 3) until end
  }

  /** PAT body: transport_stream_id, version, section numbers (5 bytes), then 4-byte program entries. */
  private fun programMapPids(data: ByteArray, body: IntRange): Set<Int> {
    val pids = HashSet<Int>()
    var at = body.first + 5
    while (at + 4 <= body.last + 1) {
      val program = ((data[at].toInt() and 0xFF) shl 8) or (data[at + 1].toInt() and 0xFF)
      val pid = ((data[at + 2].toInt() and 0x1F) shl 8) or (data[at + 3].toInt() and 0xFF)
      if (program != 0) pids += pid
      at += 4
    }
    return pids
  }

  /** PMT body: program number, version, section numbers, PCR PID, program info, then the elementary streams. */
  private fun streamKinds(data: ByteArray, body: IntRange): Tracks {
    val end = body.last + 1
    if (body.first + 9 > end) return Tracks(hasVideo = false, hasAudio = false)
    val infoLength = ((data[body.first + 7].toInt() and 0x0F) shl 8) or (data[body.first + 8].toInt() and 0xFF)
    var at = body.first + 9 + infoLength
    var video = false
    var audio = false
    while (at + 5 <= end) {
      val type = data[at].toInt() and 0xFF
      val esInfoLength = ((data[at + 3].toInt() and 0x0F) shl 8) or (data[at + 4].toInt() and 0xFF)
      val descriptors = (at + 5) until minOf(at + 5 + esInfoLength, end)
      when {
        type in VIDEO_STREAM_TYPES -> video = true
        type in AUDIO_STREAM_TYPES -> audio = true
        type == 0x06 && hasAudioDescriptor(data, descriptors) -> audio = true
      }
      at += 5 + esInfoLength
    }
    return Tracks(hasVideo = video, hasAudio = audio)
  }

  private fun hasAudioDescriptor(data: ByteArray, range: IntRange): Boolean {
    var at = range.first
    while (at + 2 <= range.last + 1) {
      if (data[at].toInt() and 0xFF in AUDIO_DESCRIPTOR_TAGS) return true
      at += 2 + (data[at + 1].toInt() and 0xFF)
    }
    return false
  }
}
