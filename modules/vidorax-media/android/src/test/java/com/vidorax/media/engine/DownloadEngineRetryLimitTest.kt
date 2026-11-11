package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * #332 Retry limit: the number of transient failures in a row a transfer waits out. Automatic (null) is exactly
 * today's [DownloadEngine.MAX_NETWORK_ATTEMPTS]; a set limit is clamped to 1..10 and refills on progress as before.
 */
class DownloadEngineRetryLimitTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)
  private val delays = java.util.Collections.synchronizedList(mutableListOf<Long>())

  @Before fun setUp() {
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
  }

  @After fun tearDown() { dispatcher.close() }

  /** Transfers made before a download that never gets a byte through fails, with [limit] set. */
  private fun attemptsUntilFailure(limit: Int?, failure: () -> Exception = { MediaNetworkException("connection reset") }): Pair<Int, DownloadErrorCode?> =
    runBlocking {
      val calls = AtomicInteger(0)
      val engine = engine(
        transfers = FakeTransfers { _, spec, _ ->
          calls.incrementAndGet()
          spec.partFile.parentFile?.mkdirs()
          throw failure()
        },
        retryLimit = { limit },
      )
      val record = engine.enqueue(request())
      engine.awaitIdle()
      val row = store.current(record.id)!!
      assertEquals(DownloadState.FAILED, row.state)
      calls.get() to row.errorCode
    }

  @Test fun automaticIsTodaysFiveRetries() {
    val (calls, code) = attemptsUntilFailure(null)
    assertEquals("the first try and 5 retries, as before", 1 + DownloadEngine.MAX_NETWORK_ATTEMPTS, calls)
    assertEquals(DownloadErrorCode.NETWORK, code)
    assertEquals(5, RetryLimit.AUTOMATIC)
  }

  @Test fun eachLimitIsTheNumberOfRetries() {
    for (limit in listOf(1, 3, 5, 10)) {
      assertEquals("limit $limit", 1 + limit, attemptsUntilFailure(limit).first)
    }
  }

  @Test fun aLimitOutOfRangeIsClampedToOneToTen() {
    assertEquals(1 + RetryLimit.MIN, attemptsUntilFailure(0).first)
    assertEquals(1 + RetryLimit.MIN, attemptsUntilFailure(-4).first)
    assertEquals(1 + RetryLimit.MAX, attemptsUntilFailure(99).first)
  }

  @Test fun theLimitAlsoCountsTransientServerErrors() {
    val (calls, code) = attemptsUntilFailure(3) { MediaHttpException(503, "https://cdn.example/final") }
    assertEquals(4, calls)
    assertEquals(DownloadErrorCode.HTTP_ERROR, code)
  }

  @Test fun theBudgetStillRefillsWhenBytesAdvance() = runBlocking {
    // Limit 1: every failure that follows progress starts a fresh budget, so a download that keeps moving survives
    // more blips than the limit, exactly like the automatic budget does today.
    val calls = AtomicInteger(0)
    val engine = engine(
      transfers = FakeTransfers { call, spec, onProgress ->
        calls.incrementAndGet()
        spec.partFile.parentFile?.mkdirs()
        if (call < 4) {
          spec.partFile.writeBytes(ByteArray((call + 1) * 100))
          onProgress(((call + 1) * 100).toLong(), 1000)
          throw MediaNetworkException("reset")
        }
        spec.partFile.writeBytes(ByteArray(1000))
        onProgress(1000, 1000)
        TransferOutcome.Completed(1000, 1000, null, spec.url)
      },
      retryLimit = { 1 },
    )
    val record = engine.enqueue(request())
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals(5, calls.get())
  }

  @Test fun theBackoffBetweenAttemptsIsUnchanged() {
    delays.clear()
    attemptsUntilFailure(10)
    assertEquals(
      (1..10).map { minOf(it * DownloadEngine.RETRY_BACKOFF_MS, DownloadEngine.MAX_RETRY_BACKOFF_MS) },
      delays.toList(),
    )
  }

  @Test fun theLimitIsReadAtEachFailureSoAChangeAppliesToARunningDownload() {
    val limit = AtomicReference<Int?>(10)
    val calls = AtomicInteger(0)
    runBlocking {
      val engine = engine(
        transfers = FakeTransfers { _, spec, _ ->
          if (calls.incrementAndGet() == 2) limit.set(1)
          spec.partFile.parentFile?.mkdirs()
          throw MediaNetworkException("reset")
        },
        retryLimit = { limit.get() },
      )
      engine.enqueue(request())
      engine.awaitIdle()
    }
    assertEquals("the second failure already exceeds the new limit of 1", 2, calls.get())
  }

  private fun engine(transfers: Transfers, retryLimit: () -> Int?): DownloadEngine = DownloadEngine(
    store = store,
    prober = Prober {
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
    verification = Verification { _, _ -> VerifyResult.Valid },
    inspector = MediaInspector {
      MediaMetadata(
        durationMs = 1_000,
        width = 640,
        height = 360,
        bitrate = null,
        hasVideo = true,
        hasAudio = true,
        videoCodec = "video/avc",
        audioCodec = "audio/mp4a-latm",
        containerMimeType = "video/mp4",
      )
    },
    library = library,
    paths = paths,
    scope = scope,
    retryDelay = { delays.add(it) },
    retryLimit = retryLimit,
    idFactory = { "dl-${ids.incrementAndGet()}" },
  )

  private fun request() = EnqueueRequest(
    url = "https://cdn.example/clip-${ids.get()}.mp4",
    kind = SourceKind.PROGRESSIVE,
    manifestText = null,
    audioUrl = null,
    variant = null,
    request = RequestContext(null, null, null, emptyMap(), useCookies = false),
    title = "Clip",
    site = SiteId.WEB,
    pageUrl = null,
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = null,
  )
}
