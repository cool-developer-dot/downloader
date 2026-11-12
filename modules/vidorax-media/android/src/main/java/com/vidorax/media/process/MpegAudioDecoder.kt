package com.vidorax.media.process

/**
 * MPEG-1/2 Audio Layer II ("MP2") decoder in plain Kotlin. Android has no platform decoder for MP2 — the sound of
 * nearly every `.mpg`, `.vob` and VCD — so without this an MPEG Program Stream could not become an MP4 with sound
 * (F4). Layer II only: MPEG-1 (32/44.1/48 kHz, ISO/IEC 11172-3) and MPEG-2 low sampling frequencies (16/22.05/24 kHz,
 * ISO/IEC 13818-3); mono, stereo, dual channel and joint stereo.
 *
 * A port of the Layer I/II path and the polyphase synthesis of minimp3 (github.com/lieff/minimp3, public domain —
 * CC0 1.0), kept close to the original so the two can be compared sample for sample. One instance per stream: the
 * synthesis filter carries state from frame to frame. Not thread-safe.
 */
internal class MpegAudioDecoder {
  /** What one decoded frame is. */
  data class FrameInfo(val sampleRate: Int, val channels: Int, val samplesPerChannel: Int)

  private val qmfState = FloatArray(15 * 64)
  private val grbuf = FloatArray(576 * 2)
  private val syn = FloatArray((18 + 15) * 2 * 32)
  private val sci = ScaleInfo()

  /** Forgets the synthesis state (after a seek or a stream change). */
  fun reset() {
    qmfState.fill(0f)
  }

  /**
   * Decodes the one Layer II frame at [data] ([offset], [length] bytes, header included) into [pcm] — interleaved
   * 16-bit samples, `samplesPerChannel × channels` of them ([MAX_SAMPLES_PER_FRAME] × 2 always fits). Null when the
   * bytes are not a whole, valid Layer II frame; nothing is written then.
   */
  fun decode(data: ByteArray, offset: Int, length: Int, pcm: ShortArray): FrameInfo? {
    val header = Header.read(data, offset, length) ?: return null
    if (header.layer != 2 || header.frameBytes <= 0 || header.frameBytes > length) return null
    val channels = if (header.mono) 1 else 2
    val bits = Bits(data, offset + Header.SIZE, header.frameBytes - Header.SIZE)
    if (header.crc) bits.get(16)

    readScaleInfo(header, bits, sci)
    grbuf.fill(0f)
    var pcmAt = 0
    var i = 0
    for (granule in 0 until 3) {
      i += dequantizeGranule(grbuf, i, bits, sci, GROUP_SIZE_LAYER_2)
      if (i == 12) {
        i = 0
        applyScalefactors(sci, granule, grbuf)
        synthGranule(qmfState, grbuf, 12, channels, pcm, pcmAt, syn)
        grbuf.fill(0f)
        pcmAt += 384 * channels
      }
      if (bits.pos > bits.limit) {
        reset()
        return null
      }
    }
    return FrameInfo(header.sampleRate, channels, SAMPLES_PER_FRAME)
  }

  // --- frame header ---

  internal class Header private constructor(private val b1: Int, private val b2: Int, private val b3: Int) {
    /** 1, 2 or 3. */
    val layer: Int get() = 4 - ((b1 shr 1) and 3)
    val mpeg1: Boolean get() = b1 and 0x8 != 0
    private val notMpeg25: Boolean get() = b1 and 0x10 != 0
    val crc: Boolean get() = b1 and 1 == 0
    val mono: Boolean get() = b3 and 0xC0 == 0xC0
    val stereoMode: Int get() = (b3 shr 6) and 3
    val stereoModeExtension: Int get() = (b3 shr 4) and 3
    val sampleRateIndex: Int get() = (b2 shr 2) and 3
    private val padding: Boolean get() = b2 and 0x2 != 0

    val bitrateKbps: Int get() = 2 * HALF_RATE[if (mpeg1) 1 else 0][((b1 shr 1) and 3) - 1][b2 shr 4]

    val sampleRate: Int
      get() = (SAMPLE_RATES[sampleRateIndex] shr (if (mpeg1) 0 else 1)) shr (if (notMpeg25) 0 else 1)

    private val samplesPerFrame: Int get() = if (layer == 1) 384 else if (layer == 3 && b1 and 14 == 2) 576 else 1152

    /** Including the header and padding; 0 for free-format streams (not supported). */
    val frameBytes: Int
      get() {
        val kbps = bitrateKbps
        if (kbps == 0) return 0
        var bytes = samplesPerFrame * kbps * 125 / sampleRate
        if (layer == 1) bytes = bytes and 3.inv()
        return bytes + if (padding) (if (layer == 1) 4 else 1) else 0
      }

    companion object {
      const val SIZE = 4

      fun read(data: ByteArray, offset: Int, length: Int): Header? {
        if (length < SIZE || offset < 0 || offset + SIZE > data.size) return null
        val b0 = data[offset].toInt() and 0xFF
        val b1 = data[offset + 1].toInt() and 0xFF
        val b2 = data[offset + 2].toInt() and 0xFF
        val b3 = data[offset + 3].toInt() and 0xFF
        val valid = b0 == 0xFF &&
          ((b1 and 0xF0) == 0xF0 || (b1 and 0xFE) == 0xE2) &&
          ((b1 shr 1) and 3) != 0 &&
          (b2 shr 4) != 15 &&
          ((b2 shr 2) and 3) != 3
        return if (valid) Header(b1, b2, b3) else null
      }

      private val SAMPLE_RATES = intArrayOf(44100, 48000, 32000)

      // [MPEG-1?][layer field − 1: Layer III, II, I][bitrate index] — half the kbps.
      private val HALF_RATE = arrayOf(
        arrayOf(
          intArrayOf(0, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 72, 80),
          intArrayOf(0, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 72, 80),
          intArrayOf(0, 16, 24, 28, 32, 40, 48, 56, 64, 72, 80, 88, 96, 112, 128),
        ),
        arrayOf(
          intArrayOf(0, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160),
          intArrayOf(0, 16, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192),
          intArrayOf(0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224),
        ),
      )
    }
  }

  // --- bit reader (minimp3 `get_bits`) ---

  private class Bits(private val buf: ByteArray, private val base: Int, bytes: Int) {
    var pos = 0
    val limit = bytes * 8

    fun get(n: Int): Int {
      val s = pos and 7
      var shl = n + s
      var p = base + (pos ushr 3)
      pos += n
      if (pos > limit) return 0
      var next = byteAt(p++) and (255 ushr s)
      var cache = 0
      while (true) {
        shl -= 8
        if (shl <= 0) break
        cache = cache or (next shl shl)
        next = byteAt(p++)
      }
      return cache or (next ushr -shl)
    }

    private fun byteAt(index: Int): Int = if (index < buf.size) buf[index].toInt() and 0xFF else 0
  }

  // --- Layer II side information ---

  private class ScaleInfo {
    val scf = FloatArray(3 * 64)
    var totalBands = 0
    var stereoBands = 0
    val bitalloc = IntArray(64)
    val scfcod = IntArray(64)
  }

  /** (offset into [BITALLOC_CODE_TAB], bits per code, number of subbands). */
  private class SubbandAlloc(val tabOffset: Int, val codeTabWidth: Int, val bandCount: Int)

  private fun subbandAllocTable(header: Header, sci: ScaleInfo): Array<SubbandAlloc> {
    val mode = header.stereoMode
    val stereoBands = when (mode) {
      MODE_MONO -> 0
      MODE_JOINT_STEREO -> (header.stereoModeExtension shl 2) + 4
      else -> 32
    }
    val alloc: Array<SubbandAlloc>
    var bands: Int
    if (!header.mpeg1) {
      alloc = ALLOC_L2_MPEG2
      bands = 30
    } else {
      var kbps = header.bitrateKbps shr (if (mode != MODE_MONO) 1 else 0)
      if (kbps == 0) kbps = 192 // free format
      alloc = if (kbps < 56) ALLOC_L2_MPEG1_LOWRATE else ALLOC_L2_MPEG1
      bands = 27
      if (kbps < 56) {
        bands = if (header.sampleRateIndex == 2) 12 else 8
      } else if (kbps >= 96 && header.sampleRateIndex != 1) {
        bands = 30
      }
    }
    sci.totalBands = bands
    sci.stereoBands = minOf(stereoBands, bands)
    return alloc
  }

  private fun readScaleInfo(header: Header, bits: Bits, sci: ScaleInfo) {
    val allocs = subbandAllocTable(header, sci)
    var next = 0
    var k = 0
    var baBits = 0
    var codeTab = 0
    for (i in 0 until sci.totalBands) {
      if (i == k) {
        val alloc = allocs[next++]
        k += alloc.bandCount
        baBits = alloc.codeTabWidth
        codeTab = alloc.tabOffset
      }
      var ba = BITALLOC_CODE_TAB[codeTab + bits.get(baBits)]
      sci.bitalloc[2 * i] = ba
      if (i < sci.stereoBands) ba = BITALLOC_CODE_TAB[codeTab + bits.get(baBits)]
      sci.bitalloc[2 * i + 1] = if (sci.stereoBands != 0) ba else 0
    }
    for (i in 0 until 2 * sci.totalBands) {
      sci.scfcod[i] = if (sci.bitalloc[i] != 0) bits.get(2) else 6
    }
    readScalefactors(bits, sci, sci.totalBands * 2)
    for (i in sci.stereoBands until sci.totalBands) sci.bitalloc[2 * i + 1] = 0
  }

  private fun readScalefactors(bits: Bits, sci: ScaleInfo, bands: Int) {
    var out = 0
    for (i in 0 until bands) {
      var s = 0f
      val ba = sci.bitalloc[i]
      val mask = if (ba != 0) 4 + ((19 shr sci.scfcod[i]) and 3) else 0
      var m = 4
      while (m != 0) {
        if (mask and m != 0) {
          val b = bits.get(6)
          s = DEQUANT[ba * 3 - 6 + b % 3] * ((1 shl 21) shr (b / 3)).toFloat()
        }
        sci.scf[out++] = s
        m = m shr 1
      }
    }
  }

  private fun dequantizeGranule(grbuf: FloatArray, start: Int, bits: Bits, sci: ScaleInfo, groupSize: Int): Int {
    for (j in 0 until 4) {
      var dst = start + groupSize * j
      var channelOffset = 576
      for (i in 0 until 2 * sci.totalBands) {
        val ba = sci.bitalloc[i]
        if (ba != 0) {
          if (ba < 17) {
            val half = (1 shl (ba - 1)) - 1
            for (k in 0 until groupSize) grbuf[dst + k] = (bits.get(ba) - half).toFloat()
          } else {
            val mod = (2 shl (ba - 17)) + 1 // 3, 5, 9 levels
            var code = bits.get(mod + 2 - (mod shr 3)) // 5, 7, 10 bits
            for (k in 0 until groupSize) {
              grbuf[dst + k] = (code % mod - mod / 2).toFloat()
              code /= mod
            }
          }
        }
        dst += channelOffset
        channelOffset = 18 - channelOffset
      }
    }
    return groupSize * 4
  }

  private fun applyScalefactors(sci: ScaleInfo, granule: Int, dst: FloatArray) {
    // Above the joint-stereo bound the right channel shares the left's samples, with its own scalefactors.
    val from = sci.stereoBands * 18
    System.arraycopy(dst, from, dst, 576 + from, (sci.totalBands - sci.stereoBands) * 18)
    var d = 0
    var s = granule
    for (i in 0 until sci.totalBands) {
      for (k in 0 until 12) {
        dst[d + k] *= sci.scf[s]
        dst[d + k + 576] *= sci.scf[s + 3]
      }
      d += 18
      s += 6
    }
  }

  // --- polyphase synthesis (minimp3 `mp3d_DCT_II`, `mp3d_synth`, `mp3d_synth_granule`) ---

  private val t = Array(4) { FloatArray(8) }

  private fun dctII(g: FloatArray, base: Int, n: Int) {
    for (k in 0 until n) {
      var y = base + k
      for (i in 0 until 8) {
        val x0 = g[y + i * 18]
        val x1 = g[y + (15 - i) * 18]
        val x2 = g[y + (16 + i) * 18]
        val x3 = g[y + (31 - i) * 18]
        val t0 = x0 + x3
        val t1 = x1 + x2
        val t2 = (x1 - x2) * SEC[3 * i + 0]
        val t3 = (x0 - x3) * SEC[3 * i + 1]
        t[0][i] = t0 + t1
        t[1][i] = (t0 - t1) * SEC[3 * i + 2]
        t[2][i] = t3 + t2
        t[3][i] = (t3 - t2) * SEC[3 * i + 2]
      }
      for (row in 0 until 4) {
        val x = t[row]
        var x0 = x[0]
        var x1 = x[1]
        var x2 = x[2]
        var x3 = x[3]
        var x4 = x[4]
        var x5 = x[5]
        var x6 = x[6]
        var x7 = x[7]
        var xt = x0 - x7
        x0 += x7
        x7 = x1 - x6
        x1 += x6
        x6 = x2 - x5
        x2 += x5
        x5 = x3 - x4
        x3 += x4
        x4 = x0 - x3
        x0 += x3
        x3 = x1 - x2
        x1 += x2
        x[0] = x0 + x1
        x[4] = (x0 - x1) * 0.70710677f
        x5 = x5 + x6
        x6 = (x6 + x7) * 0.70710677f
        x7 = x7 + xt
        x3 = (x3 + x4) * 0.70710677f
        x5 -= x7 * 0.198912367f // rotate by PI/8
        x7 += x5 * 0.382683432f
        x5 -= x7 * 0.198912367f
        x0 = xt - x6
        xt += x6
        x[1] = (xt + x7) * 0.50979561f
        x[2] = (x4 + x3) * 0.54119611f
        x[3] = (x0 - x5) * 0.60134488f
        x[5] = (x0 + x5) * 0.89997619f
        x[6] = (x4 - x3) * 1.30656302f
        x[7] = (xt - x7) * 2.56291556f
      }
      for (i in 0 until 7) {
        g[y + 0 * 18] = t[0][i]
        g[y + 1 * 18] = t[2][i] + t[3][i] + t[3][i + 1]
        g[y + 2 * 18] = t[1][i] + t[1][i + 1]
        g[y + 3 * 18] = t[2][i + 1] + t[3][i] + t[3][i + 1]
        y += 4 * 18
      }
      g[y + 0 * 18] = t[0][7]
      g[y + 1 * 18] = t[2][7] + t[3][7]
      g[y + 2 * 18] = t[1][7]
      g[y + 3 * 18] = t[3][7]
    }
  }

  private fun synthPair(pcm: ShortArray, at: Int, nch: Int, z: FloatArray, zAt: Int) {
    var a = (z[zAt + 14 * 64] - z[zAt]) * 29
    a += (z[zAt + 1 * 64] + z[zAt + 13 * 64]) * 213
    a += (z[zAt + 12 * 64] - z[zAt + 2 * 64]) * 459
    a += (z[zAt + 3 * 64] + z[zAt + 11 * 64]) * 2037
    a += (z[zAt + 10 * 64] - z[zAt + 4 * 64]) * 5153
    a += (z[zAt + 5 * 64] + z[zAt + 9 * 64]) * 6574
    a += (z[zAt + 8 * 64] - z[zAt + 6 * 64]) * 37489
    a += z[zAt + 7 * 64] * 75038
    pcm[at] = scalePcm(a)

    val z2 = zAt + 2
    a = z[z2 + 14 * 64] * 104
    a += z[z2 + 12 * 64] * 1567
    a += z[z2 + 10 * 64] * 9727
    a += z[z2 + 8 * 64] * 64019
    a += z[z2 + 6 * 64] * -9975
    a += z[z2 + 4 * 64] * -45
    a += z[z2 + 2 * 64] * 146
    a += z[z2 + 0 * 64] * -5
    pcm[at + 16 * nch] = scalePcm(a)
  }

  private val a = FloatArray(4)
  private val b = FloatArray(4)

  /** Two subband rows ([xl], and the right channel 576 later) → 64 output samples per channel at [dstl]. */
  private fun synth(g: FloatArray, xl: Int, pcm: ShortArray, dstl: Int, nch: Int, lins: FloatArray, linsAt: Int) {
    val xr = xl + 576 * (nch - 1)
    val dstr = dstl + (nch - 1)
    val zlin = linsAt + 15 * 64
    var w = 0

    lins[zlin + 4 * 15] = g[xl + 18 * 16]
    lins[zlin + 4 * 15 + 1] = g[xr + 18 * 16]
    lins[zlin + 4 * 15 + 2] = g[xl]
    lins[zlin + 4 * 15 + 3] = g[xr]

    lins[zlin + 4 * 31] = g[xl + 1 + 18 * 16]
    lins[zlin + 4 * 31 + 1] = g[xr + 1 + 18 * 16]
    lins[zlin + 4 * 31 + 2] = g[xl + 1]
    lins[zlin + 4 * 31 + 3] = g[xr + 1]

    synthPair(pcm, dstr, nch, lins, linsAt + 4 * 15 + 1)
    synthPair(pcm, dstr + 32 * nch, nch, lins, linsAt + 4 * 15 + 64 + 1)
    synthPair(pcm, dstl, nch, lins, linsAt + 4 * 15)
    synthPair(pcm, dstl + 32 * nch, nch, lins, linsAt + 4 * 15 + 64)

    for (i in 14 downTo 0) {
      lins[zlin + 4 * i] = g[xl + 18 * (31 - i)]
      lins[zlin + 4 * i + 1] = g[xr + 18 * (31 - i)]
      lins[zlin + 4 * i + 2] = g[xl + 1 + 18 * (31 - i)]
      lins[zlin + 4 * i + 3] = g[xr + 1 + 18 * (31 - i)]
      lins[zlin + 4 * (i + 16)] = g[xl + 1 + 18 * (1 + i)]
      lins[zlin + 4 * (i + 16) + 1] = g[xr + 1 + 18 * (1 + i)]
      lins[zlin + 4 * (i - 16) + 2] = g[xl + 18 * (1 + i)]
      lins[zlin + 4 * (i - 16) + 3] = g[xr + 18 * (1 + i)]

      // S0(0) S2(1) S1(2) S2(3) S1(4) S2(5) S1(6) S2(7)
      for (k in 0 until 8) {
        val w0 = WIN[w++]
        val w1 = WIN[w++]
        val vz = zlin + 4 * i - k * 64
        val vy = zlin + 4 * i - (15 - k) * 64
        for (j in 0 until 4) {
          val bj = lins[vz + j] * w1 + lins[vy + j] * w0
          when {
            k == 0 -> {
              b[j] = bj
              a[j] = lins[vz + j] * w0 - lins[vy + j] * w1
            }
            k % 2 == 1 -> {
              b[j] += bj
              a[j] += lins[vy + j] * w1 - lins[vz + j] * w0
            }
            else -> {
              b[j] += bj
              a[j] += lins[vz + j] * w0 - lins[vy + j] * w1
            }
          }
        }
      }

      pcm[dstr + (15 - i) * nch] = scalePcm(a[1])
      pcm[dstr + (17 + i) * nch] = scalePcm(b[1])
      pcm[dstl + (15 - i) * nch] = scalePcm(a[0])
      pcm[dstl + (17 + i) * nch] = scalePcm(b[0])
      pcm[dstr + (47 - i) * nch] = scalePcm(a[3])
      pcm[dstr + (49 + i) * nch] = scalePcm(b[3])
      pcm[dstl + (47 - i) * nch] = scalePcm(a[2])
      pcm[dstl + (49 + i) * nch] = scalePcm(b[2])
    }
  }

  private fun synthGranule(qmf: FloatArray, g: FloatArray, nbands: Int, nch: Int, pcm: ShortArray, pcmAt: Int, lins: FloatArray) {
    for (ch in 0 until nch) dctII(g, 576 * ch, nbands)
    System.arraycopy(qmf, 0, lins, 0, 15 * 64)
    var i = 0
    while (i < nbands) {
      synth(g, i, pcm, pcmAt + 32 * nch * i, nch, lins, i * 64)
      i += 2
    }
    if (nch == 1) {
      var k = 0
      while (k < 15 * 64) {
        qmf[k] = lins[nbands * 64 + k]
        k += 2
      }
    } else {
      System.arraycopy(lins, nbands * 64, qmf, 0, 15 * 64)
    }
  }

  companion object {
    /** Samples per channel in one Layer II frame. */
    const val SAMPLES_PER_FRAME = 1152

    /** The MIME type Media3 gives a Layer II track. */
    const val MIME_TYPE = "audio/mpeg-L2"

    private const val GROUP_SIZE_LAYER_2 = 3
    private const val MODE_MONO = 3
    private const val MODE_JOINT_STEREO = 1

    /** Whole frame in, `null` out on anything that is not one: a quick check before a stream is handed over. */
    fun isLayer2Frame(data: ByteArray, offset: Int = 0, length: Int = data.size - offset): Boolean {
      val header = Header.read(data, offset, length) ?: return false
      return header.layer == 2 && header.frameBytes in Header.SIZE + 1..length
    }

    private fun scalePcm(sample: Float): Short {
      if (sample >= 32766.5f) return 32767
      if (sample <= -32767.5f) return -32768
      var s = (sample + 0.5f).toInt()
      if (s < 0) s -= 1 // away from zero, as minimp3
      return s.toShort()
    }

    private val ALLOC_L2_MPEG1 = arrayOf(SubbandAlloc(0, 4, 3), SubbandAlloc(16, 4, 8), SubbandAlloc(32, 3, 12), SubbandAlloc(40, 2, 7))
    private val ALLOC_L2_MPEG1_LOWRATE = arrayOf(SubbandAlloc(44, 4, 2), SubbandAlloc(44, 3, 10))
    private val ALLOC_L2_MPEG2 = arrayOf(SubbandAlloc(60, 4, 4), SubbandAlloc(44, 3, 7), SubbandAlloc(44, 2, 19))

    private val BITALLOC_CODE_TAB = intArrayOf(
      0, 17, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      0, 17, 18, 3, 19, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16,
      0, 17, 18, 3, 19, 4, 5, 16,
      0, 17, 18, 16,
      0, 17, 18, 19, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      0, 17, 18, 3, 19, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
      0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    )

    private val DEQUANT: FloatArray = run {
      val levels = intArrayOf(3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535, 3, 5, 9)
      FloatArray(levels.size * 3).also { out ->
        levels.forEachIndexed { i, x ->
          out[i * 3] = 9.53674316e-07f / x
          out[i * 3 + 1] = 7.56931807e-07f / x
          out[i * 3 + 2] = 6.00777173e-07f / x
        }
      }
    }

    private val SEC = floatArrayOf(
      10.19000816f, 0.50060302f, 0.50241929f, 3.40760851f, 0.50547093f, 0.52249861f, 2.05778098f, 0.51544732f,
      0.56694406f, 1.48416460f, 0.53104258f, 0.64682180f, 1.16943991f, 0.55310392f, 0.78815460f, 0.97256821f,
      0.58293498f, 1.06067765f, 0.83934963f, 0.62250412f, 1.72244716f, 0.74453628f, 0.67480832f, 5.10114861f,
    )

    private val WIN = floatArrayOf(
      -1f, 26f, -31f, 208f, 218f, 401f, -519f, 2063f, 2000f, 4788f, -5517f, 7134f, 5959f, 35640f, -39336f, 74992f,
      -1f, 24f, -35f, 202f, 222f, 347f, -581f, 2080f, 1952f, 4425f, -5879f, 7640f, 5288f, 33791f, -41176f, 74856f,
      -1f, 21f, -38f, 196f, 225f, 294f, -645f, 2087f, 1893f, 4063f, -6237f, 8092f, 4561f, 31947f, -43006f, 74630f,
      -1f, 19f, -41f, 190f, 227f, 244f, -711f, 2085f, 1822f, 3705f, -6589f, 8492f, 3776f, 30112f, -44821f, 74313f,
      -1f, 17f, -45f, 183f, 228f, 197f, -779f, 2075f, 1739f, 3351f, -6935f, 8840f, 2935f, 28289f, -46617f, 73908f,
      -1f, 16f, -49f, 176f, 228f, 153f, -848f, 2057f, 1644f, 3004f, -7271f, 9139f, 2037f, 26482f, -48390f, 73415f,
      -2f, 14f, -53f, 169f, 227f, 111f, -919f, 2032f, 1535f, 2663f, -7597f, 9389f, 1082f, 24694f, -50137f, 72835f,
      -2f, 13f, -58f, 161f, 224f, 72f, -991f, 2001f, 1414f, 2330f, -7910f, 9592f, 70f, 22929f, -51853f, 72169f,
      -2f, 11f, -63f, 154f, 221f, 36f, -1064f, 1962f, 1280f, 2006f, -8209f, 9750f, -998f, 21189f, -53534f, 71420f,
      -2f, 10f, -68f, 147f, 215f, 2f, -1137f, 1919f, 1131f, 1692f, -8491f, 9863f, -2122f, 19478f, -55178f, 70590f,
      -3f, 9f, -73f, 139f, 208f, -29f, -1210f, 1870f, 970f, 1388f, -8755f, 9935f, -3300f, 17799f, -56778f, 69679f,
      -3f, 8f, -79f, 132f, 200f, -57f, -1283f, 1817f, 794f, 1095f, -8998f, 9966f, -4533f, 16155f, -58333f, 68692f,
      -4f, 7f, -85f, 125f, 189f, -83f, -1356f, 1759f, 605f, 814f, -9219f, 9959f, -5818f, 14548f, -59838f, 67629f,
      -4f, 7f, -91f, 117f, 177f, -106f, -1428f, 1698f, 402f, 545f, -9416f, 9916f, -7154f, 12980f, -61289f, 66494f,
      -5f, 6f, -97f, 111f, 163f, -127f, -1498f, 1634f, 185f, 288f, -9585f, 9838f, -8540f, 11455f, -62684f, 65290f,
    )
  }
}
