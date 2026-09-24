package com.vidorax.media.plan

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure

/** What the first bytes of a resource prove about it. Pure and offline so it is exhaustively unit-testable. */
internal sealed interface SniffResult {
  /** A complete, downloadable progressive file in one of the contract's supported containers. */
  data class Supported(val container: Container) : SniffResult

  /** Recognised but out of scope (DASH, HLS, MKV, TS, isolated fragment), encrypted, or not media at all. */
  data class Unsupported(val reason: ProbeFailure, val detail: String) : SniffResult
}

/**
 * Classifies a resource from its leading bytes, Content-Type and URL against the VidoraX download contract
 * (docs/ARCHITECTURE.md section 1). Supported progressive containers only: MP4/M4V/MOV/WebM/AVI/WMV and complete
 * standalone fMP4. Everything else — DASH, HLS, encrypted media, isolated init/media fragments, live, unknown —
 * is rejected with a reason. Magic bytes win over Content-Type, which servers routinely get wrong.
 */
internal object MediaSniffer {
  /** ISO-BMFF boxes that carry sample data; their presence proves a file is not an init-only segment. */
  private val MEDIA_BOXES = setOf("mdat", "moof")

  /** ftyp brands that mark Common Encryption / PIFF / OMA DRM. */
  private val DRM_BRANDS = setOf("cenc", "cbc1", "cbcs", "cens", "piff", "pdcf", "odcf")

  /** ftyp major brands of Apple's audio files: AAC music (.m4a) and audiobooks (.m4b). */
  private val AUDIO_BRANDS = setOf("M4A", "M4B")

  /** ISO-BMFF boxes that indicate an isolated media segment (no ftyp of its own). */
  private val FRAGMENT_FIRST_BOXES = setOf("styp", "moof", "sidx")

  private val ASF_HEADER_GUID = byteArrayOf(
    0x30, 0x26, 0xB2.toByte(), 0x75, 0x8E.toByte(), 0x66, 0xCF.toByte(), 0x11,
    0xA6.toByte(), 0xD9.toByte(), 0x00, 0xAA.toByte(), 0x00, 0x62, 0xCE.toByte(), 0x6C,
  )

  /**
   * @param prefix   the leading bytes of the resource (a bounded probe read).
   * @param totalSize the full resource length when known (Content-Range/Content-Length), else null.
   * @param allowTransportStream true only for a file an HLS download assembled from MPEG-TS segments. A bare TS
   *   URL is still refused as a progressive source.
   */
  fun sniff(
    prefix: ByteArray,
    contentType: String?,
    url: String,
    totalSize: Long?,
    allowTransportStream: Boolean = false,
  ): SniffResult {
    if (prefix.isEmpty()) return notMedia("empty response body")

    isoBmff(prefix, url, totalSize)?.let { return it }
    if (startsWith(prefix, 0, "Eß£")) return ebml(prefix)
    if (matchesAscii(prefix, 0, "RIFF") && matchesAscii(prefix, 8, "AVI ")) return SniffResult.Supported(Container.AVI)
    if (startsWithBytes(prefix, ASF_HEADER_GUID)) return SniffResult.Supported(Container.WMV)
    if (isTransportStream(prefix)) {
      if (!allowTransportStream) return unsupported("MPEG-TS is not a supported progressive container")
      return if (hasTransportStreamSync(prefix)) SniffResult.Supported(Container.TS)
      else unsupported("MPEG-TS stream lost packet sync")
    }
    if (matchesAscii(prefix, 0, "FLV")) return unsupported("FLV is not a supported container")
    audioFileVerdict(prefix)?.let { return it }

    textVerdict(prefix, contentType)?.let { return it }
    contentTypeVerdict(contentType)?.let { return it }
    return unsupported("unrecognized container")
  }

  /** The bytes are an HLS playlist (`#EXTM3U` after an optional BOM and whitespace), whatever the URL says. */
  fun isHlsPlaylist(prefix: ByteArray): Boolean = leadingText(prefix).startsWith("#extm3u")

  /**
   * The bytes are an MPEG-DASH manifest — markup whose root element is `MPD` — whatever the URL or Content-Type
   * says. An XML declaration and comments may come first, so a larger window than the other text checks is read.
   */
  fun isDashManifest(prefix: ByteArray): Boolean {
    val head = leadingText(prefix, DASH_WINDOW)
    return head.startsWith("<") && MPD_ROOT.containsMatchIn(head)
  }

  /**
   * The MP4/MOV's whole `moov` is in [prefix] and its tracks are sound only: an audio file, or the audio half of a
   * stream split into separate audio and video files — not a video. False whenever the track list is not in the
   * prefix (then only the finished file can tell).
   */
  fun isAudioOnly(prefix: ByteArray): Boolean {
    trackHandlers(prefix)?.let { handlers -> return "soun" in handlers && "vide" !in handlers }
    val webm = webmTrackTypes(prefix) ?: return false
    return WEBM_TRACK_AUDIO in webm && WEBM_TRACK_VIDEO !in webm
  }

  /** Common Encryption evidence (DRM brands, `pssh`/`tenc`/`sinf`) in ISO-BMFF bytes such as an HLS init section. */
  fun hasEncryptionEvidence(prefix: ByteArray): Boolean = hasDrmEvidence(prefix, topLevelBoxes(prefix))

  /**
   * An MP4/MOV saved without "fast start" keeps its `moov` after the media data, out of the probe's reach. When
   * [prefix] is such a file — its top-level boxes run past the prefix and none of them is a `moov` — this is the offset
   * of the first box beyond the prefix, where the track list is expected. Null when the prefix already holds the
   * `moov`, is not ISO-BMFF, or a box's extent is unknown.
   */
  fun trailingBoxesOffset(prefix: ByteArray): Long? {
    if (ascii(prefix, 4, 4) != "ftyp") return null
    var off = 0L
    var boxes = 0
    while (off + 8 <= prefix.size && boxes < MAX_PREFIX_BOXES) {
      val at = off.toInt()
      val size32 = beU32(prefix, at) ?: return null
      val type = ascii(prefix, at + 4, 4) ?: return null
      if (type == "moov" || type == "moof") return null
      val size = when (size32) {
        0L -> return null // runs to the end of the file: nothing follows it
        1L -> beU64(prefix, at + 8) ?: return null
        else -> size32
      }
      if (size < 8) return null
      off += size
      boxes++
    }
    // A box header cut by the end of the prefix proves nothing; only a walk that left the prefix does.
    return if (off >= prefix.size) off else null
  }

  /**
   * What the boxes read at [trailingBoxesOffset] prove: `DRM_PROTECTED` when the `moov` carries encryption boxes
   * (encrypted sample entries, `sinf`/`tenc`, `pssh`), `UNSUPPORTED_FORMAT` when the whole track list is there and has
   * sound but no video (an audio file, or the audio half of a split stream); null when they prove nothing — no `moov`
   * among them, or a clear video.
   */
  fun trailingMoovVerdict(tail: ByteArray): SniffResult.Unsupported? {
    val moov = childBoxes(tail, 0, tail.size.toLong()).firstOrNull { it.type == "moov" } ?: return null
    val end = minOf(moov.end, tail.size.toLong()).toInt()
    if (MOOV_ENCRYPTION_BOXES.any { containsAscii(tail, it, moov.bodyStart, end) }) {
      return SniffResult.Unsupported(ProbeFailure.DRM_PROTECTED, "encrypted (DRM) media")
    }
    val handlers = trackHandlers(tail) ?: return null
    return if ("soun" in handlers && "vide" !in handlers) unsupported("Audio only: the file has no video track") else null
  }

  // --- ISO base media file format (MP4 / M4V / MOV / fMP4) ---

  private fun isoBmff(data: ByteArray, url: String, totalSize: Long?): SniffResult? {
    if (data.size < 8) return null
    val firstType = ascii(data, 4, 4) ?: return null
    if (firstType in FRAGMENT_FIRST_BOXES) {
      return unsupported("isolated media fragment (no ftyp); a complete file is required")
    }
    if (firstType != "ftyp") return null

    val boxes = topLevelBoxes(data)
    if (hasDrmEvidence(data, boxes)) return SniffResult.Unsupported(ProbeFailure.DRM_PROTECTED, "encrypted (DRM) media")
    // An audio brand names an audio file even when its track list is stored at the end, out of the probe's reach.
    if (ascii(data, 8, 4)?.trim() in AUDIO_BRANDS) return unsupported("audio-only file (M4A), not a video")

    val mediaPresent = boxes.types.any { it in MEDIA_BOXES }
    val coversWholeFile = totalSize != null && data.size.toLong() >= totalSize && !boxes.extendsBeyondPrefix
    if (!mediaPresent && coversWholeFile) {
      return unsupported("isolated init segment (no media samples); a complete file is required")
    }
    // Otherwise: media data is present, or the file continues past the probe (large MP4 whose mdat/moov is
    // beyond the initial read) — accept and let container come from the ftyp brand.
    return SniffResult.Supported(containerFromFtyp(data, url))
  }

  private fun containerFromFtyp(data: ByteArray, url: String): Container {
    val majorBrand = ascii(data, 8, 4)?.trim()
    if (majorBrand == "qt") return Container.MOV
    if (url.substringBefore('?').endsWith(".mov", ignoreCase = true)) return Container.MOV
    return Container.MP4
  }

  private fun hasDrmEvidence(data: ByteArray, boxes: TopLevelBoxes): Boolean {
    if (brands(data).any { it in DRM_BRANDS }) return true
    // Common Encryption leaves these four-char codes in the moov/traf; a bounded raw scan is enough to refuse.
    return containsAscii(data, "pssh") || containsAscii(data, "tenc") || containsAscii(data, "sinf")
  }

  /** Major brand plus compatible brands from the ftyp box. */
  private fun brands(data: ByteArray): List<String> {
    val ftypSize = beU32(data, 0)?.toInt() ?: return emptyList()
    val end = minOf(ftypSize, data.size)
    val result = mutableListOf<String>()
    var off = 8
    while (off + 4 <= end) {
      ascii(data, off, 4)?.trim()?.let { if (it.isNotEmpty()) result.add(it) }
      off += 4
    }
    return result
  }

  /** Handler types (`vide`, `soun`, `text`, …) of the tracks when the whole `moov` is in [data]; null otherwise. */
  fun trackHandlers(data: ByteArray): Set<String>? {
    val moov = childBoxes(data, 0, data.size.toLong()).firstOrNull { it.type == "moov" } ?: return null
    if (moov.end > data.size) return null
    val handlers = mutableSetOf<String>()
    for (trak in childBoxes(data, moov.bodyStart, moov.end)) {
      if (trak.type != "trak") continue
      val mdia = childBoxes(data, trak.bodyStart, trak.end).firstOrNull { it.type == "mdia" } ?: continue
      val hdlr = childBoxes(data, mdia.bodyStart, mdia.end).firstOrNull { it.type == "hdlr" } ?: continue
      // Version/flags, then pre_defined (ISO) or the component type (QuickTime), then the handler type.
      if (hdlr.bodyStart + 12 <= hdlr.end) ascii(data, hdlr.bodyStart + 8, 4)?.let { handlers += it }
    }
    return handlers
  }

  private class Box(val type: String, val bodyStart: Int, val end: Long)

  /**
   * The boxes directly inside `[from, to)`; the last may end past [data] (a truncated read). Stops at a box of
   * unknown extent (size 0 = "to the end of the file") or a malformed size.
   */
  private fun childBoxes(data: ByteArray, from: Int, to: Long): List<Box> {
    val boxes = mutableListOf<Box>()
    var off = from.toLong()
    val limit = minOf(to, data.size.toLong())
    while (off + 8 <= limit) {
      val at = off.toInt()
      val size32 = beU32(data, at) ?: break
      val type = ascii(data, at + 4, 4) ?: break
      val header = if (size32 == 1L) 16 else 8
      val size = when (size32) {
        0L -> break
        1L -> beU64(data, at + 8) ?: break
        else -> size32
      }
      if (size < header) break
      boxes += Box(type, at + header, off + size)
      off += size
    }
    return boxes
  }

  private data class TopLevelBoxes(val types: List<String>, val extendsBeyondPrefix: Boolean)

  private fun topLevelBoxes(data: ByteArray): TopLevelBoxes {
    val types = mutableListOf<String>()
    var off = 0
    while (off + 8 <= data.size) {
      val size32 = beU32(data, off) ?: break
      val type = ascii(data, off + 4, 4) ?: break
      types.add(type)
      val boxSize: Long = when (size32) {
        0L -> return TopLevelBoxes(types, extendsBeyondPrefix = true) // extends to EOF
        1L -> beU64(data, off + 8) ?: break // 64-bit largesize
        else -> size32
      }
      if (boxSize < 8) break // malformed
      val next = off + boxSize
      if (next > data.size) return TopLevelBoxes(types, extendsBeyondPrefix = true)
      off = next.toInt()
    }
    return TopLevelBoxes(types, extendsBeyondPrefix = false)
  }

  // --- EBML (WebM / Matroska) ---

  private fun ebml(data: ByteArray): SniffResult {
    // DocType lives shortly after the EBML header. Only "webm" is in scope; "matroska" (generic MKV) is not.
    val head = String(data, 0, minOf(data.size, 1024), Charsets.ISO_8859_1)
    return when {
      head.contains("webm") ->
        if (hasWebmEncryption(data)) SniffResult.Unsupported(ProbeFailure.DRM_PROTECTED, "encrypted (DRM) WebM")
        else SniffResult.Supported(Container.WEBM)
      head.contains("matroska") -> unsupported("Matroska (MKV) is not a supported container")
      else -> unsupported("EBML stream with an unrecognized DocType")
    }
  }

  /**
   * Encrypted WebM (WebM Encryption / Widevine) declares a ContentEncryption element with an algorithm or key id
   * inside ContentEncodings in the track headers, all before the first Cluster.
   */
  private fun hasWebmEncryption(data: ByteArray): Boolean {
    val headerEnd = indexOf(data, EBML_CLUSTER, 0, data.size).let { if (it < 0) data.size else it }
    val encodings = indexOf(data, EBML_CONTENT_ENCODINGS, 0, headerEnd)
    if (encodings < 0) return false
    val encryption = indexOf(data, EBML_CONTENT_ENCRYPTION, encodings, headerEnd)
    if (encryption < 0) return false
    return indexOf(data, EBML_CONTENT_ENC_ALGO, encryption, headerEnd) >= 0 ||
      indexOf(data, EBML_CONTENT_ENC_KEY_ID, encryption, headerEnd) >= 0
  }

  /**
   * The WebM's track types (1 = video, 2 = audio) when its whole `Tracks` element is in [data]; null otherwise.
   * Walks the EBML structure (EBML header → Segment → Tracks → TrackEntry → TrackType) rather than scanning for
   * byte patterns, so codec private data can never be mistaken for a track.
   */
  private fun webmTrackTypes(data: ByteArray): Set<Long>? {
    val header = ebmlElement(data, 0) ?: return null
    if (header.id != EBML_HEADER_ID || header.end > data.size) return null
    val segment = ebmlElement(data, header.end.toInt()) ?: return null
    if (segment.id != EBML_SEGMENT_ID) return null
    val segmentEnd = if (segment.size == null) data.size.toLong() else minOf(segment.end, data.size.toLong())
    var off = segment.bodyStart.toLong()
    while (off < segmentEnd) {
      val element = ebmlElement(data, off.toInt()) ?: return null
      if (element.id == EBML_TRACKS_ID) return if (element.size == null || element.end > data.size) null else trackTypes(data, element)
      // Media before the track list, or an element of unknown size: the prefix cannot tell.
      if (element.id == EBML_CLUSTER_ID || element.size == null) return null
      off = element.end
    }
    return null
  }

  private fun trackTypes(data: ByteArray, tracks: EbmlElement): Set<Long> {
    val types = mutableSetOf<Long>()
    var off = tracks.bodyStart.toLong()
    while (off < tracks.end) {
      val entry = ebmlElement(data, off.toInt()) ?: break
      if (entry.size == null || entry.end > tracks.end) break
      if (entry.id == EBML_TRACK_ENTRY_ID) {
        var child = entry.bodyStart.toLong()
        while (child < entry.end) {
          val field = ebmlElement(data, child.toInt()) ?: break
          if (field.size == null || field.end > entry.end) break
          if (field.id == EBML_TRACK_TYPE_ID) types += unsignedValue(data, field)
          child = field.end
        }
      }
      off = entry.end
    }
    return types
  }

  private class EbmlElement(val id: Long, val bodyStart: Int, val size: Long?) {
    val end: Long get() = bodyStart + (size ?: 0L)
  }

  /** One EBML element header at [offset]: its ID (marker bits kept) and data size (null = unknown size). */
  private fun ebmlElement(data: ByteArray, offset: Int): EbmlElement? {
    val id = vint(data, offset, keepMarker = true) ?: return null
    val size = vint(data, offset + id.second, keepMarker = false) ?: return null
    val allOnes = (1L shl (7 * size.second)) - 1
    return EbmlElement(id.first, offset + id.second + size.second, size.first.takeIf { it != allOnes })
  }

  /** An EBML variable-length integer: value and byte length. */
  private fun vint(data: ByteArray, offset: Int, keepMarker: Boolean): Pair<Long, Int>? {
    if (offset < 0 || offset >= data.size) return null
    val first = data[offset].toInt() and 0xFF
    if (first == 0) return null
    val length = Integer.numberOfLeadingZeros(first) - 23
    if (length < 1 || length > 8 || offset + length > data.size) return null
    var value = if (keepMarker) first.toLong() else (first and (0xFF ushr length)).toLong()
    for (i in 1 until length) value = (value shl 8) or (data[offset + i].toLong() and 0xFF)
    return value to length
  }

  private fun unsignedValue(data: ByteArray, element: EbmlElement): Long {
    var value = 0L
    val size = (element.size ?: 0L).toInt().coerceAtMost(8)
    for (i in 0 until size) value = (value shl 8) or (data[element.bodyStart + i].toLong() and 0xFF)
    return value
  }

  // --- audio-only files ---

  /**
   * MP3 (an ID3v2 tag or an MPEG audio frame) and raw AAC (ADTS) are audio files, never a video: said by name so the
   * refusal is truthful rather than "unrecognized".
   */
  private fun audioFileVerdict(data: ByteArray): SniffResult? = when {
    matchesAscii(data, 0, "ID3") -> unsupported("audio-only file (MP3), not a video")
    isAdts(data) -> unsupported("audio-only file (AAC), not a video")
    isMpegAudioFrame(data) -> unsupported("audio-only file (MP3), not a video")
    else -> null
  }

  /** ADTS sync (12 bits set), layer 00 — the raw AAC framing used by `.aac` files and HLS packed audio. */
  private fun isAdts(data: ByteArray): Boolean =
    data.size >= 7 && (data[0].toInt() and 0xFF) == 0xFF && (data[1].toInt() and 0xF6) == 0xF0

  /** MPEG-1/2 audio frame sync (11 bits set) with a valid layer, bitrate and sample-rate index. */
  private fun isMpegAudioFrame(data: ByteArray): Boolean {
    if (data.size < 4) return false
    val b1 = data[1].toInt() and 0xFF
    val b2 = data[2].toInt() and 0xFF
    if ((data[0].toInt() and 0xFF) != 0xFF || (b1 and 0xE0) != 0xE0) return false
    val layer = (b1 shr 1) and 0x3
    val bitrate = (b2 shr 4) and 0xF
    val sampleRate = (b2 shr 2) and 0x3
    return layer != 0 && bitrate != 0 && bitrate != 0xF && sampleRate != 0x3
  }

  // --- Transport stream ---

  private fun isTransportStream(data: ByteArray): Boolean {
    if (data.isEmpty() || data[0].toInt() and 0xFF != 0x47) return false
    // A second sync byte one packet later distinguishes TS from a coincidental 0x47.
    return data.size <= 188 || data[188].toInt() and 0xFF == 0x47
  }

  /** Every whole 188-byte packet in the prefix starts with the sync byte: the concatenation is aligned TS. */
  private fun hasTransportStreamSync(data: ByteArray): Boolean {
    val packets = minOf(data.size / TS_PACKET, MAX_TS_PACKETS_CHECKED)
    for (i in 0 until packets) {
      if (data[i * TS_PACKET].toInt() and 0xFF != 0x47) return false
    }
    return true
  }

  // --- Text-based manifests / pages ---

  private fun textVerdict(data: ByteArray, contentType: String?): SniffResult? {
    // leadingText is lowercased, so every needle here must be lowercase too.
    val head = leadingText(data)
    return when {
      head.startsWith("#extm3u") -> unsupported("HLS is handled by the HLS planner, not the progressive path")
      head.contains("<mpd") -> unsupported("DASH is not supported")
      head.startsWith("<!doctype html") || head.startsWith("<html") -> notMedia("HTML page, not media")
      head.startsWith("{") || head.startsWith("[") -> notMedia("JSON response, not media")
      head.startsWith("<?xml") || head.startsWith("<") ->
        if (contentType != null && contentType.contains("dash+xml")) unsupported("DASH is not supported")
        else notMedia("XML/markup, not media")
      else -> null
    }
  }

  private fun contentTypeVerdict(contentType: String?): SniffResult? {
    val type = contentType?.lowercase() ?: return null
    return when {
      type.contains("dash+xml") -> unsupported("DASH is not supported")
      type.contains("mpegurl") -> unsupported("HLS is handled by the HLS planner, not the progressive path")
      type.contains("text/html") || type.contains("application/json") -> notMedia("non-media Content-Type: $type")
      else -> null
    }
  }

  // --- byte helpers ---

  private fun leadingText(data: ByteArray, window: Int = 1024): String {
    var start = 0
    // Skip a UTF-8 BOM.
    if (data.size >= 3 && data[0] == 0xEF.toByte() && data[1] == 0xBB.toByte() && data[2] == 0xBF.toByte()) start = 3
    while (start < data.size && (data[start] == ' '.code.toByte() || data[start] == '\n'.code.toByte() ||
        data[start] == '\r'.code.toByte() || data[start] == '\t'.code.toByte())
    ) {
      start++
    }
    val end = minOf(data.size, start + window)
    return String(data, start, end - start, Charsets.ISO_8859_1).lowercase()
  }

  private fun ascii(data: ByteArray, offset: Int, length: Int): String? {
    if (offset < 0 || offset + length > data.size) return null
    val chars = CharArray(length)
    for (i in 0 until length) {
      val b = data[offset + i].toInt() and 0xFF
      if (b < 0x20 || b > 0x7E) return null
      chars[i] = b.toChar()
    }
    return String(chars)
  }

  private fun matchesAscii(data: ByteArray, offset: Int, text: String): Boolean =
    ascii(data, offset, text.length) == text

  private fun startsWith(data: ByteArray, offset: Int, latin1: String): Boolean {
    if (offset + latin1.length > data.size) return false
    for (i in latin1.indices) if ((data[offset + i].toInt() and 0xFF) != latin1[i].code) return false
    return true
  }

  private fun startsWithBytes(data: ByteArray, prefix: ByteArray): Boolean {
    if (data.size < prefix.size) return false
    for (i in prefix.indices) if (data[i] != prefix[i]) return false
    return true
  }

  private fun indexOf(data: ByteArray, needle: ByteArray, from: Int, to: Int): Int {
    val last = minOf(to, data.size) - needle.size
    outer@ for (i in maxOf(from, 0)..last) {
      for (j in needle.indices) if (data[i + j] != needle[j]) continue@outer
      return i
    }
    return -1
  }

  private val EBML_CLUSTER = byteArrayOf(0x1F, 0x43, 0xB6.toByte(), 0x75)
  private val EBML_CONTENT_ENCODINGS = byteArrayOf(0x6D, 0x80.toByte())
  private val EBML_CONTENT_ENCRYPTION = byteArrayOf(0x50, 0x35)
  private val EBML_CONTENT_ENC_ALGO = byteArrayOf(0x47, 0xE1.toByte())
  private val EBML_CONTENT_ENC_KEY_ID = byteArrayOf(0x47, 0xE2.toByte())

  private const val EBML_HEADER_ID = 0x1A45DFA3L
  private const val EBML_SEGMENT_ID = 0x18538067L
  private const val EBML_TRACKS_ID = 0x1654AE6BL
  private const val EBML_TRACK_ENTRY_ID = 0xAEL
  private const val EBML_TRACK_TYPE_ID = 0x83L
  private const val EBML_CLUSTER_ID = 0x1F43B675L
  private const val WEBM_TRACK_VIDEO = 1L
  private const val WEBM_TRACK_AUDIO = 2L

  /** MPDs may open with an XML declaration and a long comment block before the root element. */
  private const val DASH_WINDOW = 16 * 1024
  private val MPD_ROOT = Regex("""<(?:[a-z_][\w.-]*:)?mpd\b""")

  private const val TS_PACKET = 188
  private const val MAX_TS_PACKETS_CHECKED = 64

  /** Top-level boxes the trailing-`moov` walk follows before giving up (ftyp, free, mdat… in practice). */
  private const val MAX_PREFIX_BOXES = 64

  /** Encrypted sample entries and the Common Encryption boxes a `moov` carries for them. */
  private val MOOV_ENCRYPTION_BOXES = listOf("encv", "enca", "sinf", "tenc", "pssh")

  private fun containsAscii(data: ByteArray, needle: String, from: Int = 0, to: Int = data.size): Boolean {
    val target = needle.map { it.code.toByte() }
    outer@ for (i in maxOf(from, 0)..minOf(to, data.size) - target.size) {
      for (j in target.indices) if (data[i + j] != target[j]) continue@outer
      return true
    }
    return false
  }

  private fun beU32(data: ByteArray, offset: Int): Long? {
    if (offset + 4 > data.size) return null
    return ((data[offset].toLong() and 0xFF) shl 24) or ((data[offset + 1].toLong() and 0xFF) shl 16) or
      ((data[offset + 2].toLong() and 0xFF) shl 8) or (data[offset + 3].toLong() and 0xFF)
  }

  private fun beU64(data: ByteArray, offset: Int): Long? {
    if (offset + 8 > data.size) return null
    var v = 0L
    for (i in 0 until 8) v = (v shl 8) or (data[offset + i].toLong() and 0xFF)
    return v
  }

  private fun unsupported(detail: String) = SniffResult.Unsupported(ProbeFailure.UNSUPPORTED_FORMAT, detail)

  private fun notMedia(detail: String) = SniffResult.Unsupported(ProbeFailure.NOT_MEDIA, detail)
}
