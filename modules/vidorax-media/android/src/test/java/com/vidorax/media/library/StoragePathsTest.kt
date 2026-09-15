package com.vidorax.media.library

import com.vidorax.media.model.SiteId
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class StoragePathsTest {
  @get:Rule
  val temp = TemporaryFolder()

  private val filesDir get() = File(temp.root, "files")

  private fun paths() = StoragePaths(filesDir, File(temp.root, "no_backup"))

  @Test
  fun layout() {
    val paths = paths()

    assertEquals(File(filesDir, "library"), paths.libraryDir)
    assertEquals(File(filesDir, "thumbs/abc.webp"), paths.thumbnailFile("abc"))
    assertEquals(File(temp.root, "no_backup/work/a_b"), paths.workDir("a/b"))
    assertEquals(File(filesDir, "VidoraXDownloads"), paths.legacyDownloadsDir)
  }

  @Test
  fun libraryFilesAreGroupedBySiteAndNeverOverwrite() {
    val paths = paths()
    val first = paths.newLibraryFile(SiteId.INSTAGRAM, "Reel", "id-12345678", "mp4")
    assertEquals(File(filesDir, "library/instagram/Reel_12345678.mp4"), first)

    first.parentFile!!.mkdirs()
    first.createNewFile()

    assertEquals(
      File(filesDir, "library/instagram/Reel_12345678-2.mp4"),
      paths.newLibraryFile(SiteId.INSTAGRAM, "Reel", "id-12345678", "mp4"),
    )
  }

  @Test
  fun storedPathsAreRelativeToFilesDir() {
    val paths = paths()
    val file = paths.newLibraryFile(SiteId.WEB, "Clip", "abcdefgh", "webm")

    assertEquals("library/web/Clip_abcdefgh.webm", paths.toStoredPath(file))
    assertEquals(file, paths.fromStoredPath(paths.toStoredPath(file)))
  }

  @Test(expected = IllegalArgumentException::class)
  fun filesOutsideAppStorageCannotBeStored() {
    paths().toStoredPath(File(temp.root, "elsewhere/clip.mp4"))
  }
}
