package com.vidorax.media.library

import java.io.OutputStream
import java.util.Arrays

/**
 * P12 Create GIF (#676): a small GIF89a encoder written for VidoraX (no GIF library). Plain Kotlin, no Android types,
 * so it is tested on the JVM byte for byte and against an independent decoder.
 *
 * - **Palette:** each frame gets its own palette of at most 256 colours by median cut ([GifQuantizer]). The first
 *   frame's palette is the global colour table; every later frame carries a local one. No dithering.
 * - **Pixels:** LZW-compressed as the GIF format asks ([GifLzw]): variable code width from minimum code size + 1 up to
 *   12 bits, a Clear code when the table is full, the codes packed LSB-first into sub-blocks of at most 255 bytes.
 * - **Timing and looping:** a Graphic Control Extension per frame with its delay in hundredths of a second
 *   ([delaysCs] spreads the rounding, so 15 fps gives 7, 6, 7, …), and the NETSCAPE2.0 extension so it loops
 *   ([loopCount] 0 = forever).
 * - Every frame covers the whole picture and is opaque (no transparency, disposal "not specified").
 */
internal class GifEncoder(
  private val out: OutputStream,
  val width: Int,
  val height: Int,
  /** NETSCAPE2.0 loop count: 0 plays forever. */
  private val loopCount: Int = 0,
) {
  private val quantizer = GifQuantizer()
  private val indices: ByteArray
  private var finished = false

  /** How many frames were written so far. */
  var frames = 0
    private set

  init {
    require(width in 1..MAX_SIDE && height in 1..MAX_SIDE) { "A GIF is 1–65535 pixels on each side" }
    require(loopCount in 0..0xFFFF) { "The loop count is 0–65535" }
    indices = ByteArray(width * height)
  }

  /** Adds one frame: [argb] holds `width × height` pixels row by row (alpha is ignored), shown for [delayCs]. */
  fun addFrame(argb: IntArray, delayCs: Int) {
    check(!finished) { "The GIF is already finished" }
    require(argb.size >= width * height) { "A frame needs ${width * height} pixels" }
    val palette = quantizer.quantize(argb, width * height, indices)
    if (frames == 0) {
      writeHeader(palette)
      writeLoop()
    }
    writeGraphicControl(delayCs.coerceIn(0, 0xFFFF))
    writeImageDescriptor(localTable = frames > 0, bits = palette.bits)
    if (frames > 0) writeColorTable(palette)
    GifLzw.encode(indices, width * height, maxOf(MIN_CODE_SIZE, palette.bits), out)
    frames++
  }

  /** Writes the trailer. A GIF needs at least one frame. */
  fun finish() {
    check(frames > 0) { "A GIF needs at least one frame" }
    if (finished) return
    out.write(TRAILER)
    out.flush()
    finished = true
  }

  private fun writeHeader(palette: GifPalette) {
    out.write(SIGNATURE)
    // Logical screen descriptor: the size, then a global colour table of 2^bits colours, 8 bits per primary.
    writeShort(width)
    writeShort(height)
    out.write(GLOBAL_TABLE_FLAG or COLOR_RESOLUTION_8_BITS or (palette.bits - 1))
    out.write(0) // background colour index
    out.write(0) // pixel aspect ratio: not given (square)
    writeColorTable(palette)
  }

  private fun writeLoop() {
    out.write(EXTENSION)
    out.write(APPLICATION_LABEL)
    out.write(NETSCAPE.size)
    out.write(NETSCAPE)
    out.write(3) // sub-block of three bytes
    out.write(1) // the loop sub-block's id
    writeShort(loopCount)
    out.write(0) // block terminator
  }

  private fun writeGraphicControl(delayCs: Int) {
    out.write(EXTENSION)
    out.write(GRAPHIC_CONTROL_LABEL)
    out.write(4)
    out.write(0) // disposal not specified, no user input, no transparent colour
    writeShort(delayCs)
    out.write(0) // transparent colour index (unused)
    out.write(0) // block terminator
  }

  private fun writeImageDescriptor(localTable: Boolean, bits: Int) {
    out.write(IMAGE_SEPARATOR)
    writeShort(0) // left
    writeShort(0) // top
    writeShort(width)
    writeShort(height)
    out.write(if (localTable) LOCAL_TABLE_FLAG or (bits - 1) else 0)
  }

  private fun writeColorTable(palette: GifPalette) {
    val table = ByteArray(palette.colors.size * 3)
    palette.colors.forEachIndexed { index, rgb ->
      table[index * 3] = (rgb shr 16).toByte()
      table[index * 3 + 1] = (rgb shr 8).toByte()
      table[index * 3 + 2] = rgb.toByte()
    }
    out.write(table)
  }

  private fun writeShort(value: Int) {
    out.write(value and 0xFF)
    out.write((value shr 8) and 0xFF)
  }

  internal companion object {
    const val MAX_SIDE = 0xFFFF
    const val MIN_CODE_SIZE = 2

    private val SIGNATURE = "GIF89a".toByteArray(Charsets.US_ASCII)
    private val NETSCAPE = "NETSCAPE2.0".toByteArray(Charsets.US_ASCII)
    private const val EXTENSION = 0x21
    private const val APPLICATION_LABEL = 0xFF
    private const val GRAPHIC_CONTROL_LABEL = 0xF9
    private const val IMAGE_SEPARATOR = 0x2C
    private const val TRAILER = 0x3B
    private const val GLOBAL_TABLE_FLAG = 0x80
    private const val LOCAL_TABLE_FLAG = 0x80
    private const val COLOR_RESOLUTION_8_BITS = 0x70

    /**
     * Each frame's delay in hundredths of a second at [fps]: frame i ends at round((i + 1) × 100 / fps), so the
     * rounding never adds up (15 fps: 7, 6, 7, 7, 6, 7, … = exactly 20 cs every three frames).
     */
    fun delaysCs(frameCount: Int, fps: Int): IntArray {
      require(frameCount >= 0 && fps > 0)
      return IntArray(frameCount) { index -> roundedCs(index + 1, fps) - roundedCs(index, fps) }
    }

    /** round(frames × 100 / fps), halves up, in integers. */
    private fun roundedCs(frames: Int, fps: Int): Int = ((2L * frames * 100 + fps) / (2L * fps)).toInt()
  }
}

/** One frame's colours. */
internal class GifPalette(
  /** 0xRRGGBB per entry; 2^[bits] entries (2 to 256), the ones no pixel uses are black. */
  val colors: IntArray,
  /** log2 of the table size, 1 to 8. */
  val bits: Int,
)

/**
 * Median cut over a 5-5-5 bit RGB histogram (32 768 bins): the box of bins with the most pixels × longest side is split
 * at its median along that side, until there are [GifQuantizer.MAX_COLORS] boxes or none can split. Each box's colour
 * is the exact mean of its pixels; a pixel takes its bin's box (no per-pixel colour search). The palette is sorted by
 * colour, so the same frame always gives the same bytes. Keeps its buffers between frames: one instance per GIF.
 */
internal class GifQuantizer {
  private val counts = IntArray(BINS)
  private val sumR = LongArray(BINS)
  private val sumG = LongArray(BINS)
  private val sumB = LongArray(BINS)
  private val binToIndex = IntArray(BINS)
  private val bins = IntArray(BINS)
  private val keys = IntArray(BINS)

  /**
   * Quantises the first [count] pixels of [argb] to at most [maxColors] colours and writes each pixel's palette index
   * into [indices].
   */
  fun quantize(argb: IntArray, count: Int, indices: ByteArray, maxColors: Int = MAX_COLORS): GifPalette {
    require(count > 0 && argb.size >= count && indices.size >= count) { "No pixels" }
    require(maxColors in 2..MAX_COLORS)
    Arrays.fill(counts, 0)
    Arrays.fill(sumR, 0L)
    Arrays.fill(sumG, 0L)
    Arrays.fill(sumB, 0L)
    for (i in 0 until count) {
      val pixel = argb[i]
      val r = (pixel shr 16) and 0xFF
      val g = (pixel shr 8) and 0xFF
      val b = pixel and 0xFF
      val bin = binOf(r, g, b)
      counts[bin]++
      sumR[bin] += r.toLong()
      sumG[bin] += g.toLong()
      sumB[bin] += b.toLong()
    }
    var used = 0
    for (bin in 0 until BINS) {
      if (counts[bin] > 0) bins[used++] = bin
    }

    // Boxes are ranges [lo, hi) of `bins`; a split sorts its range along the chosen side.
    val boxLo = IntArray(maxColors)
    val boxHi = IntArray(maxColors)
    val boxPopulation = LongArray(maxColors)
    val boxAxis = IntArray(maxColors)
    val boxSide = IntArray(maxColors)
    var boxes = 1
    boxLo[0] = 0
    boxHi[0] = used
    measure(0, boxLo, boxHi, boxPopulation, boxAxis, boxSide)
    while (boxes < maxColors) {
      var best = -1
      var bestScore = 0L
      for (k in 0 until boxes) {
        if (boxHi[k] - boxLo[k] < 2) continue
        val score = boxPopulation[k] * boxSide[k]
        if (score > bestScore) {
          bestScore = score
          best = k
        }
      }
      if (best < 0) break
      val lo = boxLo[best]
      val hi = boxHi[best]
      sortAlong(lo, hi, boxAxis[best])
      val total = boxPopulation[best]
      var running = 0L
      var split = hi - 1
      for (j in lo until hi) {
        running += counts[bins[j]]
        if (running * 2 >= total) {
          split = j + 1
          break
        }
      }
      split = split.coerceIn(lo + 1, hi - 1)
      boxLo[boxes] = split
      boxHi[boxes] = hi
      boxHi[best] = split
      measure(best, boxLo, boxHi, boxPopulation, boxAxis, boxSide)
      measure(boxes, boxLo, boxHi, boxPopulation, boxAxis, boxSide)
      boxes++
    }

    // Each box's colour: the mean of its pixels. Sorted by colour (then by box) for stable output.
    val colorOf = IntArray(boxes) { k -> meanColor(boxLo[k], boxHi[k]) }
    val order = (0 until boxes).sortedWith(compareBy<Int>({ colorOf[it] }, { it }))
    val size = tableSize(boxes)
    val colors = IntArray(size)
    order.forEachIndexed { index, k ->
      colors[index] = colorOf[k]
      for (j in boxLo[k] until boxHi[k]) binToIndex[bins[j]] = index
    }
    for (i in 0 until count) {
      val pixel = argb[i]
      indices[i] = binToIndex[binOf((pixel shr 16) and 0xFF, (pixel shr 8) and 0xFF, pixel and 0xFF)].toByte()
    }
    return GifPalette(colors, Integer.numberOfTrailingZeros(size))
  }

  /** Population, longest side (in 5-bit steps) and its axis (0 red, 1 green, 2 blue) of box [k]. */
  private fun measure(k: Int, lo: IntArray, hi: IntArray, population: LongArray, axis: IntArray, side: IntArray) {
    var minR = 31
    var maxR = 0
    var minG = 31
    var maxG = 0
    var minB = 31
    var maxB = 0
    var pixels = 0L
    for (j in lo[k] until hi[k]) {
      val bin = bins[j]
      val r = bin shr 10
      val g = (bin shr 5) and 31
      val b = bin and 31
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (g < minG) minG = g
      if (g > maxG) maxG = g
      if (b < minB) minB = b
      if (b > maxB) maxB = b
      pixels += counts[bin]
    }
    val sideR = maxR - minR
    val sideG = maxG - minG
    val sideB = maxB - minB
    population[k] = pixels
    when {
      sideR >= sideG && sideR >= sideB -> {
        axis[k] = 0
        side[k] = sideR
      }
      sideG >= sideB -> {
        axis[k] = 1
        side[k] = sideG
      }
      else -> {
        axis[k] = 2
        side[k] = sideB
      }
    }
  }

  /** Sorts bins[lo, hi) by their value on [axis], then by bin (a primitive sort of packed keys). */
  private fun sortAlong(lo: Int, hi: Int, axis: Int) {
    val shift = when (axis) {
      0 -> 10
      1 -> 5
      else -> 0
    }
    for (j in lo until hi) keys[j] = (((bins[j] shr shift) and 31) shl 15) or bins[j]
    Arrays.sort(keys, lo, hi)
    for (j in lo until hi) bins[j] = keys[j] and (BINS - 1)
  }

  private fun meanColor(lo: Int, hi: Int): Int {
    var pixels = 0L
    var r = 0L
    var g = 0L
    var b = 0L
    for (j in lo until hi) {
      val bin = bins[j]
      pixels += counts[bin]
      r += sumR[bin]
      g += sumG[bin]
      b += sumB[bin]
    }
    if (pixels == 0L) return 0
    val half = pixels / 2
    return (((r + half) / pixels).toInt() shl 16) or (((g + half) / pixels).toInt() shl 8) or ((b + half) / pixels).toInt()
  }

  internal companion object {
    const val MAX_COLORS = 256
    private const val BINS = 1 shl 15

    private fun binOf(r: Int, g: Int, b: Int): Int = ((r shr 3) shl 10) or ((g shr 3) shl 5) or (b shr 3)

    /** The GIF colour table's size: the next power of two, at least 2. */
    fun tableSize(colors: Int): Int {
      var size = 2
      while (size < colors) size = size shl 1
      return size
    }
  }
}

/**
 * GIF's LZW ("Variable-Length-Code LZW", GIF89a appendix F): writes the minimum code size, the compressed codes in
 * sub-blocks of at most 255 bytes, and the zero-length terminator. A code is written with the current width, which
 * grows by one bit after a code is written once the next free code no longer fits (up to 12 bits). When all 4096 codes
 * are used a Clear code is written and the table starts again. The dictionary is an open-addressing hash of
 * (prefix code, pixel) pairs in primitive arrays.
 */
internal object GifLzw {
  private const val MAX_BITS = 12
  private const val MAX_CODES = 1 shl MAX_BITS

  /** A prime above [MAX_CODES]: the classic table size, under 82 % full at most. */
  private const val HASH_SIZE = 5003

  fun encode(indices: ByteArray, count: Int, minCodeSize: Int, out: OutputStream) {
    require(minCodeSize in 2..8) { "The minimum code size is 2–8" }
    require(count > 0 && indices.size >= count) { "No pixels" }
    out.write(minCodeSize)
    Coder(out, minCodeSize).run(indices, count)
  }

  private class Coder(out: OutputStream, private val minCodeSize: Int) {
    private val blocks = SubBlocks(out)
    private val clearCode = 1 shl minCodeSize
    private val endCode = clearCode + 1
    private val hashKeys = IntArray(HASH_SIZE).also { Arrays.fill(it, -1) }
    private val hashCodes = IntArray(HASH_SIZE)
    private var codeSize = minCodeSize + 1
    private var nextCode = endCode + 1
    private var resetWidth = false

    fun run(indices: ByteArray, count: Int) {
      write(clearCode)
      var prefix = indices[0].toInt() and 0xFF
      for (i in 1 until count) {
        val pixel = indices[i].toInt() and 0xFF
        val key = (prefix shl 8) or pixel
        var slot = (pixel shl 4) xor prefix
        if (hashKeys[slot] == key) {
          prefix = hashCodes[slot]
          continue
        }
        if (hashKeys[slot] >= 0) {
          val step = if (slot == 0) 1 else HASH_SIZE - slot
          var found = -1
          while (true) {
            slot -= step
            if (slot < 0) slot += HASH_SIZE
            if (hashKeys[slot] == key) {
              found = hashCodes[slot]
              break
            }
            if (hashKeys[slot] < 0) break
          }
          if (found >= 0) {
            prefix = found
            continue
          }
        }
        write(prefix)
        if (nextCode < MAX_CODES) {
          hashKeys[slot] = key
          hashCodes[slot] = nextCode++
        } else {
          // The table is full: start again (the code after the Clear code is read at the starting width).
          Arrays.fill(hashKeys, -1)
          nextCode = endCode + 1
          resetWidth = true
          write(clearCode)
        }
        prefix = pixel
      }
      write(prefix)
      write(endCode)
      blocks.finish()
    }

    private fun write(code: Int) {
      blocks.writeBits(code, codeSize)
      if (resetWidth) {
        codeSize = minCodeSize + 1
        resetWidth = false
      } else if (codeSize < MAX_BITS && nextCode > (1 shl codeSize) - 1) {
        codeSize++
      }
    }
  }

  /** Bits packed LSB-first into bytes, the bytes into sub-blocks of up to 255 with a length byte each. */
  private class SubBlocks(private val out: OutputStream) {
    private val block = ByteArray(255)
    private var length = 0
    private var bits = 0
    private var bitCount = 0

    fun writeBits(code: Int, width: Int) {
      bits = bits or (code shl bitCount)
      bitCount += width
      while (bitCount >= 8) {
        byte(bits and 0xFF)
        bits = bits ushr 8
        bitCount -= 8
      }
    }

    fun finish() {
      if (bitCount > 0) byte(bits and 0xFF)
      bits = 0
      bitCount = 0
      flush()
      out.write(0)
    }

    private fun byte(value: Int) {
      block[length++] = value.toByte()
      if (length == block.size) flush()
    }

    private fun flush() {
      if (length == 0) return
      out.write(length)
      out.write(block, 0, length)
      length = 0
    }
  }
}
