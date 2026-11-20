package com.vidorax.media.engine

import com.vidorax.media.InvalidRequestException
import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.BasicCredentials
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.DownloadCredentials
import com.vidorax.media.net.FtpUrl
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.transfer.TransferSpec
import com.vidorax.media.verify.VerifyResult
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * P2 Sources in the engine: an FTP link runs as one file whose sign-in is never stored (#304); a download's mirrors are
 * persisted and handed to its transfer, and a running one restarts to use new ones (#347); the mobile-data lease is
 * taken only when the setting and the download's rules allow it, and always given back (#446).
 */
class DownloadEngineSourcesTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)
  private val specs = CopyOnWriteArrayList<TransferSpec>()
  private val probes = CopyOnWriteArrayList<ProbeRequest>()

  @Before fun setUp() {
    dispatcher = Executors.newFixedThreadPool(4).asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
    DownloadCredentials.resetForTests()
  }

  @After fun tearDown() {
    dispatcher.close()
    DownloadCredentials.resetForTests()
  }

  /** On Wi-Fi (unmetered) or on mobile data only. */
  private class Network(private val onWifi: Boolean) : NetworkGate {
    override fun isUsable(wifiOnly: Boolean): Boolean = !wifiOnly || onWifi
    override suspend fun awaitUsable(wifiOnly: Boolean) = Unit
    override suspend fun awaitUnusable(wifiOnly: Boolean) = kotlinx.coroutines.awaitCancellation()
  }

  private class CountingSecondNetwork : SecondNetwork {
    val acquired = AtomicInteger()
    val released = AtomicInteger()
    val client = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)

    override suspend fun acquire(): SecondNetworkLease {
      acquired.incrementAndGet()
      return SecondNetworkLease(client) { released.incrementAndGet() }
    }
  }

  private fun engine(
    settings: DownloadSettings = DownloadSettings.DEFAULT,
    onWifi: Boolean = true,
    second: SecondNetwork = SecondNetwork.NONE,
    size: Long = 40L * 1024 * 1024,
    transfers: Transfers = recordAll(),
  ) = DownloadEngine(
    store = store,
    prober = Prober { request ->
      probes += request
      val kind = if (FtpUrl.isFtp(request.url)) SourceKind.FTP else SourceKind.PROGRESSIVE
      ProbeResult.Success(kind, request.url, null, Container.MKV, size, true, emptyList(), emptyList(), null)
    },
    transfers = transfers,
    verification = Verification { _, _ -> VerifyResult.Valid },
    inspector = MediaInspector {
      MediaMetadata(1_000, 640, 360, null, hasVideo = true, hasAudio = true, "video/avc", "audio/mp4a-latm", "video/x-matroska")
    },
    library = library,
    paths = paths,
    scope = scope,
    network = Network(onWifi),
    initialSettings = settings,
    retryDelay = {},
    secondNetwork = second,
    idFactory = { "src-${ids.incrementAndGet()}" },
  )

  private fun recordAll() = FakeTransfers { _, spec, onProgress ->
    specs += spec
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(ByteArray(1_000))
    onProgress(1_000, 1_000)
    TransferOutcome.Completed(1_000, 1_000, null, spec.url)
  }

  private fun request(url: String, kind: SourceKind, mirrors: List<String> = emptyList(), credentials: BasicCredentials? = null, wifiOnly: Boolean? = null) =
    EnqueueRequest(
      url = url,
      kind = kind,
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
      credentials = credentials,
      qualityLabel = null,
      saveToGallery = false,
      wifiOnly = wifiOnly,
      mirrors = mirrors,
    )

  private suspend fun waitFor(predicate: suspend () -> Boolean) {
    withTimeout(15_000) { while (!predicate()) delay(20) }
  }

  // --- #304 FTP ---

  @Test fun anFtpDownloadRunsAsOneFileAndItsPasswordIsNeverStored() = runBlocking {
    val engine = engine()
    val record = engine.enqueue(
      request("ftp://files.example.com/pub/clip.mkv", SourceKind.FTP, credentials = BasicCredentials("alice", "s3cret")),
    )
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.COMPLETED, row.state)
    assertEquals(SourceKind.FTP, row.kind)
    assertFalse("no password in the row", row.url.contains("s3cret") || row.request.toString().contains("s3cret"))
    val spec = specs.single()
    assertEquals("ftp://files.example.com/pub/clip.mkv", spec.url)
    assertEquals("the transfer finds its sign-in by download id", record.id, spec.context.authKey)
    assertTrue("FTP is one connection: no mirrors, no second network", spec.mirrors.isEmpty() && spec.secondNetwork == null)
    assertTrue("the sign-in is held for its FTP server", DownloadCredentials.has(record.id))
  }

  @Test fun theSameFtpFileIsOneVideo() = runBlocking {
    val engine = engine(transfers = FakeTransfers { _, _, _ -> kotlinx.coroutines.awaitCancellation() })
    val first = engine.enqueueUnique(request("ftp://files.example.com/pub/clip.mkv", SourceKind.FTP))
    val second = engine.enqueueUnique(request("ftp://files.example.com/pub/clip.mkv", SourceKind.FTP))
    assertTrue(first is com.vidorax.media.model.EnqueueResult.Enqueued)
    assertTrue(second is com.vidorax.media.model.EnqueueResult.AlreadyDownloading)
    engine.cancel((first as com.vidorax.media.model.EnqueueResult.Enqueued).record.id)
  }

  // --- #347 mirrors ---

  @Test fun mirrorsArePersistedAndHandedToTheTransfer() = runBlocking {
    val engine = engine()
    val main = "https://cdn.example/movie.mp4"
    val record = engine.enqueue(
      request(main, SourceKind.PROGRESSIVE, mirrors = listOf("https://mirror-a.example/movie.mp4", main, "https://mirror-a.example/movie.mp4")),
    )
    engine.awaitIdle()

    assertEquals("the main link and repeats are dropped", listOf("https://mirror-a.example/movie.mp4"), store.mirrors[record.id])
    assertEquals(listOf("https://mirror-a.example/movie.mp4"), specs.single().mirrors)
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
  }

  @Test fun addingAMirrorToARunningDownloadRestartsItsTransferWithIt() = runBlocking {
    val started = CompletableDeferred<Unit>()
    val transfers = FakeTransfers { call, spec, onProgress ->
      specs += spec
      if (call == 0) {
        started.complete(Unit)
        kotlinx.coroutines.awaitCancellation()
      }
      spec.partFile.parentFile?.mkdirs()
      spec.partFile.writeBytes(ByteArray(1_000))
      onProgress(1_000, 1_000)
      TransferOutcome.Completed(1_000, 1_000, null, spec.url)
    }
    val engine = engine(transfers = transfers)
    val record = engine.enqueue(request("https://cdn.example/movie.mp4", SourceKind.PROGRESSIVE))
    withTimeout(10_000) { started.await() }

    val kept = engine.setDownloadMirrors(record.id, listOf("https://mirror-b.example/movie.mp4"))
    assertEquals(listOf("https://mirror-b.example/movie.mp4"), kept)
    waitFor { store.current(record.id)?.state == DownloadState.COMPLETED }
    assertTrue(specs.first().mirrors.isEmpty())
    assertEquals(listOf("https://mirror-b.example/movie.mp4"), specs.last().mirrors)
    assertEquals(listOf("https://mirror-b.example/movie.mp4"), engine.downloadMirrors(record.id))
  }

  @Test fun mirrorsAreOnlyForAFileDownload() = runBlocking {
    val engine = engine(transfers = FakeTransfers { _, _, _ -> kotlinx.coroutines.awaitCancellation() })
    val ftp = engine.enqueue(request("ftp://files.example.com/pub/clip.mkv", SourceKind.FTP))
    assertThrows(InvalidRequestException::class.java) {
      runBlocking { engine.setDownloadMirrors(ftp.id, listOf("https://mirror.example/clip.mkv")) }
    }
    engine.cancel(ftp.id)
  }

  // --- #446 two networks ---

  @Test fun theMobileNetworkIsUsedOnlyWhenTheSettingIsOnAndGivenBack() = runBlocking {
    val second = CountingSecondNetwork()
    val engine = engine(DownloadSettings.DEFAULT.copy(multiNetwork = true), second = second)
    engine.enqueue(request("https://cdn.example/a.mp4", SourceKind.PROGRESSIVE))
    engine.awaitIdle()
    assertEquals(1, second.acquired.get())
    assertEquals("released when the transfer ended", 1, second.released.get())
    assertTrue(specs.single().secondNetwork === second.client)
  }

  @Test fun offByDefault() = runBlocking {
    val second = CountingSecondNetwork()
    val engine = engine(second = second)
    engine.enqueue(request("https://cdn.example/a.mp4", SourceKind.PROGRESSIVE))
    engine.awaitIdle()
    assertEquals(0, second.acquired.get())
    assertNull(specs.single().secondNetwork)
  }

  @Test fun neverForADownloadThatKeepsToWifiOrWhenNotOnWifi() = runBlocking {
    val second = CountingSecondNetwork()
    // Its own "Wi-Fi only" (#480).
    engine(DownloadSettings.DEFAULT.copy(multiNetwork = true), second = second).apply {
      enqueue(request("https://cdn.example/a.mp4", SourceKind.PROGRESSIVE, wifiOnly = true))
      awaitIdle()
    }
    // Already on mobile data: nothing to add.
    engine(DownloadSettings.DEFAULT.copy(multiNetwork = true), onWifi = false, second = second).apply {
      enqueue(request("https://cdn.example/b.mp4", SourceKind.PROGRESSIVE))
      awaitIdle()
    }
    // A small file runs on one connection: nothing to split.
    engine(DownloadSettings.DEFAULT.copy(multiNetwork = true), second = second, size = 2_000_000).apply {
      enqueue(request("https://cdn.example/c.mp4", SourceKind.PROGRESSIVE))
      awaitIdle()
    }
    assertEquals(0, second.acquired.get())
  }
}
