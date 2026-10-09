package com.vidorax.media.engine

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vidorax.media.db.MediaDatabase
import com.vidorax.media.library.GalleryExport
import com.vidorax.media.library.LibraryStore
import com.vidorax.media.library.MediaInfo
import com.vidorax.media.library.SavedVideoIndex
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.EnqueueResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.plan.Probe
import com.vidorax.media.transfer.ProgressiveTransfer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On-device: the real engine with the real duplicate index and gallery export, against real SQLite and the device's
 * real MediaStore. A completed download gets exactly one gallery copy with the right name, type and folder; the same
 * video is never downloaded, finalized or published twice; different videos with the same file name both are.
 */
@RunWith(AndroidJUnit4::class)
class GalleryDuplicateE2EAndroidTest {
  private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

  private lateinit var db: MediaDatabase
  private lateinit var paths: StoragePaths
  private lateinit var library: LibraryStore
  private lateinit var gallery: GalleryExport
  private lateinit var store: SqliteDownloadStore
  private lateinit var scope: CoroutineScope
  private lateinit var server: MockWebServer
  private lateinit var media: ByteArray
  private lateinit var otherMedia: ByteArray

  private fun newEngine() = DownloadEngine(
    store = store,
    prober = RealProber(Probe(HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL))),
    transfers = RealTransfers(ProgressiveTransfer(HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL))),
    verification = RealVerification,
    inspector = RealMediaInspector(MediaInfo(context)),
    library = RealLibraryWriter(library),
    paths = paths,
    scope = scope,
    savedVideos = RealSavedVideos(SavedVideoIndex(library, gallery)),
    gallery = RealGalleryPublisher(gallery),
  )

  @Before fun setUp() = runBlocking {
    assumeTrue("MediaStore publishing (Android 10+)", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
    media = javaClass.getResourceAsStream("/media/av.mp4")!!.use { it.readBytes() }
    // Another video with the same size and container: one byte inside the media data differs.
    otherMedia = media.copyOf().also { bytes ->
      val mdat = indexOf(bytes, "mdat".toByteArray())
      val at = mdat + (bytes.size - mdat) / 2
      bytes[at] = (bytes[at].toInt() xor 0x5A).toByte()
    }
    deleteTestGalleryItems()
    db = MediaDatabase(context)
    db.transaction {
      it.execSQL("DELETE FROM downloads")
      it.execSQL("DELETE FROM library")
      it.execSQL("DELETE FROM gallery_exports")
    }
    paths = StoragePaths.from(context)
    listOf(paths.libraryDir, paths.workRoot, paths.thumbnailsDir).forEach { it.deleteRecursively() }
    library = LibraryStore(db, paths)
    gallery = GalleryExport(context, library)
    store = SqliteDownloadStore(db)
    scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    server = MockWebServer().apply { dispatcher = Files(media, otherMedia); start() }
  }

  @After fun tearDown() {
    if (!::db.isInitialized) return
    runCatching { server.shutdown() }
    scope.cancel()
    db.close()
    deleteTestGalleryItems()
  }

  @Test fun aCompletedDownloadHasExactlyOneGalleryCopyWithItsNameTypeAndFolder() = runBlocking {
    val engine = newEngine()
    val record = (engine.enqueueUnique(request("/a/video.mp4", title = "Sunset: clip")) as EnqueueResult.Enqueued).record
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.find(record.id)!!.state)
    val item = library.get(record.id)!!
    val uri = Uri.parse(item.galleryUri ?: error("no gallery copy recorded"))
    assertEquals("recorded, no longer pending", false, item.galleryPending)
    val row = galleryRow(uri)!!
    assertEquals("Sunset clip.mp4", row.name)
    assertEquals("video/mp4", row.mime)
    assertEquals("Movies/VidoraX/Web/", row.relativePath)
    assertEquals(media.size.toLong(), row.size)
    assertEquals("only the final file is published", 0, row.pending)
    assertEquals(1, testGalleryItems().size)

    // Saving again (the Library action) reuses the copy: never `Sunset clip (1).mp4`.
    gallery.save(listOf(record.id))
    assertEquals(uri.toString(), library.get(record.id)!!.galleryUri)
    assertEquals(1, testGalleryItems().size)
  }

  @Test fun theSameVideoIsNeverDownloadedOrPublishedTwice() = runBlocking {
    val engine = newEngine()
    val first = engine.enqueueUnique(request("/a/video.mp4")) as EnqueueResult.Enqueued
    engine.awaitIdle()

    // The same link: known before anything is downloaded.
    val again = engine.enqueueUnique(request("/a/video.mp4"))
    assertEquals(first.record.id, (again as EnqueueResult.AlreadyDownloaded).libraryItemId)

    // The same bytes through another link: downloaded, recognised by content, discarded.
    val mirror = (engine.enqueueUnique(request("/mirror/other-name.mp4")) as EnqueueResult.Enqueued).record
    engine.awaitIdle()
    val row = store.find(mirror.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.DUPLICATE, row.errorCode)
    assertNull(library.get(mirror.id))
    assertEquals(1, library.list(com.vidorax.media.model.LibraryQuery()).total)
    assertEquals("still one gallery copy", 1, testGalleryItems().size)

    // Deleting the video in VidoraX keeps the user's gallery copy — and the video still counts as downloaded.
    library.delete(listOf(first.record.id))
    assertTrue(engine.enqueueUnique(request("/a/video.mp4")) is EnqueueResult.AlreadyDownloaded)
    // Once the user deletes that copy too, the video can be downloaded again.
    context.contentResolver.delete(testGalleryItems().single(), null, null)
    assertTrue(engine.enqueueUnique(request("/a/video.mp4")) is EnqueueResult.Enqueued)
    engine.awaitIdle()
  }

  @Test fun rapidTapsStartOneDownload() = runBlocking {
    val engine = newEngine()
    val results = (1..8).map { async(Dispatchers.IO) { engine.enqueueUnique(request("/a/video.mp4")) } }.awaitAll()
    engine.awaitIdle()

    assertEquals(1, results.count { it is EnqueueResult.Enqueued })
    assertEquals(1, library.list(com.vidorax.media.model.LibraryQuery()).total)
    assertEquals(1, testGalleryItems().size)
  }

  @Test fun differentVideosWithTheSameFileNameAreBothKept() = runBlocking {
    val engine = newEngine()
    val a = engine.enqueueUnique(request("/a/video.mp4", title = "video"))
    val b = engine.enqueueUnique(request("/b/video.mp4", title = "video"))
    engine.awaitIdle()

    assertTrue(a is EnqueueResult.Enqueued && b is EnqueueResult.Enqueued)
    val items = library.list(com.vidorax.media.model.LibraryQuery()).items
    assertEquals(2, items.size)
    assertTrue(items.all { store.find(it.id)!!.state == DownloadState.COMPLETED })
    val copies = items.map { Uri.parse(it.galleryUri!!) }
    assertNotEquals(copies[0], copies[1])
    // Two files, two names: `video.mp4` and MediaStore's own `video (n).mp4` (n depends on what the gallery holds).
    val names = copies.map { galleryRow(it)!!.name }
    assertEquals(2, names.toSet().size)
    assertTrue(names.all { it.matches(Regex("video( \\(\\d+\\))?\\.mp4")) })
  }

  @Test fun aCopyInterruptedBeforeItWasRecordedIsReusedAfterARestart() = runBlocking {
    val engine = newEngine()
    val record = (engine.enqueueUnique(request("/a/video.mp4")) as EnqueueResult.Enqueued).record
    engine.awaitIdle()
    val published = library.get(record.id)!!.galleryUri!!
    // A process death between publishing and recording: the item still owes its copy.
    db.transaction { it.execSQL("UPDATE library SET gallery_uri = NULL, gallery_state = 'pending'") }

    gallery.resumePending()

    assertEquals(published, library.get(record.id)!!.galleryUri)
    assertEquals(false, library.get(record.id)!!.galleryPending)
    assertEquals(1, testGalleryItems().size)
  }

  // ---------- helpers ----------

  private data class GalleryRow(val name: String, val mime: String, val relativePath: String, val size: Long, val pending: Int)

  private fun galleryRow(uri: Uri): GalleryRow? = context.contentResolver.query(
    uri,
    arrayOf(
      MediaStore.MediaColumns.DISPLAY_NAME,
      MediaStore.MediaColumns.MIME_TYPE,
      MediaStore.MediaColumns.RELATIVE_PATH,
      MediaStore.MediaColumns.SIZE,
      MediaStore.MediaColumns.IS_PENDING,
    ),
    null,
    null,
    null,
  )?.use { c -> if (c.moveToFirst()) GalleryRow(c.getString(0), c.getString(1), c.getString(2), c.getLong(3), c.getInt(4)) else null }

  /** Gallery items this test app owns in VidoraX's folder. */
  private fun testGalleryItems(): List<Uri> {
    val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    return context.contentResolver.query(
      collection,
      arrayOf(MediaStore.MediaColumns._ID),
      "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?",
      arrayOf("Movies/VidoraX/%"),
      null,
    )?.use { c -> buildList { while (c.moveToNext()) add(ContentUris.withAppendedId(collection, c.getLong(0))) } }.orEmpty()
  }

  private fun deleteTestGalleryItems() {
    testGalleryItems().forEach { runCatching { context.contentResolver.delete(it, null, null) } }
  }

  private fun request(path: String, title: String = "Clip"): EnqueueRequest = EnqueueRequest(
    url = server.url(path).toString(),
    kind = SourceKind.PROGRESSIVE,
    manifestText = null,
    audioUrl = null,
    variant = null,
    request = RequestContext("VidoraX-E2E", null, null, emptyMap(), useCookies = false),
    title = title,
    site = SiteId.WEB,
    pageUrl = null,
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = null,
  )

  private fun indexOf(haystack: ByteArray, needle: ByteArray): Int {
    outer@ for (i in 0..haystack.size - needle.size) {
      for (j in needle.indices) if (haystack[i + j] != needle[j]) continue@outer
      return i
    }
    error("no ${String(needle)} box")
  }
}

/** `/b/…` serves the other video; everything else the first one. 200 for full reads, 206 for ranges. */
private class Files(private val media: ByteArray, private val other: ByteArray) : Dispatcher() {
  override fun dispatch(request: RecordedRequest): MockResponse {
    val body = if (request.requestUrl?.encodedPath?.startsWith("/b/") == true) other else media
    val range = request.getHeader("Range")?.removePrefix("bytes=")?.substringBefore("-")?.toIntOrNull()
    val base = MockResponse()
      .setHeader("Content-Type", "video/mp4")
      .setHeader("Accept-Ranges", "bytes")
      .setHeader("ETag", "\"gallery-e2e-${body.contentHashCode()}\"")
    if (range == null) return base.setResponseCode(200).setBody(Buffer().write(body))
    val start = range.coerceIn(0, body.size - 1)
    return base.setResponseCode(206)
      .setHeader("Content-Range", "bytes $start-${body.size - 1}/${body.size}")
      .setBody(Buffer().write(body.copyOfRange(start, body.size)))
  }
}
