package com.vidorax.media.library

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * P12 Create GIF (#676): the GIF89a encoder. A known output byte for byte (header, logical screen, palette, loop and
 * control extensions, LZW codes), and bigger GIFs read back with the JDK's own GIF decoder (javax.imageio), which shares
 * no code with the encoder: every pixel, every delay, the loop extension. javax.imageio isn't on an Android unit test's
 * compile classpath (android.jar stands in for the JDK there), but the tests run on the JDK, so [JdkGif] reaches it
 * through its public API classes by reflection.
 */
class GifEncoderTest {
  private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

  private fun encode(width: Int, height: Int, frames: List<IntArray>, delayCs: Int = 10): ByteArray {
    val out = ByteArrayOutputStream()
    val encoder = GifEncoder(out, width, height)
    frames.forEach { encoder.addFrame(it, delayCs) }
    encoder.finish()
    return out.toByteArray()
  }

  private fun reader(gif: ByteArray) = JdkGif(gif)

  @Test
  fun aTwoByTwoTwoColourFrameIsExactlyTheseBytes() {
    val blue = 0xFF0000FF.toInt()
    val red = 0xFFFF0000.toInt()
    val gif = encode(2, 2, listOf(intArrayOf(blue, red, red, blue)))
    val expected = bytes(
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
      0x02, 0x00, 0x02, 0x00, // 2 × 2
      0xF0, 0x00, 0x00, // global table of 2 colours, 8 bits per primary; background 0; no aspect
      0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, // palette sorted by colour: blue (index 0), red (index 1)
      0x21, 0xFF, 0x0B, 0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30, // NETSCAPE2.0
      0x03, 0x01, 0x00, 0x00, 0x00, // loop count 0: forever
      0x21, 0xF9, 0x04, 0x00, 0x0A, 0x00, 0x00, 0x00, // graphic control: 10 cs, no transparency
      0x2C, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, // the image at 0,0, 2 × 2, global table
      // LZW, minimum code size 2: Clear(4) 0 1 1 at 3 bits, then 0 and End(5) at 4 bits (code 8 was defined),
      // LSB first = 0x44 0x02 0x05 in one sub-block of 3 bytes, then the terminator.
      0x02, 0x03, 0x44, 0x02, 0x05, 0x00,
      0x3B, // trailer
    )
    assertArrayEquals(expected, gif)
    // The JDK decoder reads the same pixels back.
    val image = reader(gif)
    assertEquals(blue, image.rgb(0, 0, 0))
    assertEquals(red, image.rgb(0, 1, 0))
    assertEquals(red, image.rgb(0, 0, 1))
    assertEquals(blue, image.rgb(0, 1, 1))
  }

  @Test
  fun lzwOfAFlatFrameAtEightBitsIsClearZeroTwoFiftyEightZeroEnd() {
    val out = ByteArrayOutputStream()
    GifLzw.encode(ByteArray(4), 4, 8, out)
    // Codes 256 (Clear), 0, 258 ("00"), 0, 257 (End), all 9 bits wide, LSB first: 45 bits in 6 bytes.
    assertArrayEquals(bytes(0x08, 0x06, 0x00, 0x01, 0x08, 0x04, 0x10, 0x10, 0x00), out.toByteArray())
  }

  @Test
  fun delaysSpreadTheRoundingSoTheyAddUpToTheRealLength() {
    assertArrayEquals(intArrayOf(7, 6, 7, 7, 6, 7), GifEncoder.delaysCs(6, 15))
    assertArrayEquals(intArrayOf(10, 10, 10), GifEncoder.delaysCs(3, 10))
    assertArrayEquals(intArrayOf(20, 20), GifEncoder.delaysCs(2, 5))
    // 15 s at 15 fps: 225 frames, 1500 cs in all.
    assertEquals(1_500, GifEncoder.delaysCs(225, 15).sum())
  }

  @Test
  fun aBigMultiFrameGifDecodesToExactlyItsPixelsDelaysAndLoop() {
    // 200 colours in 200 different 5-5-5 bins: median cut gives each its own palette entry, so nothing is lost and
    // every pixel must come back exactly. Indices that rarely repeat make the LZW table fill and restart (Clear).
    val colors = IntArray(200) { k ->
      val r = (k % 32) * 8 + 3
      val g = (k / 32) * 5 % 32 * 8 + 5
      val b = (k * 7) % 32 * 8 + 1
      (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }
    val width = 160
    val height = 120
    val frames = List(3) { frame ->
      IntArray(width * height) { i ->
        val x = i % width
        val y = i / width
        colors[(x * 31 + y * 17 + frame * 13 + (x * y) % 7) % colors.size]
      }
    }
    val gif = encode(width, height, frames, delayCs = 7)
    val reader = reader(gif)
    assertEquals(3, reader.frameCount)
    for (index in frames.indices) {
      assertEquals(width to height, reader.size(index))
      for (i in 0 until width * height) {
        assertEquals("frame $index pixel $i", frames[index][i], reader.rgb(index, i % width, i / width))
      }
      assertEquals("7", reader.element(index, "GraphicControlExtension")?.getAttribute("delayTime"))
      // The first frame uses the global colour table; the later ones carry their own (local) table.
      assertEquals(index > 0, reader.element(index, "LocalColorTable") != null)
    }
    val loop = reader.element(0, "ApplicationExtension")
    assertEquals("NETSCAPE", loop?.getAttribute("applicationID"))
    assertEquals("2.0", loop?.getAttribute("authenticationCode"))
    assertArrayEquals(bytes(1, 0, 0), reader.userObject(0, "ApplicationExtension") as ByteArray)
  }

  @Test
  fun aFrameWithThousandsOfColoursGetsAFull256ColourPaletteAndStaysClose() {
    val width = 64
    val height = 64
    val pixels = IntArray(width * height) { i ->
      val x = i % width
      val y = i / width
      (0xFF shl 24) or ((x * 4) shl 16) or ((y * 4) shl 8) or (((x + y) * 2) and 0xFF)
    }
    val indices = ByteArray(width * height)
    val palette = GifQuantizer().quantize(pixels, pixels.size, indices)
    assertEquals(8, palette.bits)
    assertEquals(256, palette.colors.size)
    val image = reader(encode(width, height, listOf(pixels)))
    var worst = 0
    for (i in pixels.indices) {
      val a = pixels[i]
      val b = image.rgb(0, i % width, i / width)
      for (shift in intArrayOf(16, 8, 0)) {
        worst = maxOf(worst, kotlin.math.abs(((a shr shift) and 0xFF) - ((b shr shift) and 0xFF)))
      }
    }
    assertTrue("worst channel error $worst", worst <= 24)
  }

  @Test
  fun theSameFramesAlwaysGiveTheSameBytesAndAOneColourFrameWorks() {
    val frame = IntArray(48 * 27) { i -> if (i % 5 == 0) 0xFF102030.toInt() else 0xFFE0D0C0.toInt() }
    assertArrayEquals(encode(48, 27, listOf(frame, frame)), encode(48, 27, listOf(frame, frame)))
    val flat = encode(8, 8, listOf(IntArray(64) { 0xFF336699.toInt() }))
    assertEquals(0xFF336699.toInt(), reader(flat).rgb(0, 7, 7))
  }

  @Test
  fun aGifNeedsAFrameAndASensibleSize() {
    assertThrows(IllegalStateException::class.java) { GifEncoder(ByteArrayOutputStream(), 2, 2).finish() }
    assertThrows(IllegalArgumentException::class.java) { GifEncoder(ByteArrayOutputStream(), 0, 2) }
    assertThrows(IllegalArgumentException::class.java) { GifEncoder(ByteArrayOutputStream(), 2, 2).addFrame(IntArray(3), 10) }
  }
}

/**
 * The JDK's GIF decoder (javax.imageio, module java.desktop), called through its exported API classes (ImageIO,
 * ImageReader, BufferedImage, IIOMetadata) by reflection; the metadata tree is plain org.w3c.dom.
 */
private class JdkGif(gif: ByteArray) {
  private val imageIO = Class.forName("javax.imageio.ImageIO")
  private val readerClass = Class.forName("javax.imageio.ImageReader")
  private val imageClass = Class.forName("java.awt.image.BufferedImage")
  private val metadataClass = Class.forName("javax.imageio.metadata.IIOMetadata")
  private val reader: Any
  private val images = HashMap<Int, Any>()

  init {
    System.setProperty("java.awt.headless", "true")
    val readers = imageIO.getMethod("getImageReadersByFormatName", String::class.java).invoke(null, "gif") as Iterator<*>
    reader = readers.next()!!
    val stream = imageIO.getMethod("createImageInputStream", Any::class.java).invoke(null, ByteArrayInputStream(gif))
    readerClass.getMethod("setInput", Any::class.java).invoke(reader, stream)
  }

  val frameCount: Int
    get() = readerClass.getMethod("getNumImages", Boolean::class.javaPrimitiveType).invoke(reader, true) as Int

  private fun image(index: Int): Any =
    images.getOrPut(index) { readerClass.getMethod("read", Int::class.javaPrimitiveType).invoke(reader, index)!! }

  fun size(index: Int): Pair<Int, Int> =
    (imageClass.getMethod("getWidth").invoke(image(index)) as Int) to (imageClass.getMethod("getHeight").invoke(image(index)) as Int)

  fun rgb(index: Int, x: Int, y: Int): Int =
    imageClass.getMethod("getRGB", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType).invoke(image(index), x, y) as Int

  private fun tree(index: Int): org.w3c.dom.Element {
    val metadata = readerClass.getMethod("getImageMetadata", Int::class.javaPrimitiveType).invoke(reader, index)
    return metadataClass.getMethod("getAsTree", String::class.java).invoke(metadata, "javax_imageio_gif_image_1.0") as org.w3c.dom.Element
  }

  fun element(index: Int, name: String): org.w3c.dom.Element? =
    tree(index).getElementsByTagName(name).item(0) as org.w3c.dom.Element?

  fun userObject(index: Int, name: String): Any? {
    val node = element(index, name) ?: return null
    return Class.forName("javax.imageio.metadata.IIOMetadataNode").getMethod("getUserObject").invoke(node)
  }
}
