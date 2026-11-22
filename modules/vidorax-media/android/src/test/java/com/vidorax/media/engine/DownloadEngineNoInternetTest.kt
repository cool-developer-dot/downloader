package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * A network Android reports but that has no working internet behind it (a captive portal, a DNS that answers
 * nothing): a network error there waits for the internet instead of spending the retries and failing the download.
 */
class DownloadEngineNoInternetTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val ids = AtomicInteger(0)

  @Before fun setUp() {
    dispatcher = Executors.newFixedThreadPool(4).asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
  }

  @After fun tearDown() { dispatcher.close() }

  /** Connected all along; [working] is whether Android found the internet behind it. */
  private class Network(working: Boolean) : NetworkGate {
    val working = MutableStateFlow(working)

    override fun isUsable(wifiOnly: Boolean): Boolean = true
    override suspend fun awaitUsable(wifiOnly: Boolean) = Unit
    override suspend fun awaitUnusable(wifiOnly: Boolean) = kotlinx.coroutines.awaitCancellation()
    override fun hasWorkingInternet(): Boolean = working.value
    override suspend fun awaitWorkingInternet() {
      working.first { it }
    }
  }

  /** Every transfer fails with a network error until [network] has working internet again. */
  private fun failsWithoutInternet(network: Network, calls: AtomicInteger) = FakeTransfers { _, spec, onProgress ->
    calls.incrementAndGet()
    if (!network.working.value) throw MediaNetworkException("Unable to resolve host")
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(ByteArray(1_000))
    onProgress(1_000, 1_000)
    TransferOutcome.Completed(1_000, 1_000, null, spec.url)
  }

  private fun engine(network: NetworkGate, transfers: Transfers, recheckMs: Long) = DownloadEngine(
    store = store,
    prober = Prober {
      ProbeResult.Success(SourceKind.PROGRESSIVE, it.url, "video/mp4", Container.MP4, 1_000, true, emptyList(), emptyList(), null)
    },
    transfers = transfers,
    verification = Verification { _, _ -> VerifyResult.Valid },
    inspector = MediaInspector {
      MediaMetadata(1_000, 640, 360, null, hasVideo = true, hasAudio = true, "video/avc", "audio/mp4a-latm", "video/mp4")
    },
    library = FakeLibrary(),
    paths = paths,
    scope = scope,
    network = network,
    initialSettings = DownloadSettings.DEFAULT,
    retryDelay = {},
    internetRecheckMs = recheckMs,
    idFactory = { "net-${ids.incrementAndGet()}" },
  )

  private fun request() = EnqueueRequest(
    url = "https://cdn.example/clip.mp4",
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
    saveToGallery = false,
    wifiOnly = null,
  )

  private suspend fun waitFor(predicate: suspend () -> Boolean) {
    withTimeout(15_000) { while (!predicate()) delay(20) }
  }

  @Test fun aNetworkErrorWithoutWorkingInternetWaitsAndContinuesWhenItIsBack() = runBlocking {
    val network = Network(working = false)
    val calls = AtomicInteger(0)
    // A long recheck: the download must still be waiting, not failed, when the internet comes back.
    val engine = engine(network, failsWithoutInternet(network, calls), recheckMs = 60_000)
    val record = engine.enqueue(request())
    waitFor { store.current(record.id)?.state == DownloadState.WAITING_NETWORK }
    delay(200)
    assertEquals(DownloadState.WAITING_NETWORK, store.current(record.id)!!.state)
    assertEquals("one attempt, then it waits", 1, calls.get())

    network.working.value = true
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertTrue(DownloadState.FAILED !in store.stateHistory(record.id))
  }

  @Test fun aNetworkThatNeverGetsInternetStillFailsInTheEnd() = runBlocking {
    val network = Network(working = false)
    val calls = AtomicInteger(0)
    val engine = engine(network, failsWithoutInternet(network, calls), recheckMs = 1)
    val record = engine.enqueue(request())
    engine.awaitIdle()
    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.NETWORK, row.errorCode)
    assertTrue("waited before counting retries", calls.get() > DownloadEngine.MAX_INTERNET_WAITS)
  }

  @Test fun aNetworkErrorWithWorkingInternetIsRetriedAsBefore() = runBlocking {
    val network = Network(working = true)
    val calls = AtomicInteger(0)
    val engine = engine(
      network,
      FakeTransfers { _, _, _ ->
        calls.incrementAndGet()
        throw MediaNetworkException("Connection reset")
      },
      recheckMs = 60_000,
    )
    val record = engine.enqueue(request())
    engine.awaitIdle()
    assertEquals(DownloadState.FAILED, store.current(record.id)!!.state)
    assertTrue(DownloadState.WAITING_NETWORK !in store.stateHistory(record.id))
    assertEquals(DownloadEngine.MAX_NETWORK_ATTEMPTS + 1, calls.get())
  }
}
