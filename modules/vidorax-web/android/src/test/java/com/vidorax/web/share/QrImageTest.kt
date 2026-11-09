package com.vidorax.web.share

import android.graphics.Color
import com.vidorax.web.scanner.QrScanner
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class QrImageTest {
  private val rows = List(21) { y -> String(CharArray(21) { x -> if ((x + y) % 2 == 0) '1' else '0' }) }

  @Test
  fun drawsModulesWithAQuietZone() {
    val bitmap = QrImage.render(rows, 4)
    assertNotNull(bitmap)
    bitmap!!
    assertEquals((21 + 2 * QrImage.QUIET) * 4, bitmap.width)
    assertEquals(bitmap.width, bitmap.height)
    assertEquals("quiet zone", Color.WHITE, bitmap.getPixel(1, 1))
    val origin = QrImage.QUIET * 4
    assertEquals("module (0,0) is dark", Color.BLACK, bitmap.getPixel(origin + 1, origin + 1))
    assertEquals("module (1,0) is light", Color.WHITE, bitmap.getPixel(origin + 5, origin + 1))
  }

  @Test
  fun refusesAnythingButASquareOfBits() {
    assertNull(QrImage.render(rows.take(20), 4))
    assertNull(QrImage.render(rows.mapIndexed { i, r -> if (i == 3) r.dropLast(1) else r }, 4))
    assertNull(QrImage.render(rows.mapIndexed { i, r -> if (i == 3) r.replace('1', 'x') else r }, 4))
    assertNull(QrImage.render(List(181) { "0".repeat(181) }, 2))
  }

  @Test
  fun galleryOnlyOnAndroid10AndLater() {
    assertEquals(true, QrImage.canSaveToGallery())
  }

  @Test
  fun scannerAnswersAreBounded() {
    assertEquals(mapOf("status" to "cancelled", "text" to null), QrScanner.result("cancelled"))
    assertEquals(4096, (QrScanner.result("scanned", "a".repeat(9000))["text"] as String).length)
  }
}
