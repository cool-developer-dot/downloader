package com.vidorax.media.files

import android.database.MatrixCursor
import android.provider.DocumentsContract
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class FolderAccessTest {
  private fun cursor(vararg rows: Array<Any?>) = MatrixCursor(FolderAccess.PROJECTION).apply { rows.forEach(::addRow) }

  @Test
  fun `children are mapped, folders first then by name, hidden names skipped`() {
    val docs = FolderAccess.readDocuments(
      cursor(
        arrayOf("primary:Movies/b.mp4", "b.mp4", "video/mp4", 2048L, 1_700L),
        arrayOf("primary:Movies/Series", "Series", DocumentsContract.Document.MIME_TYPE_DIR, null, 1_600L),
        arrayOf("primary:Movies/.nomedia", ".nomedia", "application/octet-stream", 0L, 1L),
        arrayOf("primary:Movies/A.mkv", "A.mkv", "video/x-matroska", 10L, null),
      ),
      limit = 100,
    ) { id -> "content://tree/doc/$id" }

    assertEquals(listOf("Series", "A.mkv", "b.mp4"), docs.map { it.name })
    val folder = docs[0]
    assertTrue(folder.isDirectory)
    assertNull(folder.mimeType)
    assertNull(folder.sizeBytes)
    val file = docs[2]
    assertFalse(file.isDirectory)
    assertEquals("video/mp4", file.mimeType)
    assertEquals(2048L, file.sizeBytes)
    assertEquals(1_700L, file.modifiedAt)
    assertEquals("content://tree/doc/primary:Movies/b.mp4", file.uri)
    assertNull(docs[1].modifiedAt)
  }

  @Test
  fun `the limit caps the rows read and rows without an id or name are skipped`() {
    val docs = FolderAccess.readDocuments(
      cursor(
        arrayOf(null, "x.mp4", "video/mp4", 1L, 1L),
        arrayOf("id2", null, "video/mp4", 1L, 1L),
        arrayOf("id3", "c.mp4", "video/mp4", 1L, 1L),
        arrayOf("id4", "d.mp4", "video/mp4", 1L, 1L),
        arrayOf("id5", "e.mp4", "video/mp4", 1L, 1L),
      ),
      limit = 2,
    ) { it }
    assertEquals(listOf("c.mp4", "d.mp4"), docs.map { it.name })
  }

  @Test
  fun `toMap sends numbers as doubles for JavaScript`() {
    val map = FolderDocument("id", "uri", "n.mp4", "video/mp4", 5L, 6L, false).toMap()
    assertEquals(5.0, map["sizeBytes"])
    assertEquals(6.0, map["modifiedAt"])
    assertEquals(false, map["isDirectory"])
  }
}
