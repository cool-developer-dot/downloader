package com.vidorax.media.plan

import com.vidorax.media.model.Container

/** What an HLS segment's first bytes are. */
internal object HlsSegmentFormat {
  private val ISO_BMFF_FIRST_BOXES = setOf("ftyp", "styp", "moov", "moof", "sidx")

  /** MPEG-TS or fragmented MP4 — the two segment formats an HLS video can be saved from — else null. */
  fun containerOf(head: ByteArray): Container? {
    if (head.size >= 1 && head[0].toInt() and 0xFF == 0x47 && (head.size <= 188 || head[188].toInt() and 0xFF == 0x47)) {
      return Container.TS
    }
    if (head.size >= 8) {
      val type = String(head, 4, 4, Charsets.ISO_8859_1)
      if (type in ISO_BMFF_FIRST_BOXES) return Container.MP4
    }
    return null
  }

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
