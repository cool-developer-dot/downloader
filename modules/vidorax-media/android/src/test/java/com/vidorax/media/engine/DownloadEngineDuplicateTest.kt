package com.vidorax.media.engine

import com.vidorax.media.AlreadyDownloadedException
import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.SavedCopy
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.EnqueueResult
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** One download per video: the same video is never downloaded, finalized or published twice. */
class DownloadEngineDuplicateTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val saved = FakeSavedVideos()
  private val gallery = RecordingGallery()
  private val ids = AtomicInteger(0)

  @Before fun setUp() {
    dispatcher = Executors.newFixedThreadPool(4).asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
  }

  @After fun tearDown() { dispatcher.close() }

  @Test fun theSameVideoWhileItDownloadsIsTheExistingDownload() = runBlocking {
    val release = CompletableDeferred<Unit>()
    val engine = engine(transfers = blockingWrites(1000, release))
    val first = engine.enqueueUnique(request("https://cdn.example/clip.mp4?oh=1&oe=2", page = PAGE))
    // Re-signed link of the same file, from the same page: the same video.
    val second = engine.enqueueUnique(request("https://cdn.example/clip.mp4?oh=9&oe=8", page = PAGE))

    assertTrue(first is EnqueueResult.Enqueued)
    assertTrue(second is EnqueueResult.AlreadyDownloading)
    assertEquals((first as EnqueueResult.Enqueued).record.id, (second as EnqueueResult.AlreadyDownloading).record.id)
    assertEquals("one row for the video", 1, store.list(System.currentTimeMillis()).size)
    release.complete(Unit)
    engine.awaitIdle()
    assertEquals(1, library.items.size)
  }

  @Test fun rapidTapsFromManyThreadsStartExactlyOneDownload() = runBlocking {
    val release = CompletableDeferred<Unit>()
    val engine = engine(transfers = blockingWrites(1000, release))
    val results = withContext(Dispatchers.Default) {
      (1..12).map { async { engine.enqueueUnique(request("https://cdn.example/tap.mp4")) } }.awaitAll()
    }

    assertEquals(1, results.count { it is EnqueueResult.Enqueued })
    assertEquals(11, results.count { it is EnqueueResult.AlreadyDownloading })
    assertEquals(1, results.map { resultId(it) }.toSet().size)
    release.complete(Unit)
    engine.awaitIdle()
    assertEquals(1, library.insertCalls.get())
  }

  @Test fun aVideoAlreadySavedIsNotDownloadedAgain() = runBlocking {
    val transfers = CountingTransfers(writes(1000))
    val engine = engine(transfers = transfers)
    val first = engine.enqueueUnique(request("https://cdn.example/done.mp4")) as EnqueueResult.Enqueued
    engine.awaitIdle()
    saved.byIdentity[store.current(first.record.id)!!.identityKey!!] = SavedCopy(first.record.id, "content://gallery/1")

    val again = engine.enqueueUnique(request("https://cdn.example/done.mp4"))

    assertEquals(EnqueueResult.AlreadyDownloaded(first.record.id, "content://gallery/1"), again)
    assertEquals("no second transfer", 1, transfers.transferCount)
    assertEquals(1, store.list(System.currentTimeMillis()).size)
    // The older entry point says it with a code, never with a second download.
    val error = assertThrows(AlreadyDownloadedException::class.java) {
      runBlocking { engine.enqueue(request("https://cdn.example/done.mp4")) }
    }
    assertEquals("ERR_ALREADY_DOWNLOADED", error.code)
  }

  @Test fun theDuplicateCheckFindsAVideoBeforeAnyNetworkRequest() = runBlocking {
    val engine = engine(transfers = writes(10))
    assertNull(engine.findDuplicate(request("https://cdn.example/new.mp4")))
    val started = engine.enqueueUnique(request("https://cdn.example/new.mp4")) as EnqueueResult.Enqueued
    val found = engine.findDuplicate(request("https://cdn.example/new.mp4"))
    assertTrue(found is EnqueueResult.AlreadyDownloading || found == null) // may already have completed
    engine.awaitIdle()
    saved.byIdentity[store.current(started.record.id)!!.identityKey!!] = SavedCopy(started.record.id, null)
    assertEquals(EnqueueResult.AlreadyDownloaded(started.record.id, null), engine.findDuplicate(request("https://cdn.example/new.mp4")))
    assertEquals("a check never creates a download", 1, store.list(System.currentTimeMillis()).size)
  }

  @Test fun differentVideosWithTheSameFileNameAreBothDownloaded() = runBlocking {
    val engine = engine(transfers = writesDistinct(1000))
    val a = engine.enqueueUnique(request("https://a.example/media/video.mp4", title = "video"))
    val b = engine.enqueueUnique(request("https://b.example/other/video.mp4", title = "video"))
    engine.awaitIdle()

    assertTrue(a is EnqueueResult.Enqueued && b is EnqueueResult.Enqueued)
    assertEquals(2, library.items.size)
    assertEquals(2, library.items.values.map { it.file.name }.toSet().size)
    assertTrue(library.items.values.all { store.current(it.id)!!.state == DownloadState.COMPLETED })
  }

  @Test fun aPausedDuplicateIsResumedNotDoubled() = runBlocking {
    val release = CompletableDeferred<Unit>()
    val engine = engine(transfers = blockingWrites(1000, release))
    val first = engine.enqueueUnique(request("https://cdn.example/p.mp4")) as EnqueueResult.Enqueued
    waitForState(first.record.id, DownloadState.DOWNLOADING)
    engine.pause(first.record.id)

    val again = engine.enqueueUnique(request("https://cdn.example/p.mp4"))

    assertTrue(again is EnqueueResult.AlreadyDownloading)
    assertTrue(store.current(first.record.id)!!.state != DownloadState.PAUSED)
    release.complete(Unit)
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(first.record.id)!!.state)
    assertEquals(1, library.items.size)
  }

  @Test fun theSameBytesFromAnotherLinkAreDiscardedAsADuplicate() = runBlocking {
    val engine = engine(transfers = writes(1000))
    saved.sameContent = SavedCopy("older", null)
    val record = (engine.enqueueUnique(request("https://mirror.example/other-name.mp4")) as EnqueueResult.Enqueued).record
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.DUPLICATE, row.errorCode)
    assertEquals("Video already downloaded", row.errorMessage)
    assertTrue("no second library item", library.items.isEmpty())
    assertTrue("nothing published", gallery.published.isEmpty())
    assertFalse("the discarded copy is deleted", row.filePath?.let { paths.fromStoredPath(it).exists() } ?: false)
    assertFalse(paths.workDir(record.id).exists())
    assertTrue("not a completion", engine.listCompletions().isEmpty())
  }

  @Test fun aCompletedDownloadIsPublishedToTheGalleryAfterCompleted() = runBlocking {
    val engine = engine(transfers = writes(1000))
    val record = (engine.enqueueUnique(request("https://cdn.example/g.mp4")) as EnqueueResult.Enqueued).record
    engine.awaitIdle()

    assertEquals(listOf(record.id), gallery.published)
    assertEquals(DownloadState.COMPLETED, gallery.stateWhenPublished[record.id])
    val item = library.items.getValue(record.id)
    assertTrue("owed until the copy is recorded, so a process death resumes it", item.galleryPending)
    assertEquals(store.current(record.id)!!.identityKey, item.identityKey)
  }

  @Test fun noGalleryCopyWhenTheUserTurnedItOff() = runBlocking {
    val engine = engine(transfers = writes(1000), settings = DownloadSettings.DEFAULT.copy(autoSaveToGallery = false))
    engine.enqueueUnique(request("https://cdn.example/off.mp4"))
    engine.awaitIdle()

    assertEquals(1, library.items.size)
    assertTrue(gallery.published.isEmpty())
    assertFalse(library.items.values.single().galleryPending)
  }

  @Test fun aGalleryFailureNeverTouchesTheCompletedDownload() = runBlocking {
    gallery.failWith = IllegalStateException("MediaStore unavailable")
    val engine = engine(transfers = writes(1000))
    val record = (engine.enqueueUnique(request("https://cdn.example/f.mp4")) as EnqueueResult.Enqueued).record
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertNull(store.current(record.id)!!.errorCode)
    assertTrue(library.items.containsKey(record.id))
    assertTrue(library.items.getValue(record.id).file.isFile)
  }

  @Test fun aRowFromBeforeIdentitiesGetsOneAtRestartAndCountsAsADuplicate() = runBlocking {
    val old = DownloadRow(
      id = "old",
      state = DownloadState.PAUSED,
      kind = SourceKind.PROGRESSIVE,
      url = "https://cdn.example/legacy.mp4",
      request = RequestContext(null, null, null, emptyMap(), useCookies = false),
      title = "Legacy",
      site = SiteId.WEB,
      pageUrl = null,
      thumbnailUrl = null,
      qualityLabel = null,
      bytesDone = 0,
      totalBytes = null,
      errorCode = null,
      errorMessage = null,
      attempts = 0,
      saveToGallery = null,
      createdAt = 1,
      updatedAt = System.currentTimeMillis(),
    )
    store.create(old)
    val engine = engine(transfers = writes(10))
    engine.restore()

    assertEquals(DownloadIdentity.of(old.url, null, null), store.current("old")!!.identityKey)
    val again = engine.enqueueUnique(request("https://cdn.example/legacy.mp4"))
    assertEquals("old", (again as EnqueueResult.AlreadyDownloading).record.id)
    engine.awaitIdle()
  }

  // ---------- helpers ----------

  private fun resultId(result: EnqueueResult): String? = when (result) {
    is EnqueueResult.Enqueued -> result.record.id
    is EnqueueResult.AlreadyDownloading -> result.record.id
    is EnqueueResult.AlreadyDownloaded -> result.libraryItemId
  }

  private suspend fun waitForState(id: String, state: DownloadState) {
    repeat(500) {
      if (store.current(id)?.state == state) return
      kotlinx.coroutines.delay(10)
    }
    error("$id never reached $state")
  }

  private fun engine(transfers: Transfers, settings: DownloadSettings = DownloadSettings.DEFAULT) = DownloadEngine(
    store = store,
    prober = { ProbeResult.Success(SourceKind.PROGRESSIVE, "https://cdn.example/final", "video/mp4", Container.MP4, 1000, true, emptyList(), emptyList(), null) },
    transfers = transfers,
    verification = { _, _ -> VerifyResult.Valid },
    inspector = { MediaMetadata(null, null, null, null, true, false, "video/avc", null, null) },
    library = library,
    paths = paths,
    scope = scope,
    initialSettings = settings,
    savedVideos = saved,
    gallery = gallery.also { it.store = store },
    retryDelay = {},
    idFactory = { "dl-${ids.incrementAndGet()}" },
  )

  private fun request(url: String, title: String = "Clip", page: String? = null) = EnqueueRequest(
    url = url,
    kind = SourceKind.PROGRESSIVE,
    manifestText = null,
    audioUrl = null,
    variant = null,
    request = RequestContext(null, null, null, emptyMap(), useCookies = false),
    title = title,
    site = SiteId.WEB,
    pageUrl = page,
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = null,
  )

  private fun writes(bytes: Int) = FakeTransfers { _, spec, onProgress ->
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(ByteArray(bytes))
    onProgress(bytes.toLong(), bytes.toLong())
    TransferOutcome.Completed(bytes.toLong(), bytes.toLong(), "etag", spec.url)
  }

  private fun writesDistinct(bytes: Int) = FakeTransfers { call, spec, onProgress ->
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(ByteArray(bytes) { call.toByte() })
    onProgress(bytes.toLong(), bytes.toLong())
    TransferOutcome.Completed(bytes.toLong(), bytes.toLong(), "etag", spec.url)
  }

  private fun blockingWrites(bytes: Int, release: CompletableDeferred<Unit>) = FakeTransfers { _, spec, onProgress ->
    spec.partFile.parentFile?.mkdirs()
    onProgress(0, bytes.toLong())
    release.await()
    spec.partFile.writeBytes(ByteArray(bytes))
    onProgress(bytes.toLong(), bytes.toLong())
    TransferOutcome.Completed(bytes.toLong(), bytes.toLong(), "etag", spec.url)
  }

  private companion object {
    const val PAGE = "https://site.example/watch/1"
  }
}

internal class FakeSavedVideos : SavedVideos {
  val byIdentity = ConcurrentHashMap<String, SavedCopy>()

  @Volatile var sameContent: SavedCopy? = null

  override suspend fun findByIdentity(identityKey: String): SavedCopy? = byIdentity[identityKey]

  override suspend fun findByContent(file: File, excludeId: String, audioOnly: Boolean): SavedCopy? = sameContent

  override suspend fun backfillIdentities() = Unit
}

internal class RecordingGallery : GalleryPublisher {
  val published = CopyOnWriteArrayList<String>()
  val stateWhenPublished = ConcurrentHashMap<String, DownloadState>()
  lateinit var store: RecordingStore

  @Volatile var failWith: Exception? = null

  override suspend fun publish(id: String) {
    stateWhenPublished[id] = store.current(id)!!.state
    failWith?.let { throw it }
    published += id
  }

  override suspend fun resumePending() = Unit
}
