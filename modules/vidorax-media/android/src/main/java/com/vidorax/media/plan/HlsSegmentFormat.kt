package com.vidorax.media.plan

import com.vidorax.media.model.Container

/** What an HLS segment's first bytes are. */
internal object HlsSegmentFormat {
  private val ISO_BMFF_FIRST_BOXES = setOf("ftyp", "styp", "moov", "moof", "sidx")

  /** MPEG-TS, fragmented MP4 or (DASH) WebM — the segment formats a video track can be saved from — else null. */
  fun containerOf(head: ByteArray): Container? {
    if (head.size >= 1 && head[0].toInt() and 0xFF == 0x47 && (head.size <= 188 || head[188].toInt() and 0xFF == 0x47)) {
      return Container.TS
    }
    if (head.size >= 8) {
      val type = String(head, 4, 4, Charsets.ISO_8859_1)
      if (type in ISO_BMFF_FIRST_BOXES) return Container.MP4
    }
    // DASH WebM representations: an EBML header (init) or a Cluster.
    if (isEbml(head)) return Container.WEBM
    return null
  }

  /** ID3-tagged ADTS/MP3 or bare ADTS: an HLS packed-audio segment (an audio rendition, never a video). */
  fun isPackedAudio(head: ByteArray): Boolean =
    (head.size >= 3 && String(head, 0, 3, Charsets.ISO_8859_1) == "ID3") ||
      (head.size >= 2 && head[0].toInt() and 0xFF == 0xFF && head[1].toInt() and 0xF6 == 0xF0)

  private fun isEbml(head: ByteArray): Boolean =
    head.size >= 4 && (
      (head[0] == 0x1A.toByte() && head[1] == 0x45.toByte() && head[2] == 0xDF.toByte() && head[3] == 0xA3.toByte()) ||
        (head[0] == 0x1F.toByte() && head[1] == 0x43.toByte() && head[2] == 0xB6.toByte() && head[3] == 0x75.toByte())
      )

  fun refusal(head: ByteArray): String = when {
    head.size >= 3 && String(head, 0, 3, Charsets.ISO_8859_1) == "ID3" -> "audio-only HLS stream (packed audio)"
    head.size >= 2 && head[0].toInt() and 0xFF == 0xFF && head[1].toInt() and 0xF0 == 0xF0 -> "audio-only HLS stream (ADTS)"
    isWebVtt(head) -> "subtitle playlist, not video"
    else -> "unrecognized HLS segment format"
  }

  /** `WEBVTT`, after the optional UTF-8 byte order mark. */
  private fun isWebVtt(head: ByteArray): Boolean {
    val bom = head.size >= 3 && head[0] == 0xEF.toByte() && head[1] == 0xBB.toByte() && head[2] == 0xBF.toByte()
    val start = if (bom) 3 else 0
    return head.size >= start + 6 && String(head, start, 6, Charsets.ISO_8859_1) == "WEBVTT"
  }
}
