package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Startup reconciliation after a simulated process death: the store survives (seeded directly), but the fresh
 * engine has empty in-memory worker/generation state. Physical `.part`/final files are the source of truth.
 */
class DownloadEngineRestartTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)

  @Before fun setUp() {
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
  }

  @After fun tearDown() { dispatcher.close() }

  // ---------- 1. PAUSED stays paused, bytes reconciled ----------

  @Test fun pausedStaysPausedAndReconcilesBytesToPart() = runBlocking {
    seed(row("p", DownloadState.PAUSED, bytesDone = 999))
    writePart("p", 300)
    val transfers = CountingTransfers(writes(1))
    engine(prober = probeSuccess(), transfers = transfers).restore()

    val row = store.current("p")!!
    assertEquals(DownloadState.PAUSED, row.state)
    assertEquals("bytes reconciled to physical .part", 300L, row.bytesDone)
    assertEquals("paused work is never auto-resumed", 0, transfers.transferCount)
  }

  // ---------- 2. QUEUED re-runs once ----------

  @Test fun queuedRequeuesAndCompletes() = runBlocking {
    seed(row("q", DownloadState.QUEUED))
    val engine = engine(prober = probeSuccess(size = 500), transfers = writes(500))
    engine.restore()
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current("q")!!.state)
    assertEquals(1, library.items.size)
  }

  // ---------- 3. DOWNLOADING resumes from physical .part ----------

  @Test fun downloadingResumesFromPhysicalPartLength() = runBlocking {
    seed(row("d", DownloadState.DOWNLOADING, bytesDone = 0))
    writePart("d", 500)
    var resumedFrom = -1L
    val engine = engine(
      prober = probeSuccess(size = 1000),
      transfers = FakeTransfers { _, spec, onProgress ->
        resumedFrom = spec.partFile.length()
        spec.partFile.writeBytes(ByteArray(1000))
        onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
    )
    engine.restore(); engine.awaitIdle()

    assertEquals("transfer must resume from the physical .part, not a DB counter", 500L, resumedFrom)
    assertEquals(DownloadState.COMPLETED, store.current("d")!!.state)
  }

  // ---------- 4. DOWNLOADING with missing .part starts from zero ----------

  @Test fun downloadingWithMissingPartStartsFromZero() = runBlocking {
    seed(row("m", DownloadState.DOWNLOADING, bytesDone = 700)) // stale DB counter, no file
    var resumedFrom = -1L
    val engine = engine(
      prober = probeSuccess(size = 1000),
      transfers = FakeTransfers { _, spec, onProgress ->
        resumedFrom = spec.partFile.length()
        spec.partFile.parentFile?.mkdirs(); spec.partFile.writeBytes(ByteArray(1000))
        onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
    )
    engine.restore(); engine.awaitIdle()

    assertEquals("missing .part means restart from zero", 0L, resumedFrom)
    assertEquals(DownloadState.COMPLETED, store.current("m")!!.state)
  }

  // ---------- 5. stale DB bytes corrected to physical size ----------

  @Test fun staleDbBytesAreCorrectedToPhysicalSize() = runBlocking {
    seed(row("s", DownloadState.DOWNLOADING, bytesDone = 999))
    writePart("s", 400)
    val engine = engine(prober = probeSuccess(size = 1000), transfers = writes(1000))
    engine.restore(); engine.awaitIdle()

    assertTrue("physical 400 must be persisted over the stale 999", store.bytesHistory("s").contains(400L))
    assertEquals(DownloadState.COMPLETED, store.current("s")!!.state)
  }

  // ---------- 6. PROCESSING + valid .part recovers via verify/finalize ----------

  @Test fun processingWithValidPartRecoversToCompleted() = runBlocking {
    seed(row("pp", DownloadState.PROCESSING, bytesDone = 1000, totalBytes = 1000))
    writePart("pp", 1000)
    val engine = engine(
      prober = probeSuccess(size = 1000),
      transfers = FakeTransfers { _, spec, onProgress ->
        if (spec.partFile.length() < 1000) spec.partFile.writeBytes(ByteArray(1000))
        onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
      verification = { _, _ -> VerifyResult.Valid },
    )
    engine.restore(); engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current("pp")!!.state)
    assertEquals(1, library.items.size)
    assertTrue(library.items.values.single().file.exists())
  }

  // ---------- 7. PROCESSING + already-final file repairs idempotently, no redownload ----------

  @Test fun processingWithFinalFileRepairsWithoutRedownload() = runBlocking {
    val dest = File(paths.libraryDir, "web/clip_final.mp4").apply { parentFile?.mkdirs(); writeBytes(ByteArray(1000)) }
    seed(row("f", DownloadState.PROCESSING, bytesDone = 1000, totalBytes = 1000, filePath = paths.toStoredPath(dest)))
    val transfers = CountingTransfers(writes(1))
    val engine = engine(prober = probeSuccess(size = 1000), transfers = transfers, verification = { _, _ -> VerifyResult.Valid })
    engine.restore(); engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current("f")!!.state)
    assertEquals("must not redownload an already-finalized file", 0, transfers.transferCount)
    assertEquals(1, library.items.size)
    assertEquals(dest.canonicalPath, library.items.values.single().file.canonicalPath)
  }

  // ---------- 7b. restart with library row already present is idempotent ----------

  @Test fun processingWithFinalFileAndExistingLibraryRowIsIdempotent() = runBlocking {
    val dest = File(paths.libraryDir, "web/dup.mp4").apply { parentFile?.mkdirs(); writeBytes(ByteArray(1000)) }
    seed(row("dup", DownloadState.PROCESSING, totalBytes = 1000, filePath = paths.toStoredPath(dest)))
    library.items["dup"] = existingLibraryItem("dup", dest) // library insert already happened before the crash
    val engine = engine(prober = probeSuccess(size = 1000), transfers = writes(1), verification = { _, _ -> VerifyResult.Valid })
    engine.restore(); engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current("dup")!!.state)
    assertEquals("no duplicate library entry", 1, library.items.size)
  }

  // ---------- 8. PROCESSING + missing final file never falsely completes ----------

  @Test fun processingWithMissingFinalFileNeverFalselyCompletes() = runBlocking {
    val missing = File(paths.libraryDir, "web/gone.mp4")
    seed(row("g", DownloadState.PROCESSING, totalBytes = 1000, filePath = paths.toStoredPath(missing)))
    // No .part and no final file: re-run, and here the re-download fails — so it must not become COMPLETED.
    val engine = engine(
      prober = probeSuccess(size = 1000),
      transfers = FakeTransfers { _, _, _ -> throw MediaNetworkException("still offline") },
    )
    engine.restore(); engine.awaitIdle()

    val row = store.current("g")!!
    assertFalse("a missing final file must never be reported COMPLETED", row.state == DownloadState.COMPLETED)
    assertEquals(DownloadState.FAILED, row.state)
    assertTrue(library.items.isEmpty())
  }

  // ---------- 9/10/11. terminal states are untouched ----------

  @Test fun completedIsNeverRedownloaded() = runBlocking {
    seed(row("c", DownloadState.COMPLETED, bytesDone = 1000))
    val transfers = CountingTransfers(writes(1))
    engine(prober = probeSuccess(), transfers = transfers).restore()
    assertEquals(DownloadState.COMPLETED, store.current("c")!!.state)
    assertEquals(0, transfers.transferCount)
  }

  @Test fun failedIsNotAutoRetried() = runBlocking {
    seed(row("x", DownloadState.FAILED))
    val transfers = CountingTransfers(writes(1))
    engine(prober = probeSuccess(), transfers = transfers).restore()
    assertEquals(DownloadState.FAILED, store.current("x")!!.state)
    assertEquals(0, transfers.transferCount)
  }

  @Test fun cancelledIsNotResurrected() = runBlocking {
    seed(row("z", DownloadState.CANCELLED))
    val transfers = CountingTransfers(writes(1))
    engine(prober = probeSuccess(), transfers = transfers).restore()
    assertEquals(DownloadState.CANCELLED, store.current("z")!!.state)
    assertEquals(0, transfers.transferCount)
  }

  // ---------- 11. restore is idempotent across duplicate calls ----------

  @Test fun restoreCalledTwiceDoesNotDuplicateWorker() = runBlocking {
    seed(row("once", DownloadState.QUEUED))
    val transfers = CountingTransfers(writes(500))
    val engine = engine(prober = probeSuccess(size = 500), transfers = transfers)
    engine.restore()
    engine.restore() // second call must be a no-op
    engine.awaitIdle()

    assertEquals("exactly one worker/transfer despite two restore calls", 1, transfers.transferCount)
    assertEquals(DownloadState.COMPLETED, store.current("once")!!.state)
    assertEquals(1, library.items.size)
  }

  // ---------- 12. no secrets are required to reconstruct ----------

  @Test fun reconstructionNeedsNoSecrets() = runBlocking {
    seed(row("ns", DownloadState.DOWNLOADING, request = RequestContext("UA", null, null, mapOf("X-Ok" to "1"), useCookies = false)))
    writePart("ns", 100)
    var seenHeaders: Map<String, String>? = null
    val engine = engine(
      prober = probeSuccess(size = 1000),
      transfers = FakeTransfers { _, spec, onProgress ->
        seenHeaders = spec.context.headers
        spec.partFile.writeBytes(ByteArray(1000)); onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
    )
    engine.restore(); engine.awaitIdle()

    assertNull(seenHeaders!!["Cookie"])
    assertNull(seenHeaders!!["Authorization"])
    assertEquals("1", seenHeaders!!["X-Ok"])
    assertEquals(DownloadState.COMPLETED, store.current("ns")!!.state)
  }

  // ---------- helpers ----------

  private fun engine(
    prober: Prober,
    transfers: Transfers,
    verification: Verification = Verification { _, _ -> VerifyResult.Valid },
    inspector: MediaInspector = MediaInspector { metadata() },
  ) = DownloadEngine(
    store = store,
    prober = prober,
    transfers = transfers,
    verification = verification,
    inspector = inspector,
    library = library,
    paths = paths,
    scope = scope,
    retryDelay = {},
    idFactory = { "dl-${ids.incrementAndGet()}" },
  )

  private suspend fun seed(row: DownloadRow) = store.create(row)

  private fun writePart(id: String, size: Int) {
    val part = File(paths.workDir(id), "download.part")
    part.parentFile?.mkdirs()
    part.writeBytes(ByteArray(size))
  }

  private fun row(
    id: String,
    state: DownloadState,
    bytesDone: Long = 0,
    totalBytes: Long? = 1000,
    filePath: String? = null,
    request: RequestContext = RequestContext(null, null, null, emptyMap(), useCookies = false),
  ) = DownloadRow(
    id = id,
    state = state,
    kind = SourceKind.PROGRESSIVE,
    url = "https://cdn.example/$id.mp4",
    request = request,
    title = "Clip $id",
    site = SiteId.WEB,
    pageUrl = null,
    thumbnailUrl = null,
    qualityLabel = null,
    bytesDone = bytesDone,
    totalBytes = totalBytes,
    errorCode = null,
    errorMessage = null,
    attempts = 0,
    saveToGallery = null,
    createdAt = 1,
    updatedAt = 1,
    filePath = filePath,
  )

  private fun probeSuccess(container: Container = Container.MP4, size: Long = 1000) = Prober {
    ProbeResult.Success(
      kind = SourceKind.PROGRESSIVE,
      finalUrl = "https://cdn.example/final",
      contentType = "video/mp4",
      container = container,
      sizeBytes = size,
      resumable = true,
      variants = emptyList(),
      audioTracks = emptyList(),
      durationMs = null,
    )
  }

  private fun writes(bytes: Int) = FakeTransfers { _, spec, onProgress ->
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(ByteArray(bytes))
    onProgress(bytes.toLong(), bytes.toLong())
    TransferOutcome.Completed(bytes.toLong(), bytes.toLong(), null, spec.url)
  }

  private fun metadata() = MediaMetadata(null, null, null, null, hasVideo = true, hasAudio = false, videoCodec = "video/avc", audioCodec = null, containerMimeType = "video/mp4")

  private fun existingLibraryItem(id: String, dest: File) = com.vidorax.media.model.LibraryItem(
    id = id, title = "Clip", site = SiteId.WEB, pageUrl = null, sourceUrl = null, file = dest,
    mimeType = "video/mp4", container = Container.MP4, videoCodec = null, audioCodec = null, hasAudio = false,
    width = null, height = null, durationMs = null, sizeBytes = dest.length(), thumbnail = null, favorite = false,
    galleryUri = null, createdAt = 1, completedAt = 2,
  )
}
