package com.vidorax.media.library

import android.net.Uri
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.NoSpaceException
import com.vidorax.media.NotFoundException
import com.vidorax.media.StorageException
import com.vidorax.media.db.MediaDatabase
import com.vidorax.media.incoming.IncomingMedia
import com.vidorax.media.model.Container
import com.vidorax.media.model.LibraryChange
import com.vidorax.media.model.LibraryChangeReason
import com.vidorax.media.model.LibraryQuery
import com.vidorax.media.model.SiteId
import java.io.File
import java.io.IOException
import java.io.InputStream
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

/** "Save to VidoraX": a file from another app joins the library once, and a failed save leaves nothing behind. */
@RunWith(RobolectricTestRunner::class)
class IncomingImportTest {
  private val context = RuntimeEnvironment.getApplication()
  private lateinit var database: MediaDatabase
  private lateinit var paths: StoragePaths
  private lateinit var store: LibraryStore
  private lateinit var index: SavedVideoIndex
  private lateinit var sources: File
  private var ids = 0

  private val videoInfo = MediaMetadata(
    durationMs = 10_000, width = 640, height = 360, bitrate = null, hasVideo = true, hasAudio = true,
    videoCodec = "video/avc", audioCodec = "audio/mp4a-latm", containerMimeType = "video/mp4",
  )
  private val nothingDecodable = MediaMetadata(null, null, null, null, false, false, null, null, null)

  @Before fun setUp() {
    database = MediaDatabase(context)
    paths = StoragePaths.from(context)
    store = LibraryStore(database, paths)
    index = SavedVideoIndex(store, GalleryExport(context, store))
    sources = File(context.cacheDir, "incoming-sources").apply { mkdirs() }
  }

  @After fun tearDown() {
    database.close()
    File(context.noBackupFilesDir, MediaDatabase.NAME).delete()
    paths.libraryDir.deleteRecursively()
    paths.thumbnailsDir.deleteRecursively()
    paths.importRoot.deleteRecursively()
    sources.deleteRecursively()
  }

  private fun importer(
    metadata: MediaMetadata = videoInfo,
    freeBytes: Long = Long.MAX_VALUE,
    open: (Uri) -> InputStream? = { uri -> File(uri.path!!).inputStream() },
  ) = IncomingImport(
    paths = paths,
    library = store,
    openStream = open,
    readMetadata = { metadata },
    makeThumbnail = { id, _, _ -> paths.thumbnailFile(id).apply { parentFile?.mkdirs(); writeBytes(ByteArray(8)) } },
    findSameContent = { file, audioOnly -> index.findByContent(file, excludeId = "", audioOnly = audioOnly) },
    freeBytes = { freeBytes },
    newId = { "import-test-${++ids}" },
    now = { 1_700_000_000_000 },
  )

  private fun source(name: String, bytes: ByteArray = ByteArray(4_096) { (it % 251).toByte() }): File =
    File(sources, name).apply { writeBytes(bytes) }

  private fun incoming(file: File, name: String? = file.name, mime: String? = "video/mp4", size: Long? = file.length()) =
    IncomingMedia("t-${file.name}", Uri.fromFile(file), name, mime, size, IncomingMedia.Kind.VIDEO)

  private suspend fun libraryIds() = store.list(LibraryQuery(limit = 200)).items.map { it.id }

  private fun leftovers(): List<String> = paths.importRoot.walkTopDown().filter { it.isFile }.map { it.name }.toList()

  @Test fun aFileIsCopiedIntoTheLibraryUnderDevice() = runBlocking {
    val file = source("Holiday clip.mp4")
    val changes = mutableListOf<LibraryChange>()
    val collector = launch(Dispatchers.Unconfined, start = CoroutineStart.UNDISPATCHED) {
      store.changes.collect { changes.add(it) }
    }

    val outcome = importer().import(incoming(file)) as IncomingImport.Outcome.Imported
    collector.cancel()

    val item = outcome.item
    assertEquals(SiteId.DEVICE, item.site)
    assertEquals("Holiday clip", item.title)
    assertEquals("video/mp4", item.mimeType)
    assertEquals(Container.MP4, item.container)
    assertEquals(640, item.width)
    assertEquals(10_000L, item.durationMs)
    assertNull(item.pageUrl)
    assertNull("the file is already on the device: no gallery copy", item.galleryUri)
    assertTrue(item.file.path.contains("/library/device/"))
    assertTrue(item.file.readBytes().contentEquals(file.readBytes()))
    assertTrue("the original is never touched", file.exists())
    assertTrue(item.thumbnail!!.exists())
    assertEquals(listOf(item.id), libraryIds())
    assertTrue(changes.any { it.reason == LibraryChangeReason.IMPORTED && it.ids == listOf(item.id) })
    assertEquals(emptyList<String>(), leftovers())
  }

  @Test fun theSameBytesAgainAreAlreadyInTheLibrary() = runBlocking {
    val first = importer().import(incoming(source("a.mp4"))) as IncomingImport.Outcome.Imported
    // Same bytes under another name, from another app.
    val again = importer().import(incoming(source("copy of a.mp4"), name = "copy of a.mp4"))

    assertEquals(IncomingImport.Outcome.Duplicate(SavedCopy(first.item.id, null)), again)
    assertEquals(listOf(first.item.id), libraryIds())
    assertEquals(1, paths.libraryDir.walkTopDown().count { it.isFile })
    assertEquals(emptyList<String>(), leftovers())
  }

  @Test fun differentBytesOfTheSameSizeAreANewItem() = runBlocking {
    importer().import(incoming(source("a.mp4", ByteArray(2_000) { 1 })))
    val other = importer().import(incoming(source("b.mp4", ByteArray(2_000) { 2 })))
    assertTrue(other is IncomingImport.Outcome.Imported)
    assertEquals(2, libraryIds().size)
  }

  @Test fun aCopyThatFailsLeavesNothingBehind() = runBlocking {
    val file = source("broken.mp4")
    val failing: (Uri) -> InputStream = {
      object : InputStream() {
        var served = 0
        override fun read(): Int = if (served++ < 1_000) 7 else throw IOException("provider went away")
      }
    }
    assertThrows(StorageException::class.java) { runBlocking { importer(open = failing).import(incoming(file)) } }

    assertEquals(emptyList<String>(), libraryIds())
    assertFalse(paths.libraryDir.walkTopDown().any { it.isFile })
    assertFalse(paths.thumbnailsDir.walkTopDown().any { it.isFile })
    assertEquals(emptyList<String>(), leftovers())
  }

  @Test fun aFileThatCanNoLongerBeReadIsNotFound() = runBlocking {
    val file = source("gone.mp4")
    assertThrows(NotFoundException::class.java) { runBlocking { importer(open = { null }).import(incoming(file)) } }
    assertThrows(NotFoundException::class.java) {
      runBlocking { importer(open = { throw SecurityException("grant revoked") }).import(incoming(file)) }
    }
    assertEquals(emptyList<String>(), leftovers())
  }

  @Test fun somethingThatIsNotAudioOrVideoIsRefused() = runBlocking {
    val file = source("notes.pdf")
    assertThrows(InvalidRequestException::class.java) {
      runBlocking { importer(metadata = nothingDecodable).import(incoming(file, mime = "application/pdf")) }
    }
    val empty = source("empty.mp4", ByteArray(0))
    assertThrows(InvalidRequestException::class.java) { runBlocking { importer().import(incoming(empty, size = null)) } }
    assertEquals(emptyList<String>(), libraryIds())
    assertFalse(paths.libraryDir.walkTopDown().any { it.isFile })
    assertEquals(emptyList<String>(), leftovers())
  }

  @Test fun notEnoughStorageIsSaidBeforeCopying() = runBlocking {
    var opened = false
    val file = source("big.mp4")
    assertThrows(NoSpaceException::class.java) {
      runBlocking {
        importer(freeBytes = 10L * 1024 * 1024, open = { opened = true; it.path!!.let(::File).inputStream() })
          .import(incoming(file, size = 100L * 1024 * 1024))
      }
    }
    assertFalse(opened)
    assertEquals(emptyList<String>(), libraryIds())
  }

  @Test fun aFileAndroidCannotDecodeIsStillKeptForOpenWith() = runBlocking {
    // DivX 3 in AVI: no decoder on the device, but the user still wants it saved (opened with another app).
    val outcome = importer(metadata = nothingDecodable)
      .import(incoming(source("old film.avi"), mime = "video/x-msvideo")) as IncomingImport.Outcome.Imported
    assertEquals(Container.AVI, outcome.item.container)
    assertEquals("video/x-msvideo", outcome.item.mimeType)
    assertTrue(outcome.item.file.name.endsWith(".avi"))
  }

  @Test fun anAudioFileKeepsItsAudioTypeAndGetsNoThumbnail() = runBlocking {
    val song = source("song.mp3")
    val outcome = importer(metadata = videoInfo.copy(hasVideo = false, width = null, height = null, containerMimeType = "audio/mpeg"))
      .import(IncomingMedia("t-song", Uri.fromFile(song), "song.mp3", "audio/mpeg", song.length(), IncomingMedia.Kind.AUDIO))
      as IncomingImport.Outcome.Imported
    assertEquals("audio/mpeg", outcome.item.mimeType)
    assertTrue(outcome.item.file.name.endsWith(".mp3"))
    assertNull(outcome.item.thumbnail)
  }

  @Test fun aTypeIsTakenFromTheMimeTypeWhenTheNameHasNone() = runBlocking {
    val outcome = importer().import(incoming(source("12345"), name = "12345", mime = "video/webm"))
      as IncomingImport.Outcome.Imported
    assertEquals(Container.WEBM, outcome.item.container)
    assertTrue(outcome.item.file.name.endsWith(".webm"))
    assertEquals("12345", outcome.item.title)
  }

  @Test fun leftoversOfAnImportTheProcessDiedInAreRemoved() = runBlocking {
    val stale = File(paths.importDir("earlier"), "incoming").apply { parentFile?.mkdirs(); writeBytes(ByteArray(100)) }
    importer().import(incoming(source("a.mp4")))
    assertFalse(stale.exists())
    assertEquals(emptyList<String>(), leftovers())
  }
}
