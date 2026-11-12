package com.vidorax.media.incoming

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vidorax.media.MediaServices
import com.vidorax.media.library.IncomingImport
import com.vidorax.media.library.SavedCopy
import com.vidorax.media.model.SiteId
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On-device: "Open with VidoraX" from another app's FileProvider, then "Save to VidoraX" — the real reader (the
 * provider's display name and size), the real import (MediaMetadataRetriever, a real thumbnail, SQLite) and the real
 * duplicate check.
 */
@RunWith(AndroidJUnit4::class)
class IncomingImportAndroidTest {
  private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
  private val services get() = MediaServices.get(context)
  private val imported = mutableListOf<String>()
  private lateinit var source: File

  @After fun tearDown() = runBlocking {
    if (imported.isNotEmpty()) services.library.delete(imported)
    if (::source.isInitialized) source.parentFile?.deleteRecursively()
  }

  @Test fun aFileProviderVideoIsReadThenSavedOnceIntoTheLibrary() = runBlocking {
    // Other on-device tests save av.mp4 itself (library and gallery): a trailing `free` box makes these bytes unique.
    val bytes = javaClass.getResourceAsStream("/media/av.mp4")!!.use { it.readBytes() } + uniqueFreeBox()
    source = File(File(services.paths.libraryDir, "incoming-test-${System.nanoTime()}"), "Clip from Files.mp4").apply {
      parentFile?.mkdirs()
      writeBytes(bytes)
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.vidorax.files", source)
    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "video/mp4").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

    val media = IncomingMediaReader(context.contentResolver).take(intent)!!
    assertEquals("Clip from Files.mp4", media.displayName)
    assertEquals(bytes.size.toLong(), media.sizeBytes)
    assertEquals(IncomingMedia.Kind.VIDEO, media.kind)
    assertEquals(IncomingMediaIntents.tokenFor(uri), media.token)

    val first = services.incomingImport.import(media) as IncomingImport.Outcome.Imported
    imported += first.item.id
    val item = services.library.get(first.item.id)!!
    assertEquals(SiteId.DEVICE, item.site)
    assertEquals("Clip from Files", item.title)
    assertTrue(item.file.readBytes().contentEquals(bytes))
    assertTrue("real duration", (item.durationMs ?: 0) > 0)
    assertTrue("real size", (item.width ?: 0) > 0 && (item.height ?: 0) > 0)
    assertTrue("a real frame as thumbnail", item.thumbnail?.isFile == true)

    val again = services.incomingImport.import(media)
    assertEquals(IncomingImport.Outcome.Duplicate(SavedCopy(item.id, null)), again)
    assertTrue(services.paths.importRoot.listFiles().orEmpty().isEmpty())
  }

  private fun uniqueFreeBox(): ByteArray {
    val filler = "incoming-import-${System.nanoTime()}".toByteArray()
    val size = 8 + filler.size
    return byteArrayOf((size ushr 24).toByte(), (size ushr 16).toByte(), (size ushr 8).toByte(), size.toByte()) +
      "free".toByteArray() + filler
  }
}
