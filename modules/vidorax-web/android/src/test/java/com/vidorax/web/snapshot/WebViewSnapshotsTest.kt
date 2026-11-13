package com.vidorax.web.snapshot

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WebViewSnapshotsTest {
  @get:Rule val folder = TemporaryFolder()

  @Test fun scalesDownToMaxWidthKeepingAspect() {
    val size = WebViewSnapshots.targetSize(1080, 2000, 360)!!
    assertEquals(360, size.width)
    assertEquals(667, size.height)
    assertEquals(1f / 3f, size.scale, 0.0001f)
  }

  @Test fun neverScalesUp() {
    val size = WebViewSnapshots.targetSize(300, 500, 540)!!
    assertEquals(300, size.width)
    assertEquals(500, size.height)
    assertEquals(1f, size.scale, 0f)
  }

  @Test fun clampsTheRequestedWidth() {
    assertEquals(64, WebViewSnapshots.targetSize(1080, 1080, 1)!!.width)
    assertEquals(1080, WebViewSnapshots.targetSize(2160, 1000, 99_999)!!.width)
  }

  @Test fun noSizeNoSnapshot() {
    assertNull(WebViewSnapshots.targetSize(0, 900, 360))
    assertNull(WebViewSnapshots.targetSize(900, 0, 360))
  }

  @Test fun aVeryWideViewStillGetsOnePixelOfHeight() {
    assertEquals(1, WebViewSnapshots.targetSize(100_000, 1, 360)!!.height)
  }

  @Test fun keysCannotNameOtherFiles() {
    assertTrue(WebViewSnapshots.isSafeKey("tab_17a9c-3F"))
    assertFalse(WebViewSnapshots.isSafeKey("../files/x"))
    assertFalse(WebViewSnapshots.isSafeKey("a.jpg"))
    assertFalse(WebViewSnapshots.isSafeKey(""))
    assertFalse(WebViewSnapshots.isSafeKey("a".repeat(65)))
  }

  @Test fun writesADecodableJpegAtomically() {
    val bitmap = Bitmap.createBitmap(120, 80, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }
    val target = WebViewSnapshots.fileFor(folder.root, "tab1")
    assertTrue(WebViewSnapshots.writeJpeg(bitmap, target))
    assertTrue(target.isFile)
    assertFalse(java.io.File(target.parentFile, "tab1.jpg.tmp").exists())
    val bytes = target.readBytes()
    // JPEG SOI marker.
    assertEquals(0xFF, bytes[0].toInt() and 0xFF)
    assertEquals(0xD8, bytes[1].toInt() and 0xFF)
    val decoded = BitmapFactory.decodeFile(target.path)!!
    assertEquals(120, decoded.width)
    assertEquals(80, decoded.height)
    val pixel = decoded.getPixel(60, 40)
    assertTrue(Color.red(pixel) > 200 && Color.green(pixel) < 60)
  }

  @Test fun replacesAnOlderSnapshot() {
    val target = WebViewSnapshots.fileFor(folder.root, "tab2")
    val small = Bitmap.createBitmap(10, 10, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLUE) }
    val large = Bitmap.createBitmap(40, 20, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GREEN) }
    assertTrue(WebViewSnapshots.writeJpeg(small, target))
    assertTrue(WebViewSnapshots.writeJpeg(large, target))
    assertEquals(40, BitmapFactory.decodeFile(target.path)!!.width)
  }
}
