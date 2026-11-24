package com.vidorax.media.cast

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** Which files the cast server may read: VidoraX's own storage, never the Private Folder. */
@RunWith(RobolectricTestRunner::class)
class CastSourcesTest {
  private val context = RuntimeEnvironment.getApplication()

  private fun write(dir: File, name: String, size: Int = 64): File =
    File(dir, name).apply {
      parentFile!!.mkdirs()
      writeBytes(ByteArray(size) { it.toByte() })
    }

  @Test fun aLibraryFileIsServedWithItsLengthAndType() {
    val file = write(File(context.filesDir, "library/device"), "clip.mp4", 1234)
    val served = CastSources.open(context, file.toURI().toString(), null)
    assertEquals(1234L, served.length)
    assertEquals("video/mp4", served.contentType)
    served.open(1000).use { assertEquals(1000.toByte(), it.read().toByte()) }
  }

  @Test fun theGivenContentTypeWins() {
    val file = write(File(context.filesDir, "library/web"), "clip.bin")
    assertEquals("video/webm", CastSources.open(context, file.toURI().toString(), "video/webm").contentType)
  }

  @Test fun privateFolderFilesAreNeverServed() {
    val vault = write(File(context.noBackupFilesDir, "vault"), "0f0f.video")
    val playing = write(File(context.cacheDir, "vault-play"), "123e4567-e89b-12d3-a456-426614174000.mp4")
    for (file in listOf(vault, playing)) {
      assertFalse(CastSources.isServableFile(context, file))
      val refused = assertThrows(CastSourceRefusedException::class.java) {
        CastSources.open(context, file.toURI().toString(), null)
      }
      assertEquals(CastSourceRefusedException.Reason.PRIVATE, refused.reason)
    }
  }

  @Test fun filesOutsideVidoraXAreRefused() {
    val outside = write(File(context.cacheDir, "elsewhere"), "clip.mp4")
    val refused = assertThrows(CastSourceRefusedException::class.java) {
      CastSources.open(context, outside.toURI().toString(), null)
    }
    assertEquals(CastSourceRefusedException.Reason.OUTSIDE_APP, refused.reason)
  }

  @Test fun aPathThatClimbsOutIsRefused() {
    write(File(context.noBackupFilesDir, "vault"), "secret.video")
    val sneaky = File(context.filesDir, "library/../../" + context.noBackupFilesDir.name + "/vault/secret.video")
    assertFalse(CastSources.isServableFile(context, sneaky))
    assertTrue(CastSources.isServableFile(context, File(context.filesDir, "library/a/../b.mp4")))
  }

  @Test fun aMissingFileIsRefused() {
    val refused = assertThrows(CastSourceRefusedException::class.java) {
      CastSources.open(context, File(context.filesDir, "library/none.mp4").toURI().toString(), null)
    }
    assertEquals(CastSourceRefusedException.Reason.MISSING, refused.reason)
  }

  @Test fun onlyLocalFilesAreServed() {
    val refused = assertThrows(CastSourceRefusedException::class.java) {
      CastSources.open(context, "https://example.com/a.mp4", null)
    }
    assertEquals(CastSourceRefusedException.Reason.NOT_LOCAL, refused.reason)
  }

  @Test fun aDownloadStillGrowingIsRefused() {
    val refused = assertThrows(CastSourceRefusedException::class.java) {
      CastSources.open(context, "content://com.example.vidorax.growing/v/abc", null)
    }
    assertEquals(CastSourceRefusedException.Reason.GROWING, refused.reason)
  }

  @Test fun mimeTypesByExtension() {
    assertEquals("video/mp4", CastMimeTypes.forName("a.MP4"))
    assertEquals("video/webm", CastMimeTypes.forName("a.webm"))
    assertEquals("audio/mpeg", CastMimeTypes.forName("song.mp3"))
    assertEquals("video/mp4", CastMimeTypes.forName("noextension"))
  }
}
