package com.vidorax.media.process

/**
 * Codec configuration a container did not state separately — AVI, FLV and some MPEG-TS streams carry it in-band, at
 * the start of the first key frame — recovered from that frame, so an MP4 can be written with it (`esds`, `avcC`,
 * `hvcC`). Returned in the MediaCodec `csd` convention (start-code-prefixed units); null when the frame holds none.
 */
internal object CodecConfig {
  private val START_CODE = byteArrayOf(0, 0, 0, 1)

  fun fromFirstSample(mimeType: String, sample: ByteArray): List<ByteArray>? = when (mimeType) {
    "video/mp4v-es" -> mpeg4(sample)
    "video/avc" -> nalUnits(sample, setOf(7), setOf(8))
    "video/hevc" -> nalUnits(sample, setOf(32, 33, 34), emptySet(), hevc = true)
    else -> null
  }

  /** MPEG-4 Part 2: everything before the first VOP (VOS/VO/VOL headers) is the decoder specific info. */
  private fun mpeg4(sample: ByteArray): List<ByteArray>? {
    val vop = indexOfStartCode(sample, 0xB6) ?: return null
    if (vop <= 0) return null
    val header = sample.copyOfRange(0, vop)
    // A real config has a Video Object Layer start code (0x20..0x2F).
    val hasVol = (0 until header.size - 3).any { i ->
      header[i] == 0.toByte() && header[i + 1] == 0.toByte() && header[i + 2] == 1.toByte() &&
        (header[i + 3].toInt() and 0xF0) == 0x20
    }
    return if (hasVol) listOf(header) else null
  }

  /**
   * H.264 (SPS 7 / PPS 8) or HEVC (VPS 32 / SPS 33 / PPS 34) parameter sets from an Annex-B frame. H.264 gives two
   * buffers (SPS, PPS); HEVC one buffer holding all three, as MediaCodec does.
   */
  private fun nalUnits(sample: ByteArray, first: Set<Int>, second: Set<Int>, hevc: Boolean = false): List<ByteArray>? {
    val units = splitAnnexB(sample)
    fun type(unit: ByteArray) = if (hevc) (unit[0].toInt() shr 1) and 0x3F else unit[0].toInt() and 0x1F
    val a = units.filter { it.isNotEmpty() && type(it) in first }
    val b = units.filter { it.isNotEmpty() && type(it) in second }
    if (hevc) {
      if (a.map { type(it) }.toSet() != first) return null
      return listOf(a.fold(ByteArray(0)) { acc, unit -> acc + START_CODE + unit })
    }
    if (a.isEmpty() || b.isEmpty()) return null
    return listOf(START_CODE + a.first(), START_CODE + b.first())
  }

  /** The NAL units of an Annex-B byte stream, without their start codes. */
  private fun splitAnnexB(data: ByteArray): List<ByteArray> {
    val starts = ArrayList<Pair<Int, Int>>() // (payload start, start code length)
    var i = 0
    while (i + 3 <= data.size) {
      if (data[i] == 0.toByte() && data[i + 1] == 0.toByte()) {
        if (data[i + 2] == 1.toByte()) {
          starts += (i + 3) to 3
          i += 3
          continue
        }
        if (i + 4 <= data.size && data[i + 2] == 0.toByte() && data[i + 3] == 1.toByte()) {
          starts += (i + 4) to 4
          i += 4
          continue
        }
      }
      i++
    }
    return starts.mapIndexed { index, (begin, _) ->
      val end = if (index + 1 < starts.size) starts[index + 1].first - starts[index + 1].second else data.size
      // Trailing zero bytes belong to the next start code.
      var e = end
      while (e > begin && data[e - 1] == 0.toByte()) e--
      data.copyOfRange(begin, e)
    }
  }

  private fun indexOfStartCode(data: ByteArray, code: Int): Int? {
    for (i in 0 until data.size - 3) {
      if (data[i] == 0.toByte() && data[i + 1] == 0.toByte() && data[i + 2] == 1.toByte() &&
        (data[i + 3].toInt() and 0xFF) == code
      ) {
        return i
      }
    }
    return null
  }
}
