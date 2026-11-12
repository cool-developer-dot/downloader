package com.vidorax.media.engine

import com.vidorax.media.InvalidStateException
import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.transfer.StorageWriteException
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.transfer.TransferSpec
import com.vidorax.media.verify.VerifyResult
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
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

class DownloadEngineTest {
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

  // ---------- A: happy path ----------

  @Test fun happyPathMp4CompletesAndCreatesLibraryEntry() = runBlocking {
    val engine = engine(
      prober = probeSuccess(container = Container.MP4, size = 1000),
      transfers = writes(1000),
      verification = { _, _ -> VerifyResult.Valid },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.COMPLETED, row.state)
    assertEquals(1, library.items.size)
    val item = library.items.values.single()
    assertTrue("library file must exist on disk", item.file.exists())
    assertEquals(row.id, item.id)
    assertEquals(item.file.length(), row.bytesDone)
    assertFalse("work dir must be cleaned", paths.workDir(record.id).exists())
  }

  @Test fun aCompletionIsReportedOnceForCountingEvenWithoutAnyListener() = runBlocking {
    val engine = engine(
      prober = probeSuccess(container = Container.MP4, size = 1000),
      transfers = writes(1000),
      verification = { _, _ -> VerifyResult.Valid },
    )
    // Nothing collects stateChanges here — as when the download finishes while no JavaScript runs.
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    val completions = engine.listCompletions()
    assertEquals(listOf(record.id), completions.map { it.downloadId })
    assertEquals(store.current(record.id)!!.updatedAt, completions.single().completedAt)
    assertEquals("listing does not consume", 1, engine.listCompletions().size)

    engine.acknowledgeCompletions(listOf(record.id))
    assertTrue(engine.listCompletions().isEmpty())
  }

  @Test fun aDownloadThatDoesNotCompleteIsNeverReported() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = writes(1000),
      verification = { _, _ -> VerifyResult.Invalid("truncated") },
    )
    engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertTrue(engine.listCompletions().isEmpty())
  }

  // ---------- B: extensionless URL ----------

  @Test fun extensionlessUrlCompletesWhenProbeVerifiesProgressive() = runBlocking {
    val engine = engine(
      prober = probeSuccess(container = Container.MP4, size = 500, finalUrl = "https://cdn.example/o/7f3a9b2c"),
      transfers = writes(500),
      verification = { _, _ -> VerifyResult.Valid },
    )
    val record = engine.enqueue(request("https://cdn.example/o/7f3a9b2c"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals(1, library.items.size)
  }

  // ---------- C: unsupported / DRM probe rejection ----------

  @Test fun unsupportedProbeFailsWithNoTransferAndNoLibrary() = runBlocking {
    val transfers = CountingTransfers(writes(1))
    val engine = engine(
      prober = probeFailure(ProbeFailure.UNSUPPORTED_FORMAT),
      transfers = transfers,
      verification = { _, _ -> VerifyResult.Valid },
    )
    val record = engine.enqueue(request("https://cdn.example/playlist.mpd"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.UNSUPPORTED_FORMAT, row.errorCode)
    assertEquals(0, transfers.transferCount)
    assertTrue(library.items.isEmpty())
  }

  @Test fun drmProbeFailsAsDrmProtected() = runBlocking {
    val engine = engine(prober = probeFailure(ProbeFailure.DRM_PROTECTED), transfers = writes(1))
    val record = engine.enqueue(request("https://cdn.example/enc.mp4"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.DRM_PROTECTED, store.current(record.id)!!.errorCode)
  }

  // ---------- D: network probe failure ----------

  @Test fun networkProbeFailureIsNetworkNotUnsupported() = runBlocking {
    val engine = engine(prober = probeFailure(ProbeFailure.NETWORK), transfers = writes(1))
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.NETWORK, row.errorCode)
  }

  // ---------- E: transfer failures ----------

  @Test fun transferNetworkFailureIsFailedAndKeepsPart() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { _, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        spec.partFile.writeBytes(ByteArray(300))
        onProgress(300, 1000)
        throw MediaNetworkException("connection reset")
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.NETWORK, row.errorCode)
    assertTrue("partial must be kept for resume", File(paths.workDir(record.id), "download.part").exists())
    assertTrue(library.items.isEmpty())
  }

  @Test fun transferHttp403IsSourceExpired() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { _, _, _ -> throw MediaHttpException.of(403, "https://cdn.example/clip.mp4?token=x") },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.SOURCE_EXPIRED, store.current(record.id)!!.errorCode)
  }

  // ---------- F: pause vs. stale completion race ----------

  @Test fun pauseDuringTransferStaysPausedDespiteStaleCompletion() = runBlocking {
    val started = CompletableDeferred<Unit>()
    val gate = CompletableDeferred<Unit>()
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { _, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        spec.partFile.writeBytes(ByteArray(400))
        onProgress(400, 1000)
        started.complete(Unit)
        // Ignore cancellation so we can drive a *stale* completion after the pause.
        withContext(NonCancellable) { gate.await() }
        spec.partFile.writeBytes(ByteArray(1000))
        TransferOutcome.Completed(1000, 1000, "etag", spec.url)
      },
      verification = { _, _ -> VerifyResult.Valid },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    started.await()
    engine.pause(record.id)
    assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
    gate.complete(Unit) // let the superseded worker run to its (now stale) completion
    engine.awaitIdle()

    assertEquals("a stale completion must not overwrite PAUSED", DownloadState.PAUSED, store.current(record.id)!!.state)
    assertTrue(library.items.isEmpty())
  }

  // ---------- G: verifier rejection ----------

  @Test fun verifierRejectionPreventsCompletion() = runBlocking {
    val transfers = FinalizeTrackingTransfers(writes(1000))
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = transfers,
      verification = { _, _ -> VerifyResult.Invalid("truncated") },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.PROCESSING_FAILED, row.errorCode)
    assertFalse("must not finalize an unverified file", transfers.finalized)
    assertTrue(library.items.isEmpty())
  }

  // ---------- H: finalization failure ----------

  @Test fun finalizationFailurePreventsCompletion() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers(
        onTransfer = { _, spec, onProgress ->
          spec.partFile.parentFile?.mkdirs()
          spec.partFile.writeBytes(ByteArray(1000))
          onProgress(1000, 1000)
          TransferOutcome.Completed(1000, 1000, null, spec.url)
        },
        onFinalize = { _, _ -> throw IOException("no space") },
      ),
      verification = { _, _ -> VerifyResult.Valid },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.STORAGE_ERROR, row.errorCode)
    assertTrue(library.items.isEmpty())
  }

  // ---------- H2: library insert failure ----------

  @Test fun libraryInsertFailurePreventsCompletionAndAvoidsOrphan() = runBlocking {
    library.failInsertWith = IllegalStateException("db write failed")
    var dest: File? = null
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers(
        onFinalize = { part, d -> dest = d; defaultMove(part, d) },
        onTransfer = { _, spec, onProgress ->
          spec.partFile.parentFile?.mkdirs(); spec.partFile.writeBytes(ByteArray(1000)); onProgress(1000, 1000)
          TransferOutcome.Completed(1000, 1000, null, spec.url)
        },
      ),
      verification = { _, _ -> VerifyResult.Valid },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.STORAGE_ERROR, row.errorCode)
    assertTrue("library must have no row", library.items.isEmpty())
    assertFalse("the finalized file must not be orphaned", dest!!.exists())
  }

  // ---------- I: exact final path + single entry ----------

  @Test fun completionPersistsExactFinalFileAndOneLibraryEntry() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.WEBM, 2048),
      transfers = writes(2048),
      verification = { _, _ -> VerifyResult.Valid },
      inspector = { file -> metadata(width = 1920, height = 1080, durationMs = 5000, hasAudio = true, mime = "video/webm") },
    )
    val record = engine.enqueue(request("https://cdn.example/v", title = "My Clip", site = SiteId.REDDIT))
    engine.awaitIdle()

    assertEquals(1, library.items.size)
    val item = library.items.values.single()
    assertTrue(item.file.exists())
    assertEquals(2048L, item.file.length())
    assertEquals(2048L, item.sizeBytes)
    assertEquals(Container.WEBM, item.container)
    assertEquals("webm", item.file.extension)
    assertEquals(SiteId.REDDIT, item.site)
    assertEquals(1080, item.height)
    assertTrue(item.hasAudio)
    // The library points at the file that was actually finalized.
    assertEquals(item.file.canonicalPath, paths.fromStoredPath(paths.toStoredPath(item.file)).canonicalPath)
  }

  @Test fun aFinishedFileWithSoundButNoPictureIsNotAVideo() = runBlocking {
    // The probe could not see the track list (a moov at the end); the finished file decodes as audio only.
    val engine = engine(
      prober = probeSuccess(Container.MP4, 2048),
      transfers = writes(2048),
      inspector = { metadata(hasAudio = true, mime = "audio/mp4").copy(hasVideo = false, videoCodec = null) },
    )
    val record = engine.enqueue(request("https://cdn.example/a1/main.mp4"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.UNSUPPORTED_FORMAT, row.errorCode)
    assertTrue("nothing reaches the library", library.items.isEmpty())
    assertFalse("the work dir is cleaned", paths.workDir(record.id).exists())
    assertTrue("an unsupported source is not retried", delays.isEmpty())
  }

  @Test fun aDivx3AviIsKeptAlthoughAndroidReadsOnlyItsSound() = runBlocking {
    // MediaMetadataRetriever (the inspector) sees only the MP3 of a DivX 3 AVI; the AVI header declares the video.
    val bytes = resourceBytes("/media/process/div3-mp3.divx")
    val engine = engine(
      prober = probeSuccess(Container.AVI, bytes.size.toLong()),
      transfers = writesBytes(bytes),
      inspector = { metadata(hasAudio = true, mime = "video/x-msvideo").copy(hasVideo = false, videoCodec = null) },
    )
    val record = engine.enqueue(request("https://cdn.example/movie.divx"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(row.errorMessage, DownloadState.COMPLETED, row.state)
    val item = library.items.values.single()
    assertTrue("named by its container", item.file.name.endsWith(".avi"))
    assertEquals("video/x-msvideo", item.mimeType)
  }

  @Test fun anAviWithNoVideoStreamIsStillNotAVideo() = runBlocking {
    val bytes = resourceBytes("/media/process/div3-mp3.divx")
    val strh = String(bytes, Charsets.ISO_8859_1).indexOf("strh")
    "auds".toByteArray().copyInto(bytes, strh + 8)
    val engine = engine(
      prober = probeSuccess(Container.AVI, bytes.size.toLong()),
      transfers = writesBytes(bytes),
      inspector = { metadata(hasAudio = true, mime = "video/x-msvideo").copy(hasVideo = false, videoCodec = null) },
    )
    val record = engine.enqueue(request("https://cdn.example/sound.avi"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.UNSUPPORTED_FORMAT, row.errorCode)
    assertTrue(library.items.isEmpty())
  }

  // ---------- J: stale-generation completion is idempotent ----------

  @Test fun supersededWorkerCannotCreateDuplicateLibraryEntry() = runBlocking {
    val startedA = CompletableDeferred<Unit>()
    val gateA = CompletableDeferred<Unit>()
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { call, spec, onProgress ->
        if (call == 0) {
          spec.partFile.parentFile?.mkdirs()
          spec.partFile.writeBytes(ByteArray(500))
          onProgress(500, 1000)
          startedA.complete(Unit)
          withContext(NonCancellable) { gateA.await() }
          spec.partFile.writeBytes(ByteArray(1000))
          TransferOutcome.Completed(1000, 1000, "etag", spec.url)
        } else {
          spec.partFile.parentFile?.mkdirs()
          spec.partFile.writeBytes(ByteArray(1000))
          onProgress(1000, 1000)
          TransferOutcome.Completed(1000, 1000, "etag", spec.url)
        }
      },
      verification = { _, _ -> VerifyResult.Valid },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    startedA.await()
    engine.pause(record.id)   // supersede worker A
    engine.resume(record.id)  // worker B runs and completes
    gateA.complete(Unit)      // worker A now finishes, but with a stale generation
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals("exactly one library entry despite the stale completion", 1, library.items.size)
  }

  // ---------- K: progress persisted / emitted ----------

  @Test fun progressIsPersistedAndEmitted() = runBlocking {
    val events = mutableListOf<DownloadProgress>()
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { _, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        spec.partFile.writeBytes(ByteArray(1000))
        onProgress(400, 1000); yield()
        onProgress(1000, 1000); yield()
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
      verification = { _, _ -> VerifyResult.Valid },
    )
    val collector = scope.launch { engine.progress.collect { events.add(it) } }
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()
    collector.cancel()

    assertTrue("progress must be emitted from real bytes", events.any { it.bytesDone > 0 })
    val row = store.current(record.id)!!
    assertEquals(DownloadState.COMPLETED, row.state)
    assertEquals(1000L, row.bytesDone)
    // Persisted byte history is monotonic within the attempt.
    val bytes = store.bytesHistory(record.id)
    assertEquals(bytes.sorted(), bytes)
  }

  // ---------- L: secrets never persisted ----------

  @Test fun secretHeadersAreNeverPersisted() = runBlocking {
    val engine = engine(prober = probeFailure(ProbeFailure.NOT_MEDIA), transfers = writes(1))
    val context = RequestContext(
      userAgent = "UA",
      referer = "https://page",
      origin = "https://page",
      headers = mapOf("Cookie" to "sid=SECRET", "Authorization" to "Bearer TOKEN", "X-Ok" to "1"),
      useCookies = true,
    )
    val record = engine.enqueue(request("https://cdn.example/x", context = context))
    engine.awaitIdle()

    val stored = store.current(record.id)!!.request.headers
    assertNull(stored["Cookie"])
    assertNull(stored["Authorization"])
    assertEquals("1", stored["X-Ok"])
  }

  // ---------- M: restart-from-zero corrects persisted progress ----------

  @Test fun restartFromZeroCorrectsPersistedProgress() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { _, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        onProgress(800, 1000); yield()          // resumed high...
        onProgress(0, 1000); yield()             // server ignored Range: safe restart from zero
        onProgress(1000, 1000); yield()
        spec.partFile.writeBytes(ByteArray(1000))
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
      verification = { _, _ -> VerifyResult.Valid },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    val bytes = store.bytesHistory(record.id)
    assertTrue("the restart must be persisted, not hidden by a monotonic max", bytes.contains(0L))
    assertTrue("a drop from 800 to a lower value must be recorded", bytes.zipWithNext().any { it.first > it.second })
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals(1000L, store.current(record.id)!!.bytesDone)
  }

  // ---------- pause / resume / cancel API ----------

  @Test fun cancelDeletesWorkAndForbidsResume(): Unit = runBlocking {
    val gate = CompletableDeferred<Unit>()
    val started = CompletableDeferred<Unit>()
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { _, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs(); spec.partFile.writeBytes(ByteArray(200)); onProgress(200, 1000)
        started.complete(Unit); gate.await(); TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    started.await()
    engine.cancel(record.id)
    engine.awaitIdle()

    assertEquals(DownloadState.CANCELLED, store.current(record.id)!!.state)
    assertFalse(paths.workDir(record.id).exists())
    assertThrows(InvalidStateException::class.java) { runBlocking { engine.resume(record.id) } }
  }

  // ---------- pause / resume ----------

  /** A small pool of daemon threads: models the app's real concurrency without outliving the test JVM. */

  // ---------- Phase 9A: network, storage and expiring links ----------

  @Test fun aDownloadWaitsForTheNetworkInsteadOfFailing() = runBlocking {
    val gate = TestGate(usable = false)
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = writeAll(1000),
      network = gate,
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    waitFor { store.current(record.id)?.state == DownloadState.WAITING_NETWORK }

    assertEquals(DownloadState.WAITING_NETWORK, store.current(record.id)!!.state)
    gate.open()
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
  }

  @Test fun wifiOnlyHoldsTheDownloadOnAMeteredNetwork() = runBlocking {
    // The gate answers "not usable" exactly as a metered connection does under the Wi-Fi-only setting.
    val gate = TestGate(usable = false)
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = writeAll(1000),
      network = gate,
      settings = com.vidorax.media.model.DownloadSettings.DEFAULT.copy(wifiOnly = true),
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    waitFor { store.current(record.id)?.state == DownloadState.WAITING_NETWORK }

    assertTrue("the engine asked the gate to wait", gate.waits.get() >= 1)
    assertEquals(DownloadState.WAITING_NETWORK, store.current(record.id)!!.state)
    gate.open()
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
  }

  @Test fun aDroppedConnectionIsWaitedOutAndResumedFromThePart() = runBlocking {
    val gate = TestGate()
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { call, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        if (call == 0) {
          spec.partFile.writeBytes(ByteArray(400))
          onProgress(400, 1000)
          gate.close()
          throw MediaNetworkException("connection reset")
        }
        assertEquals("the resume continues from the bytes already on disk", 400L, spec.partFile.length())
        spec.partFile.writeBytes(ByteArray(1000))
        onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
      network = gate,
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    waitFor { store.current(record.id)?.state == DownloadState.WAITING_NETWORK }
    gate.open()
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertNull(store.current(record.id)!!.errorCode)
  }

  @Test fun aNetworkThatNeverComesBackEventuallyFails() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { _, spec, _ ->
        spec.partFile.parentFile?.mkdirs()
        spec.partFile.writeBytes(ByteArray(400))
        throw MediaNetworkException("connection reset")
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadState.FAILED, store.current(record.id)!!.state)
    assertEquals(DownloadErrorCode.NETWORK, store.current(record.id)!!.errorCode)
    assertEquals(
      "the partial file is kept, so Retry resumes instead of restarting",
      400L,
      File(paths.workDir(record.id), "download.part").length(),
    )
  }

  @Test fun aVolumeTooSmallForTheVideoIsRefusedBeforeTheFirstByte() = runBlocking {
    val transferred = AtomicInteger(0)
    val engine = engine(
      prober = probeSuccess(Container.MP4, 500_000_000),
      transfers = FakeTransfers { _, spec, _ ->
        transferred.incrementAndGet()
        TransferOutcome.Completed(0, 0, null, spec.url)
      },
      freeSpace = FreeSpace { 10_000_000 },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadState.FAILED, store.current(record.id)!!.state)
    assertEquals(DownloadErrorCode.NO_SPACE, store.current(record.id)!!.errorCode)
    assertEquals("nothing is downloaded when it cannot possibly fit", 0, transferred.get())
  }

  @Test fun theVolumeRunningOutMidTransferIsReportedAsStorage() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { _, _, _ -> throw IOException("write failed: ENOSPC (No space left on device)") },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadErrorCode.NO_SPACE, store.current(record.id)!!.errorCode)
  }

  // ---------- Phase 13: storage, progress and speed ----------

  @Test fun aFullDiskMidTransferFailsAsNoSpaceAtOnceAndKeepsThePart() = runBlocking {
    val transfers = CountingTransfers(
      FakeTransfers { _, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        spec.partFile.writeBytes(ByteArray(400))
        onProgress(400, 1000)
        // What the real transfer raises when the disk refuses a write (see ProgressiveTransfer/HlsTransfer).
        throw StorageWriteException(IOException("write failed: ENOSPC (No space left on device)"))
      },
    )
    val engine = engine(prober = probeSuccess(Container.MP4, 1000), transfers = transfers)
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.NO_SPACE, row.errorCode)
    assertEquals("a full disk is not waited out like a dropped connection", 1, transfers.transferCount)
    assertTrue("no network backoff for a storage failure", delays.isEmpty())
    assertEquals(
      "the bytes already written stay for a retry once there is room",
      400L,
      File(paths.workDir(record.id), "download.part").length(),
    )
    assertTrue(library.items.isEmpty())
  }

  @Test fun aDiskWriteFailureThatIsNotAFullDiskIsAStorageError() = runBlocking {
    val transfers = CountingTransfers(
      FakeTransfers { _, _, _ -> throw StorageWriteException(IOException("write failed: EIO (I/O error)")) },
    )
    val engine = engine(prober = probeSuccess(Container.MP4, 1000), transfers = transfers)
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadErrorCode.STORAGE_ERROR, store.current(record.id)!!.errorCode)
    assertEquals(1, transfers.transferCount)
  }

  @Test fun progressIsEmittedAtMostFourTimesASecondAndTheFinalNumbersAlways() = runBlocking {
    val clock = java.util.concurrent.atomic.AtomicLong(1_000_000)
    val events = java.util.Collections.synchronizedList(mutableListOf<DownloadProgress>())
    val engine = engine(
      prober = probeSuccess(Container.MP4, 100_000),
      transfers = FakeTransfers { _, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        // 100 chunks over one second: what a fast connection reports.
        for (i in 1..100) {
          clock.addAndGet(10)
          onProgress(i * 1_000L, 100_000)
          yield()
        }
        spec.partFile.writeBytes(ByteArray(100_000))
        TransferOutcome.Completed(100_000, 100_000, null, spec.url)
      },
      now = clock::get,
    )
    val collector = scope.launch { engine.progress.collect { events.add(it) } }
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()
    yield()
    collector.cancel()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertTrue("throttled to about 4 events per second, got ${events.size}", events.size in 2..7)
    assertEquals("the last progress event carries the final bytes", 100_000L, events.last().bytesDone)
  }

  @Test fun speedIsMeasuredOverTheLastSecondsNotTheLastChunk() = runBlocking {
    val clock = java.util.concurrent.atomic.AtomicLong(5_000_000)
    val events = java.util.Collections.synchronizedList(mutableListOf<DownloadProgress>())
    val engine = engine(
      prober = probeSuccess(Container.MP4, 300_000),
      transfers = FakeTransfers { _, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        // 100 kB/s on average, delivered in uneven bursts: 20 kB, then nothing for 200 ms.
        for (i in 1..15) {
          clock.addAndGet(200)
          onProgress(i * 20_000L, 300_000)
          yield()
        }
        spec.partFile.writeBytes(ByteArray(300_000))
        TransferOutcome.Completed(300_000, 300_000, null, spec.url)
      },
      now = clock::get,
    )
    val collector = scope.launch { engine.progress.collect { events.add(it) } }
    engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()
    yield()
    collector.cancel()

    val speed = events.last().speedBps
    assertTrue("speed should be about 100 kB/s, was $speed", speed in 90_000L..110_000L)
  }

  @Test fun anExpiredLinkIsRefreshedOnceAndTheDownloadContinues() = runBlocking {
    val probes = AtomicInteger(0)
    val urls = java.util.Collections.synchronizedList(mutableListOf<String>())
    val engine = engine(
      prober = Prober {
        val n = probes.incrementAndGet()
        ProbeResult.Success(
          kind = SourceKind.PROGRESSIVE,
          finalUrl = "https://cdn.example/final?token=$n",
          contentType = "video/mp4",
          container = Container.MP4,
          sizeBytes = 1000,
          resumable = true,
          variants = emptyList(),
          audioTracks = emptyList(),
          durationMs = null,
        )
      },
      transfers = FakeTransfers { call, spec, onProgress ->
        urls.add(spec.url)
        spec.partFile.parentFile?.mkdirs()
        if (call == 0) {
          spec.partFile.writeBytes(ByteArray(400))
          throw MediaHttpException.of(403, spec.url)
        }
        spec.partFile.writeBytes(ByteArray(1000))
        onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals("the same source is probed again, never a different one", 2, probes.get())
    assertEquals(listOf("https://cdn.example/final?token=1", "https://cdn.example/final?token=2"), urls.toList())
  }

  @Test fun anExpiredLinkThatCannotBeRefreshedTellsTheUserWhatToDo() = runBlocking {
    val probes = AtomicInteger(0)
    val engine = engine(
      prober = Prober {
        if (probes.incrementAndGet() == 1) {
          ProbeResult.Success(
            kind = SourceKind.PROGRESSIVE,
            finalUrl = "https://cdn.example/final?token=1",
            contentType = "video/mp4",
            container = Container.MP4,
            sizeBytes = 1000,
            resumable = true,
            variants = emptyList(),
            audioTracks = emptyList(),
            durationMs = null,
          )
        } else {
          ProbeResult.Failure(ProbeFailure.HTTP_403, 403, "forbidden")
        }
      },
      transfers = FakeTransfers { _, spec, _ -> throw MediaHttpException.of(403, spec.url) },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.SOURCE_EXPIRED, row.errorCode)
    assertEquals(DownloadEngine.EXPIRED_MESSAGE, row.errorMessage)
    assertFalse("the message is safe to show: no URL, no token", row.errorMessage!!.contains("token"))
  }


  @Test fun aFinishedDownloadGetsItsThumbnail() = runBlocking {
    val thumb = tmp.newFile("thumb.webp").apply { writeBytes(ByteArray(16)) }
    val asked = java.util.Collections.synchronizedList(mutableListOf<String>())
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = writeAll(1000),
      thumbnails = ThumbnailMaker { id, file, _ ->
        asked.add(id)
        assertTrue("the thumbnail is taken from the finished file, not the .part", file.name.endsWith(".mp4"))
        thumb
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4", title = "Clip"))
    engine.awaitIdle()

    assertEquals(listOf(record.id), asked.toList())
    assertEquals(thumb, library.items.values.single().thumbnail)
  }

  @Test fun aVideoWithNoDecodableFrameStillCompletes() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = writeAll(1000),
      thumbnails = ThumbnailMaker { _, _, _ -> throw IllegalStateException("no frame") },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertNull(library.items.values.single().thumbnail)
  }


  @Test fun aTransferAlreadyRunningStopsWhenTheNetworkIsNoLongerAllowed() = runBlocking {
    val gate = TestGate()
    val started = CompletableDeferred<Unit>()
    val resumedFrom = java.util.Collections.synchronizedList(mutableListOf<Long>())
    val pool = workerPool()
    try {
      val engine = engine(
        prober = probeSuccess(Container.MP4, 1000),
        transfers = FakeTransfers { call, spec, onProgress ->
          spec.partFile.parentFile?.mkdirs()
          resumedFrom.add(spec.partFile.length())
          if (call == 0) {
            spec.partFile.writeBytes(ByteArray(400))
            onProgress(400, 1000)
            started.complete(Unit)
            // Keeps running until the engine stops it, exactly like a real transfer between reads.
            kotlinx.coroutines.awaitCancellation()
          }
          spec.partFile.writeBytes(ByteArray(1000))
          onProgress(1000, 1000)
          TransferOutcome.Completed(1000, 1000, null, spec.url)
        },
        workerScope = CoroutineScope(pool),
        network = gate,
        settings = com.vidorax.media.model.DownloadSettings.DEFAULT.copy(wifiOnly = true),
      )
      val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
      started.await()

      gate.close() // the phone fell back to mobile data
      waitFor { store.current(record.id)?.state == DownloadState.WAITING_NETWORK }
      assertEquals(
        "the partial file is kept while it waits",
        400L,
        File(paths.workDir(record.id), "download.part").length(),
      )

      gate.open() // back on Wi-Fi
      engine.awaitIdle()
      assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
      assertEquals("it continued from the bytes already on disk", listOf(0L, 400L), resumedFrom.toList())
    } finally {
      pool.close()
    }
  }


  @Test fun onlyAsManyDownloadsRunAtOnceAsTheUserAllows() = runBlocking {
    val active = AtomicInteger(0)
    val maxActive = AtomicInteger(0)
    val release = CompletableDeferred<Unit>()
    val pool = workerPool()
    try {
      val engine = engine(
        prober = probeSuccess(Container.MP4, 1000),
        transfers = FakeTransfers { _, spec, onProgress ->
          val running = active.incrementAndGet()
          maxActive.updateAndGet { maxOf(it, running) }
          try {
            release.await()
            spec.partFile.parentFile?.mkdirs()
            spec.partFile.writeBytes(ByteArray(1000))
            onProgress(1000, 1000)
            TransferOutcome.Completed(1000, 1000, null, spec.url)
          } finally {
            active.decrementAndGet()
          }
        },
        workerScope = CoroutineScope(pool),
        settings = com.vidorax.media.model.DownloadSettings.DEFAULT.copy(maxConcurrent = 1),
      )
      val first = engine.enqueue(request("https://cdn.example/a.mp4"))
      val second = engine.enqueue(request("https://cdn.example/b.mp4"))
      waitFor { active.get() == 1 }
      delay(120) // plenty of time for a second transfer to start if the limit were not honoured

      assertEquals("one at a time is one at a time", 1, maxActive.get())
      assertEquals("the one waiting is queued, not failed", DownloadState.QUEUED, store.current(second.id)!!.state)

      release.complete(Unit)
      engine.awaitIdle()
      assertEquals(DownloadState.COMPLETED, store.current(first.id)!!.state)
      assertEquals(DownloadState.COMPLETED, store.current(second.id)!!.state)
    } finally {
      pool.close()
    }
  }

  @Test fun pausingAQueuedDownloadDoesNotBlockTheNextOne() = runBlocking {
    val active = AtomicInteger(0)
    val started = CompletableDeferred<Unit>()
    val release = CompletableDeferred<Unit>()
    val pool = workerPool()
    try {
      val engine = engine(
        prober = probeSuccess(Container.MP4, 1000),
        transfers = FakeTransfers { _, spec, onProgress ->
          active.incrementAndGet()
          started.complete(Unit)
          try {
            release.await()
            spec.partFile.parentFile?.mkdirs()
            spec.partFile.writeBytes(ByteArray(1000))
            onProgress(1000, 1000)
            TransferOutcome.Completed(1000, 1000, null, spec.url)
          } finally {
            active.decrementAndGet()
          }
        },
        workerScope = CoroutineScope(pool),
        settings = com.vidorax.media.model.DownloadSettings.DEFAULT.copy(maxConcurrent = 1),
      )
      val running = engine.enqueue(request("https://cdn.example/a.mp4"))
      val queued = engine.enqueue(request("https://cdn.example/b.mp4"))
      started.await()

      engine.pause(queued.id)
      assertEquals(DownloadState.PAUSED, store.current(queued.id)!!.state)

      release.complete(Unit)
      waitFor { store.current(running.id)?.state == DownloadState.COMPLETED }
      assertEquals("a queued download that was paused never held the slot", DownloadState.PAUSED, store.current(queued.id)!!.state)
    } finally {
      pool.close()
    }
  }

  /** A transfer that writes the whole file in one go. */
  private fun writeAll(total: Long) = FakeTransfers { _, spec, onProgress ->
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(ByteArray(total.toInt()))
    onProgress(total, total)
    TransferOutcome.Completed(total, total, null, spec.url)
  }

  /** Waits for a state the engine reaches asynchronously, instead of sleeping a guessed amount. */
  private suspend fun waitFor(timeoutMs: Long = 2_000, predicate: suspend () -> Boolean) {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      if (predicate()) return
      delay(10)
    }
    throw AssertionError("condition not reached within ${timeoutMs}ms")
  }

  private fun workerPool(): ExecutorCoroutineDispatcher =
    Executors.newFixedThreadPool(4) { runnable -> Thread(runnable).apply { isDaemon = true } }.asCoroutineDispatcher()

  /** A transfer that keeps writing until it is cancelled, like the real one between reads. */
  private fun endlessWriter(
    total: Long,
    active: AtomicInteger = AtomicInteger(0),
    maxActive: AtomicInteger = AtomicInteger(0),
    resumedFrom: MutableList<Long> = mutableListOf(),
    firstChunk: CompletableDeferred<Unit> = CompletableDeferred(),
    chunkMs: Long = 20,
  ) = FakeTransfers { _, spec, onProgress ->
    val concurrent = active.incrementAndGet()
    maxActive.updateAndGet { maxOf(it, concurrent) }
    try {
      spec.partFile.parentFile?.mkdirs()
      var written = spec.partFile.length()
      resumedFrom.add(written)
      repeat(Int.MAX_VALUE) {
        currentCoroutineContext().ensureActive()
        // One chunk is uninterruptible, like a socket read already in flight: cancelling mid-chunk still
        // writes those bytes, so a pause that does not wait would report PAUSED while the file grows.
        withContext(NonCancellable) {
          delay(chunkMs)
          written += 100
          spec.partFile.writeBytes(ByteArray(written.toInt()))
          onProgress(written, total)
        }
        if (!firstChunk.isCompleted) firstChunk.complete(Unit)
      }
      TransferOutcome.Completed(written, total, null, spec.url)
    } finally {
      active.decrementAndGet()
    }
  }

  @Test fun pauseStopsTheTransferBeforeItReturns() = runBlocking {
    val firstChunk = CompletableDeferred<Unit>()
    val pool = workerPool()
    try {
      val engine = engine(
        prober = probeSuccess(Container.MP4, 10_000),
        transfers = endlessWriter(10_000, firstChunk = firstChunk),
        workerScope = CoroutineScope(pool),
      )
      val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
      firstChunk.await()

      engine.pause(record.id)
      val part = File(paths.workDir(record.id), "download.part")
      val bytesAtPause = part.length()
      delay(200) // many more chunks would land here if the worker were still running

      assertEquals("no bytes may land after pause returns", bytesAtPause, part.length())
      assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
      assertTrue("the partial file is kept for the resume", bytesAtPause > 0)
    } finally {
      pool.close()
    }
  }

  @Test fun resumeAfterPauseNeverRunsTwoWorkers() = runBlocking {
    val active = AtomicInteger(0)
    val maxActive = AtomicInteger(0)
    val firstChunk = CompletableDeferred<Unit>()
    // A thread pool, like the app: without the stop-and-join a resumed worker can write the same .part
    // while the paused one is still finishing its chunk.
    val pool = workerPool()
    try {
      val engine = engine(
        prober = probeSuccess(Container.MP4, 100_000),
        transfers = endlessWriter(100_000, active, maxActive, firstChunk = firstChunk),
        workerScope = CoroutineScope(pool),
      )
      val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
      firstChunk.await()

      repeat(3) {
        engine.pause(record.id)
        engine.resume(record.id)
        delay(20)
      }
      engine.pause(record.id)

      assertEquals("one download is one worker, whatever the user taps", 1, maxActive.get())
      assertEquals("no transfer is left running once pause returns", 0, active.get())
      assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
    } finally {
      pool.close()
    }
  }

  @Test fun resumeContinuesFromThePhysicalPartLength() = runBlocking {
    val resumedFrom = mutableListOf<Long>()
    val firstChunk = CompletableDeferred<Unit>()
    val engine = engine(
      prober = probeSuccess(Container.MP4, 100_000),
      transfers = endlessWriter(100_000, resumedFrom = resumedFrom, firstChunk = firstChunk),
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    firstChunk.await()
    engine.pause(record.id)
    val part = File(paths.workDir(record.id), "download.part")
    val bytesOnDisk = part.length()

    engine.resume(record.id)
    delay(60)
    engine.pause(record.id)

    assertEquals("the resumed transfer starts at the .part length, not at a stale counter", bytesOnDisk, resumedFrom.last())
    assertTrue(part.length() >= bytesOnDisk)
  }

  @Test fun repeatedPauseAndResumeTapsAreNotErrors() = runBlocking {
    val firstChunk = CompletableDeferred<Unit>()
    val transfers = CountingTransfers(endlessWriter(100_000, firstChunk = firstChunk))
    val engine = engine(prober = probeSuccess(Container.MP4, 100_000), transfers = transfers)
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    firstChunk.await()

    engine.pause(record.id)
    engine.pause(record.id) // a second tap on an already paused row
    assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)

    val transfersBefore = transfers.transferCount
    engine.resume(record.id)
    engine.resume(record.id) // a second tap while it is already running again
    delay(40)

    assertEquals("a repeated resume must not start a second transfer", transfersBefore + 1, transfers.transferCount)
    engine.pause(record.id)
    assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
  }

  @Test fun pauseWhileProbingIsHonouredBeforeAnyTransferStarts() = runBlocking {
    val probing = CompletableDeferred<Unit>()
    val release = CompletableDeferred<Unit>()
    val transfers = CountingTransfers(writes(1000))
    val engine = engine(
      prober = Prober {
        probing.complete(Unit)
        release.await()
        ProbeResult.Success(
          kind = SourceKind.PROGRESSIVE,
          finalUrl = "https://cdn.example/final",
          contentType = "video/mp4",
          container = Container.MP4,
          sizeBytes = 1000,
          resumable = true,
          variants = emptyList(),
          audioTracks = emptyList(),
          durationMs = null,
        )
      },
      transfers = transfers,
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    probing.await()

    engine.pause(record.id)
    release.complete(Unit)
    engine.awaitIdle()

    assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
    assertEquals("a paused probe never starts a transfer", 0, transfers.transferCount)
  }

  @Test fun pauseDuringProcessingIsRefusedWithoutCrashing(): Unit = runBlocking {
    val processing = CompletableDeferred<Unit>()
    val release = CompletableDeferred<Unit>()
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = writes(1000),
      verification = Verification { _, _ ->
        processing.complete(Unit)
        runBlocking { release.await() }
        VerifyResult.Valid
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    processing.await()

    assertEquals(DownloadState.PROCESSING, store.current(record.id)!!.state)
    assertThrows(InvalidStateException::class.java) { runBlocking { engine.pause(record.id) } }
    release.complete(Unit)
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
  }

  @Test fun pauseIsStillRefusedOnTerminalStates(): Unit = runBlocking {
    val engine = engine(prober = probeSuccess(Container.MP4, 1000), transfers = writes(1000))
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertThrows(InvalidStateException::class.java) { runBlocking { engine.pause(record.id) } }
  }

  // ---------- Phase 12A: transient vs permanent ----------

  @Test fun aTransientProbeFailureIsWaitedOutBeforeAnythingIsCalledFailed() = runBlocking {
    val probes = AtomicInteger(0)
    val success = probeSuccess(Container.MP4, 1000)
    val engine = engine(
      prober = Prober { request ->
        if (probes.incrementAndGet() == 1) ProbeResult.Failure(ProbeFailure.NETWORK, null, "offline") else success.probe(request)
      },
      transfers = writes(1000),
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertTrue(DownloadState.WAITING_RETRY in store.stateHistory(record.id))
    assertEquals(listOf(DownloadEngine.CLASSIFY_RETRY_DELAYS_MS.first()), delays.toList())
  }

  @Test fun aProbe5xxThatNeverRecoversEndsAsARetryableServerError() = runBlocking {
    val probes = AtomicInteger(0)
    val engine = engine(
      prober = Prober { probes.incrementAndGet(); ProbeResult.Failure(ProbeFailure.HTTP_ERROR, 503, "busy") },
      transfers = writes(1),
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadErrorCode.HTTP_ERROR, store.current(record.id)!!.errorCode)
    assertEquals(1 + DownloadEngine.CLASSIFY_RETRY_DELAYS_MS.size, probes.get())
  }

  @Test fun aForbiddenProbeGetsOneTryWithTheSessionThenIsReportedAsItIs() = runBlocking {
    val seen = java.util.Collections.synchronizedList(mutableListOf<Boolean>())
    val engine = engine(
      prober = Prober { seen.add(it.request.useCookies); ProbeResult.Failure(ProbeFailure.HTTP_403, 403, "denied") },
      transfers = writes(1),
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.HTTP_403, store.current(record.id)!!.errorCode)
    assertEquals("once without the session, once with it — never a loop", listOf(false, true), seen.toList())
    assertFalse("a session that did not help is not adopted", store.current(record.id)!!.request.useCookies)
  }

  @Test fun aSourceThatNeedsTheBrowsingSessionIsDownloadedWithIt() = runBlocking {
    val transferContexts = java.util.Collections.synchronizedList(mutableListOf<Boolean>())
    val success = probeSuccess(Container.MP4, 1000)
    val engine = engine(
      prober = Prober { request ->
        if (request.request.useCookies) success.probe(request) else ProbeResult.Failure(ProbeFailure.HTTP_403, 403, "no session")
      },
      transfers = FakeTransfers { _, spec, onProgress ->
        transferContexts.add(spec.context.useCookies)
        spec.partFile.parentFile?.mkdirs()
        spec.partFile.writeBytes(ByteArray(1000))
        onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals(listOf(true), transferContexts.toList())
    assertTrue("the need for the session is remembered for resume and retry", store.current(record.id)!!.request.useCookies)
  }

  @Test fun aTransferRefusedWithoutTheSessionAdoptsItAndContinuesFromThePart() = runBlocking {
    val contexts = java.util.Collections.synchronizedList(mutableListOf<Boolean>())
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { call, spec, onProgress ->
        contexts.add(spec.context.useCookies)
        spec.partFile.parentFile?.mkdirs()
        if (!spec.context.useCookies) {
          spec.partFile.writeBytes(ByteArray(300))
          throw MediaHttpException.of(403, spec.url)
        }
        assertEquals(300L, spec.partFile.length())
        spec.partFile.writeBytes(ByteArray(1000))
        onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals(listOf(false, true), contexts.toList())
  }

  @Test fun aServerErrorMidTransferIsRetriedFromThePart() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { call, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        if (call == 0) {
          spec.partFile.writeBytes(ByteArray(400))
          throw MediaHttpException.of(503, spec.url)
        }
        assertEquals("resumes from the bytes on disk", 400L, spec.partFile.length())
        spec.partFile.writeBytes(ByteArray(1000))
        onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
  }

  @Test fun theRetryBudgetRefillsWheneverBytesAdvance() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { call, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        // Ten drops, each after another 90 bytes: twice the fixed budget, survived because it keeps moving.
        if (call < 10) {
          spec.partFile.writeBytes(ByteArray((call + 1) * 90))
          throw MediaNetworkException("reset")
        }
        spec.partFile.writeBytes(ByteArray(1000))
        onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
  }

  @Test fun aRefusalDuringTransferFailsAtOnceWithItsOwnCode() = runBlocking {
    val calls = AtomicInteger(0)
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = FakeTransfers { _, _, _ ->
        calls.incrementAndGet()
        throw com.vidorax.media.net.MediaRefusedException(ProbeFailure.POLICY_BLOCKED, "redirected into the LAN")
      },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.UNSUPPORTED_FORMAT, store.current(record.id)!!.errorCode)
    assertEquals("never retried", 1, calls.get())
  }

  @Test fun aFileThatVerifiesAsEncryptedFailsAsProtectedNotCorrupt() = runBlocking {
    val engine = engine(
      prober = probeSuccess(Container.MP4, 1000),
      transfers = writes(1000),
      verification = { _, _ -> VerifyResult.Invalid("encv in moov", ProbeFailure.DRM_PROTECTED) },
    )
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.DRM_PROTECTED, store.current(record.id)!!.errorCode)
    assertTrue(library.items.isEmpty())
  }

  @Test fun aDownloadWaitingForTheNetworkCanBePaused() = runBlocking {
    val gate = TestGate(usable = false)
    val engine = engine(prober = probeSuccess(Container.MP4, 1000), transfers = writes(1000), network = gate)
    val record = engine.enqueue(request("https://cdn.example/clip.mp4"))
    waitFor { store.current(record.id)?.state == DownloadState.WAITING_NETWORK }

    engine.pause(record.id)
    assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
    gate.open()
    engine.awaitIdle()
    assertEquals("the network coming back does not un-pause it", DownloadState.PAUSED, store.current(record.id)!!.state)
  }

  @Test fun anHlsRequestRemembersItsVariantChoiceWithoutTheSignedQuery() = runBlocking {
    val engine = engine(prober = probeSuccess(Container.MP4, 1000), transfers = writes(1000))
    val hls = request("https://cdn.example/master.m3u8").copy(
      kind = SourceKind.HLS,
      variant = com.vidorax.media.model.VariantChoice("https://cdn.example/v/720.m3u8?sig=SECRET", null, 720),
    )
    val record = engine.enqueue(hls)
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(720, row.variant!!.maxHeight)
    val stored = VariantChoiceJson.encode(row.variant!!)
    assertFalse(stored.contains("SECRET"))
    assertEquals("https://cdn.example/v/720.m3u8", VariantChoiceJson.decode(stored)!!.videoId)
    assertEquals("no HLS support in this host: refused, never half-downloaded", DownloadErrorCode.UNSUPPORTED_FORMAT, row.errorCode)
  }

  // ---------- helpers ----------

  private fun engine(
    prober: Prober,
    transfers: Transfers,
    verification: Verification = Verification { _, _ -> VerifyResult.Valid },
    inspector: MediaInspector = MediaInspector { metadata() },
    thumbnails: ThumbnailMaker = ThumbnailMaker { _, _, _ -> null },
    workerScope: CoroutineScope = scope,
    network: NetworkGate = NetworkGate.ALWAYS_USABLE,
    freeSpace: FreeSpace = FreeSpace { Long.MAX_VALUE },
    settings: com.vidorax.media.model.DownloadSettings = com.vidorax.media.model.DownloadSettings.DEFAULT,
    hls: HlsDownloads = HlsDownloads.UNSUPPORTED,
    now: () -> Long = System::currentTimeMillis,
  ): DownloadEngine = DownloadEngine(
    store = store,
    prober = prober,
    transfers = transfers,
    verification = verification,
    inspector = inspector,
    thumbnails = thumbnails,
    library = library,
    paths = paths,
    scope = workerScope,
    network = network,
    freeSpace = freeSpace,
    initialSettings = settings,
    hls = hls,
    // Backoff is policy, not timing: the tests assert what happens after it, without sleeping through it.
    retryDelay = { delays.add(it) },
    now = now,
    idFactory = { "dl-${ids.incrementAndGet()}" },
  )

  /** Every backoff the engine asked for, in order. */
  private val delays = java.util.Collections.synchronizedList(mutableListOf<Long>())

  /** A gate the test opens by hand, so "waiting for the network" is observable instead of timing-dependent. */
  private class TestGate(usable: Boolean = true) : NetworkGate {
    private val state = kotlinx.coroutines.flow.MutableStateFlow(usable)
    val waits = AtomicInteger(0)

    override fun isUsable(wifiOnly: Boolean): Boolean = state.value

    override suspend fun awaitUsable(wifiOnly: Boolean) {
      waits.incrementAndGet()
      state.first { it }
    }

    override suspend fun awaitUnusable(wifiOnly: Boolean) {
      state.first { !it }
    }

    fun open() {
      state.value = true
    }

    fun close() {
      state.value = false
    }
  }

  private fun request(
    url: String,
    title: String = "Clip",
    site: SiteId = SiteId.WEB,
    context: RequestContext = RequestContext(null, null, null, emptyMap(), useCookies = false),
  ) = EnqueueRequest(
    url = url,
    kind = SourceKind.PROGRESSIVE,
    manifestText = null,
    audioUrl = null,
    variant = null,
    request = context,
    title = title,
    site = site,
    pageUrl = null,
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = null,
  )

  private fun probeSuccess(container: Container, size: Long, finalUrl: String = "https://cdn.example/final") = Prober {
    ProbeResult.Success(
      kind = SourceKind.PROGRESSIVE,
      finalUrl = finalUrl,
      contentType = "video/${container.wire}",
      container = container,
      sizeBytes = size,
      resumable = true,
      variants = emptyList(),
      audioTracks = emptyList(),
      durationMs = null,
    )
  }

  private fun probeFailure(reason: ProbeFailure) = Prober {
    ProbeResult.Failure(reason = reason, httpStatus = null, message = "nope")
  }

  private fun resourceBytes(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing test fixture $path" }.use { it.readBytes() }

  private fun writesBytes(bytes: ByteArray) = FakeTransfers { _, spec, onProgress ->
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(bytes)
    onProgress(bytes.size.toLong(), bytes.size.toLong())
    TransferOutcome.Completed(bytes.size.toLong(), bytes.size.toLong(), "etag", spec.url)
  }

  private fun writes(bytes: Int) = FakeTransfers { _, spec, onProgress ->
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(ByteArray(bytes))
    onProgress(bytes.toLong(), bytes.toLong())
    TransferOutcome.Completed(bytes.toLong(), bytes.toLong(), "etag", spec.url)
  }

  private fun metadata(
    width: Int? = null,
    height: Int? = null,
    durationMs: Long? = null,
    hasAudio: Boolean = false,
    mime: String? = null,
  ) = MediaMetadata(
    durationMs = durationMs,
    width = width,
    height = height,
    bitrate = null,
    hasVideo = true,
    hasAudio = hasAudio,
    videoCodec = "video/avc",
    audioCodec = if (hasAudio) "audio/mp4a-latm" else null,
    containerMimeType = mime,
  )
}

// ---- fakes ----

internal class RecordingStore : DownloadStore {
  private val rows = ConcurrentHashMap<String, DownloadRow>()
  val completions = ConcurrentHashMap<String, CompletionRecord>()
  private val history = java.util.Collections.synchronizedList(mutableListOf<DownloadRow>())

  override suspend fun create(row: DownloadRow) { rows[row.id] = row; history.add(row) }
  override suspend fun find(id: String): DownloadRow? = rows[id]
  override suspend fun save(row: DownloadRow) { rows[row.id] = row; history.add(row) }
  override suspend fun saveCompleted(row: DownloadRow) {
    save(row)
    completions.putIfAbsent(row.id, CompletionRecord(row.id, row.updatedAt))
  }
  override suspend fun listCompletions(): List<CompletionRecord> = completions.values.sortedBy { it.completedAt }
  override suspend fun acknowledgeCompletions(ids: List<String>) { ids.forEach { completions.remove(it) } }
  override suspend fun list(now: Long): List<DownloadRow> =
    rows.values.filter { !it.state.isTerminal || it.updatedAt >= now - 86_400_000 }.sortedByDescending { it.createdAt }
  override suspend fun delete(id: String) { rows.remove(id) }

  fun current(id: String): DownloadRow? = rows[id]
  fun bytesHistory(id: String): List<Long> = history.filter { it.id == id }.map { it.bytesDone }
  fun stateHistory(id: String): List<DownloadState> = history.filter { it.id == id }.map { it.state }
}

internal class FakeLibrary : LibraryWriter {
  val items = ConcurrentHashMap<String, LibraryItem>()
  val insertCalls = AtomicInteger(0)

  @Volatile var failInsertWith: Exception? = null

  override suspend fun insertCompleted(item: LibraryItem): Boolean {
    insertCalls.incrementAndGet()
    failInsertWith?.let { throw it }
    return items.putIfAbsent(item.id, item) == null
  }
}

internal open class FakeTransfers(
  private val onFinalize: (File, File) -> Unit = ::defaultMove,
  private val onTransfer: suspend (call: Int, spec: TransferSpec, onProgress: (Long, Long?) -> Unit) -> TransferOutcome.Completed,
) : Transfers {
  private val calls = AtomicInteger(0)

  override suspend fun transfer(
    spec: TransferSpec,
    onProgress: (Long, Long?) -> Unit,
  ): TransferOutcome.Completed = onTransfer(calls.getAndIncrement(), spec, onProgress)

  override fun finalizeToFile(partFile: File, destFile: File) = onFinalize(partFile, destFile)
}

internal class CountingTransfers(private val delegate: FakeTransfers) : Transfers {
  val transferCount get() = count.get()
  private val count = AtomicInteger(0)

  override suspend fun transfer(spec: TransferSpec, onProgress: (Long, Long?) -> Unit): TransferOutcome.Completed {
    count.incrementAndGet()
    return delegate.transfer(spec, onProgress)
  }

  override fun finalizeToFile(partFile: File, destFile: File) = delegate.finalizeToFile(partFile, destFile)
}

private class FinalizeTrackingTransfers(private val delegate: FakeTransfers) : Transfers {
  @Volatile var finalized = false

  override suspend fun transfer(spec: TransferSpec, onProgress: (Long, Long?) -> Unit): TransferOutcome.Completed =
    delegate.transfer(spec, onProgress)

  override fun finalizeToFile(partFile: File, destFile: File) {
    finalized = true
    delegate.finalizeToFile(partFile, destFile)
  }
}

private fun defaultMove(part: File, dest: File) {
  dest.parentFile?.mkdirs()
  Files.move(part.toPath(), dest.toPath(), StandardCopyOption.REPLACE_EXISTING)
}
