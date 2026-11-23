package com.vidorax.media.library

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import com.vidorax.media.db.MediaDatabase
import expo.modules.kotlin.exception.CodedException
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.GraphicsMode

/** P10 Screenshot (#675): the frame keeps its full size, only the latest share copy stays, nothing is recycled. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FrameExportTest {
  @get:Rule val folder = TemporaryFolder()

  private fun paths() = StoragePaths(folder.newFolder("files"), folder.newFolder("no_backup"))

  private fun frame(width: Int, height: Int, color: Int = Color.GREEN): Bitmap =
    Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }

  @Test
  fun theShareCopyIsAJpegAtTheFramesFullSize() {
    val paths = paths()
    val source = frame(1920, 1080)
    val file = FrameExport.writeShareCopy(paths, source, "Holiday 12m05.4s")
    assertEquals(File(paths.libraryDir, ".frame-exports"), file.parentFile)
    assertEquals("Holiday 12m05.4s.jpg", file.name)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    assertEquals(1920 to 1080, bounds.outWidth to bounds.outHeight)
    assertEquals("image/jpeg", bounds.outMimeType)
    // The frame belongs to expo-video: it is only read.
    assertFalse(source.isRecycled)
  }

  @Test
  fun onlyTheLatestShareCopyIsKept() {
    val paths = paths()
    val first = FrameExport.writeShareCopy(paths, frame(64, 36), "First")
    val second = FrameExport.writeShareCopy(paths, frame(36, 64, Color.BLUE), "Second / part: 2")
    assertFalse(first.exists())
    assertTrue(second.isFile)
    assertEquals(listOf(second.name), second.parentFile!!.list()!!.toList())
    // A title is never a path: unsafe characters become spaces.
    assertFalse(second.name.contains('/'))
  }

  @Test
  fun aReleasedFrameIsRefused() {
    val gone = frame(8, 8).apply { recycle() }
    val paths = paths()
    assertThrows(CodedException::class.java) { FrameExport.writeShareCopy(paths, gone, "Gone") }
    // Saving to the Gallery refuses it before MediaStore is touched (the library is never read for a frame).
    val context = RuntimeEnvironment.getApplication()
    val database = MediaDatabase(context)
    try {
      val export = ThumbnailExport(context, LibraryStore(database, paths))
      assertThrows(CodedException::class.java) { runBlocking { export.saveFrame(gone, "Gone") } }
    } finally {
      database.close()
      File(context.noBackupFilesDir, MediaDatabase.NAME).delete()
    }
  }
}
