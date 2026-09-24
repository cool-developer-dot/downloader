package com.vidorax.media.library

import com.vidorax.media.NotFoundException
import com.vidorax.media.db.MediaDatabase
import com.vidorax.media.model.Container
import com.vidorax.media.model.LibraryChange
import com.vidorax.media.model.LibraryChangeReason
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.LibraryQuery
import com.vidorax.media.model.SiteId
import java.io.File
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** The library's own repair: a row never outlives the file it promises. */
@RunWith(RobolectricTestRunner::class)
class LibraryStoreTest {
  private val context = RuntimeEnvironment.getApplication()
  private lateinit var database: MediaDatabase
  private lateinit var paths: StoragePaths
  private lateinit var store: LibraryStore

  @Before fun setUp() {
    database = MediaDatabase(context)
    paths = StoragePaths.from(context)
    store = LibraryStore(database, paths)
  }

  @After fun tearDown() {
    database.close()
    File(context.noBackupFilesDir, MediaDatabase.NAME).delete()
    paths.libraryDir.deleteRecursively()
    paths.thumbnailsDir.deleteRecursively()
  }

  private fun item(
    id: String,
    bytes: Int = 1_000,
    container: Container = Container.MP4,
    mimeType: String = "video/mp4",
    extension: String = "mp4",
  ): LibraryItem {
    val file = paths.newLibraryFile(SiteId.WEB, "Clip $id", id, extension).apply {
      parentFile?.mkdirs()
      writeBytes(ByteArray(bytes) { 7 })
    }
    val thumb = paths.thumbnailFile(id).apply {
      parentFile?.mkdirs()
      writeBytes(ByteArray(10))
    }
    return LibraryItem(
      id = id,
      title = "Clip $id",
      site = SiteId.WEB,
      pageUrl = "https://example.test/$id",
      sourceUrl = null,
      file = file,
      mimeType = mimeType,
      container = container,
      videoCodec = "video/avc",
      audioCodec = "audio/mp4a-latm",
      hasAudio = true,
      width = 640,
      height = 360,
      durationMs = 10_000,
      sizeBytes = bytes.toLong(),
      thumbnail = thumb,
      favorite = false,
      galleryUri = null,
      createdAt = 1_000,
      completedAt = 2_000,
    )
  }

  private suspend fun ids(): List<String> = store.list(LibraryQuery(limit = 200)).items.map { it.id }.sorted()

  @Test fun aFileDeletedOutsideTheAppRemovesItsRowAndThumbnailAndIsAnnounced() = runBlocking {
    val a = item("a").also { store.insert(it) }
    val b = item("b").also { store.insert(it) }
    val c = item("c").also { store.insert(it) }
    val changes = mutableListOf<LibraryChange>()
    val collector = launch(Dispatchers.Unconfined, start = CoroutineStart.UNDISPATCHED) {
      store.changes.collect { changes.add(it) }
    }

    assertTrue(b.file.delete()) // e.g. removed with a file manager, or the storage was wiped

    val removed = store.removeMissingFiles()
    collector.cancel()

    assertEquals(listOf("b"), removed)
    assertEquals(listOf("a", "c"), ids())
    assertFalse("its thumbnail goes with it", b.thumbnail!!.exists())
    assertTrue(a.file.exists() && c.file.exists())
    assertTrue(
      "every screen hears that the item is gone",
      changes.any { it.reason == LibraryChangeReason.DELETED && it.ids == listOf("b") },
    )
  }

  @Test fun anEmptyFileIsAsGoodAsMissing() = runBlocking {
    val a = item("a").also { store.insert(it) }
    a.file.writeBytes(ByteArray(0))

    assertEquals(listOf("a"), store.removeMissingFiles())
    assertTrue(ids().isEmpty())
  }

  @Test fun aCheckLimitedToSomeIdsLeavesTheOthersAlone() = runBlocking {
    val a = item("a").also { store.insert(it) }
    item("c").also { store.insert(it) }
    a.file.delete()

    assertTrue(store.removeMissingFiles(listOf("c")).isEmpty())
    assertEquals(listOf("a", "c"), ids())
    assertEquals(listOf("a"), store.removeMissingFiles(listOf("a", "unknown")))
    assertEquals(listOf("c"), ids())
  }

  @Test fun aHealthyLibraryIsLeftExactlyAsItWas() = runBlocking {
    item("a").also { store.insert(it) }
    item("b").also { store.insert(it) }

    assertTrue(store.removeMissingFiles().isEmpty())
    assertEquals(listOf("a", "b"), ids())
  }

  @Test fun anActionOnAMissingFileRepairsTheLibraryBeforeRefusing() = runBlocking {
    val a = item("a").also { store.insert(it) }
    a.file.delete()

    assertThrows(NotFoundException::class.java) { runBlocking { store.requireFiles(listOf("a")) } }
    assertNull("the phantom row is gone, not left for the next tap", store.get("a"))
  }

  @Test fun aMovRecordedAsMp4ByAnOlderBuildReadsAsQuickTime() = runBlocking {
    store.insert(item("m", container = Container.MOV, mimeType = "video/mp4", extension = "mov"))

    val read = store.get("m")!!
    assertEquals("video/quicktime", read.mimeType)
    assertEquals(Container.MOV, read.container)
  }
}
