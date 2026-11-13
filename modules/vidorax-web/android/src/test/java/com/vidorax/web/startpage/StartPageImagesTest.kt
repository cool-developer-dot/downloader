package com.vidorax.web.startpage

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.ExifInterface
import android.provider.MediaStore
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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
class StartPageImagesTest {
  @get:Rule val folder = TemporaryFolder()

  // Robolectric runs this module on an SDK image without ExifInterface(InputStream) (API 24+): orientation is given.
  private val upright: (() -> java.io.InputStream?) -> Int = { ExifInterface.ORIENTATION_NORMAL }

  private fun png(width: Int, height: Int, color: Int = Color.RED): ByteArray {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }
    return ByteArrayOutputStream().use { out ->
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
      out.toByteArray()
    }
  }

  @Test fun sampleSizeKeepsTheLongerSideAtLeastTheLimit() {
    assertEquals(1, StartPageImages.sampleSize(1000, 800, 1920))
    assertEquals(2, StartPageImages.sampleSize(4000, 3000, 1920))
    assertEquals(4, StartPageImages.sampleSize(8000, 6000, 1920))
    assertEquals(1, StartPageImages.sampleSize(0, 10, 1920))
  }

  @Test fun fitsWithinTheLimitKeepingAspectAndNeverScalesUp() {
    assertEquals(1920 to 1440, StartPageImages.fitWithin(4000, 3000, 1920))
    assertEquals(1080 to 1920, StartPageImages.fitWithin(2250, 4000, 1920))
    assertEquals(800 to 600, StartPageImages.fitWithin(800, 600, 1920))
    assertEquals(480, StartPageImages.clampMaxSize(10))
    assertEquals(2560, StartPageImages.clampMaxSize(99_999))
  }

  @Test fun turnsPhotosUprightFromTheirExifOrientation() {
    assertEquals(0, StartPageImages.rotationFor(ExifInterface.ORIENTATION_NORMAL))
    assertEquals(90, StartPageImages.rotationFor(ExifInterface.ORIENTATION_ROTATE_90))
    assertEquals(180, StartPageImages.rotationFor(ExifInterface.ORIENTATION_ROTATE_180))
    assertEquals(270, StartPageImages.rotationFor(ExifInterface.ORIENTATION_ROTATE_270))
    assertEquals(0, StartPageImages.rotationFor(0))
  }

  @Test fun copiesAScaledJpegIntoAppStorageAndDropsTheOldOne() {
    val dir = folder.newFolder(StartPageImages.DIRECTORY)
    val bytes = png(1200, 900)
    val first = StartPageImages.copyScaled({ ByteArrayInputStream(bytes) }, dir, 600, 1_000L, upright)
    assertNotNull(first)
    assertEquals("background-1000.jpg", first!!.file.name)
    assertEquals(600 to 450, first.width to first.height)
    val decoded = BitmapFactory.decodeFile(first.file.path)!!
    assertEquals(600, decoded.width)
    assertTrue(Color.red(decoded.getPixel(10, 10)) > 200)

    val second = StartPageImages.copyScaled({ ByteArrayInputStream(png(500, 500, Color.BLUE)) }, dir, 1920, 2_000L, upright)!!
    assertEquals(500 to 500, second.width to second.height)
    assertFalse(first.file.exists())
    assertEquals(listOf("background-2000.jpg"), dir.list()!!.toList())
  }

  @Test fun aSidewaysPhotoIsTurnedUpright() {
    val dir = folder.newFolder("rotate")
    val bytes = png(1000, 500)
    val saved = StartPageImages.copyScaled({ ByteArrayInputStream(bytes) }, dir, 1920, 9L) { ExifInterface.ORIENTATION_ROTATE_90 }!!
    assertEquals(500 to 1000, saved.width to saved.height)
  }

  // A file that isn't an image is refused by Android's BitmapFactory (no bounds); this Robolectric set-up decodes any
  // bytes as a placeholder, so only "nothing could be read" is checked here.
  @Test fun nothingReadableIsRefusedAndNothingIsWritten() {
    val dir = folder.newFolder("not-image")
    assertNull(StartPageImages.copyScaled({ null }, dir, 1920, 1L, upright))
    assertNull(StartPageImages.copyScaled({ throw java.io.IOException("gone") }, dir, 1920, 1L, upright))
    assertEquals(0, dir.list()!!.size)
  }

  @Test fun clearDeletesTheBackground() {
    val dir = folder.newFolder("clear")
    StartPageImages.copyScaled({ ByteArrayInputStream(png(100, 100)) }, dir, 1920, 5L, upright)
    assertTrue(StartPageImages.clear(dir))
    assertEquals(0, dir.list()!!.size)
    assertTrue(StartPageImages.clear(java.io.File(dir, "missing")))
  }

  @Test fun usesThePhotoPickerWhereAndroidHasItElseTheDocumentPicker() {
    assertTrue(PhotoPicker.hasSystemPicker(33, 0))
    assertTrue(PhotoPicker.hasSystemPicker(30, 2))
    assertFalse(PhotoPicker.hasSystemPicker(30, 1))
    assertFalse(PhotoPicker.hasSystemPicker(28, 0))
    assertEquals(MediaStore.ACTION_PICK_IMAGES, PhotoPicker.intent(34, 0).action)
    val fallback = PhotoPicker.intent(26, 0)
    assertEquals(Intent.ACTION_OPEN_DOCUMENT, fallback.action)
    assertEquals("image/*", fallback.type)
    assertTrue(fallback.hasCategory(Intent.CATEGORY_OPENABLE))
  }
}
