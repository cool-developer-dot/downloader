package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.SavedCopy
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.EnqueueResult
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * H12 (Duplicate Action #386): `allowDuplicate` skips the identity check and the same-bytes check for that one
 * request — "Keep both" and the new copy of "Replace" become their own library items. Without it nothing changes.
 */
class DownloadEngineDuplicateBypassTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val saved = FakeSavedVideos()
  private val ids = AtomicInteger(0)
  private val bypassStorage = DuplicateBypass.Storage.memory()

  @Before fun setUp() {
    dispatcher = Executors.newFixedThreadPool(4).asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
  }

  @After fun tearDown() { dispatcher.close() }

  private val url = "https://cdn.example/clip.mp4"
  private val identity get() = DownloadIdentity.of(url, null, null)!!

  @Test fun withoutTheFlagASavedVideoIsStillAlreadyDownloaded() = runBlocking {
    saved.byIdentity[identity] = SavedCopy("old-item", null)
    val engine = engine()
    val result = engine.enqueueUnique(request())
    assertTrue(result is EnqueueResult.AlreadyDownloaded)
    assertEquals(0, store.list(System.currentTimeMillis()).size)
  }

  @Test fun withTheFlagASavedVideoIsDownloadedAgainAsItsOwnItem() = runBlocking {
    saved.byIdentity[identity] = SavedCopy("old-item", null)
    saved.sameContent = SavedCopy("old-item", null) // the very same bytes, too
    val engine = engine()
    val result = engine.enqueueUnique(request(allowDuplicate = true, title = "Clip (2)"))
    assertTrue(result is EnqueueResult.Enqueued)
    engine.awaitIdle()
    val id = (result as EnqueueResult.Enqueued).record.id
    val row = store.current(id)!!
    assertEquals(DownloadState.COMPLETED, row.state)
    assertEquals("a separate library item", "Clip (2)", library.items.getValue(id).title)
    assertTrue(library.items.getValue(id).file.name.startsWith("Clip (2)_"))
  }

  @Test fun theFlagCoversOnlyItsOwnRequest() = runBlocking {
    saved.byIdentity[identity] = SavedCopy("old-item", null)
    val engine = engine()
    engine.enqueueUnique(request(allowDuplicate = true))
    engine.awaitIdle()
    assertTrue("the next ordinary request is checked again", engine.enqueueUnique(request()) is EnqueueResult.AlreadyDownloaded)
    assertTrue(engine.findDuplicate(request()) is EnqueueResult.AlreadyDownloaded)
  }

  @Test fun theFlagAlsoSkipsAnUnfinishedDownloadOfTheVideo() = runBlocking {
    val release = CompletableDeferred<Unit>()
    val engine = engine(transfers = blocking(release))
    val first = engine.enqueueUnique(request()) as EnqueueResult.Enqueued
    assertTrue(engine.enqueueUnique(request()) is EnqueueResult.AlreadyDownloading)
    val second = engine.enqueueUnique(request(allowDuplicate = true))
    assertTrue(second is EnqueueResult.Enqueued)
    assertFalse(first.record.id == (second as EnqueueResult.Enqueued).record.id)
    release.complete(Unit)
    engine.awaitIdle()
  }

  @Test fun withoutTheFlagTheSameBytesStillEndAsDuplicate() = runBlocking {
    saved.sameContent = SavedCopy("old-item", null)
    val engine = engine()
    val record = engine.enqueue(request())
    engine.awaitIdle()
    assertEquals(DownloadState.FAILED, store.current(record.id)!!.state)
    assertEquals(DownloadErrorCode.DUPLICATE, store.current(record.id)!!.errorCode)
    assertTrue(library.items.isEmpty())
  }

  @Test fun theExemptionSurvivesARestartUntilTheCopyFinishes() = runBlocking {
    saved.sameContent = SavedCopy("old-item", null)
    val release = CompletableDeferred<Unit>()
    val first = engine(transfers = blocking(release))
    val id = (first.enqueueUnique(request(allowDuplicate = true)) as EnqueueResult.Enqueued).record.id
    // A new process: the engine is rebuilt from what was stored.
    assertTrue(DuplicateBypass(bypassStorage).contains(id))
    release.complete(Unit)
    first.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(id)!!.state)
  }

  @Test fun bypassedIdsOfDownloadsThatAreGoneAreDropped() {
    val bypass = DuplicateBypass(bypassStorage)
    bypass.add("a", live = listOf("a"))
    bypass.add("b", live = listOf("b"))
    assertFalse("a no longer exists", bypass.contains("a"))
    assertTrue(bypass.contains("b"))
    assertEquals(setOf("b"), DuplicateBypass(bypassStorage).all())
  }

  @Test fun anUnreadableStoredValueBypassesNothing() {
    val storage = DuplicateBypass.Storage.memory().also { it.write("{not json") }
    assertTrue(DuplicateBypass(storage).all().isEmpty())
    assertTrue(DuplicateBypass().all().isEmpty())
  }

  private fun engine(transfers: Transfers = writes()) = DownloadEngine(
    store = store,
    prober = { ProbeResult.Success(SourceKind.PROGRESSIVE, "https://cdn.example/final", "video/mp4", Container.MP4, 1000, true, emptyList(), emptyList(), null) },
    transfers = transfers,
    verification = { _, _ -> VerifyResult.Valid },
    inspector = { MediaMetadata(null, null, null, null, true, false, "video/avc", null, null) },
    library = library,
    paths = paths,
    scope = scope,
    savedVideos = saved,
    duplicateBypass = DuplicateBypass(bypassStorage),
    retryDelay = {},
    idFactory = { "dl-${ids.incrementAndGet()}" },
  )

  private fun request(allowDuplicate: Boolean = false, title: String = "Clip") = EnqueueRequest(
    url = url,
    kind = SourceKind.PROGRESSIVE,
    manifestText = null,
    audioUrl = null,
    variant = null,
    request = RequestContext(null, null, null, emptyMap(), useCookies = false),
    title = title,
    site = SiteId.WEB,
    pageUrl = null,
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = false,
    allowDuplicate = allowDuplicate,
  )

  private fun writes() = FakeTransfers { _, spec, onProgress ->
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(ByteArray(1000))
    onProgress(1000, 1000)
    TransferOutcome.Completed(1000, 1000, "etag", spec.url)
  }

  private fun blocking(release: CompletableDeferred<Unit>) = FakeTransfers { _, spec, onProgress ->
    spec.partFile.parentFile?.mkdirs()
    onProgress(0, 1000)
    release.await()
    spec.partFile.writeBytes(ByteArray(1000))
    onProgress(1000, 1000)
    TransferOutcome.Completed(1000, 1000, "etag", spec.url)
  }
}
