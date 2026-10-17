package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.ProgressPhase
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.plan.HlsPlanner
import com.vidorax.media.plan.Probe
import com.vidorax.media.transfer.HlsTransfer
import com.vidorax.media.transfer.ProgressiveTransfer
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Segment Progress (#315): the progress events of an HLS (or DASH) segment download carry segmentsDone and
 * segmentsTotal, read from the track's checkpoint; a file download's events carry neither. The event throttle is the
 * existing one.
 */
@RunWith(RobolectricTestRunner::class)
class DownloadEngineSegmentProgressTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private lateinit var server: MockWebServer
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)
  private val routes = HashMap<String, () -> MockResponse>()
  private val http = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)

  @Before fun setUp() {
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
    server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse =
        synchronized(routes) { routes[request.requestUrl!!.encodedPath] }?.invoke() ?: MockResponse().setResponseCode(404)
    }
    server.start()
  }

  @After fun tearDown() {
    runCatching { server.shutdown() }
    dispatcher.close()
  }

  private fun fixture(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing fixture $path" }.use { it.readBytes() }

  private fun route(path: String, response: () -> MockResponse) = synchronized(routes) { routes[path] = response }

  private fun video() = MediaMetadata(
    durationMs = 12_000, width = 640, height = 360, bitrate = null, hasVideo = true, hasAudio = true,
    videoCodec = "video/avc", audioCodec = "audio/mp4a-latm", containerMimeType = "video/mp2ts",
  )

  private fun request(url: String, kind: SourceKind) = EnqueueRequest(
    url = url,
    kind = kind,
    manifestText = null,
    audioUrl = null,
    variant = null,
    request = RequestContext("VidoraX-Test-UA", null, null, emptyMap(), useCookies = false),
    title = "Stream",
    site = SiteId.WEB,
    pageUrl = null,
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = false,
  )

  @Test fun anHlsDownloadsProgressEventsCountItsSegments() = runBlocking {
    val playlist = buildString {
      append("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n")
      for (s in listOf("s0.ts", "s1.ts", "s2.ts")) append("#EXTINF:4.0,\n$s\n")
      append("#EXT-X-ENDLIST\n")
    }
    route("/h/index.m3u8") { MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl").setBody(playlist) }
    for ((name, bytes) in listOf("s0.ts" to "/media/hls-ts/seg0.ts", "s1.ts" to "/media/hls-ts/seg1.ts", "s2.ts" to "/media/hls-ts/other.ts")) {
      val body = fixture(bytes)
      // Slow segments: several progress events per segment.
      route("/h/$name") { MockResponse().setBody(Buffer().write(body)).throttleBody(512, 30, TimeUnit.MILLISECONDS) }
    }
    val engine = DownloadEngine(
      store = store,
      prober = RealProber(Probe(http, HlsPlanner(http))),
      transfers = RealTransfers(ProgressiveTransfer(http)),
      verification = RealVerification,
      inspector = MediaInspector { video() },
      library = library,
      paths = paths,
      scope = scope,
      hls = RealHlsDownloads(HlsPlanner(http), HlsTransfer(http)),
      retryDelay = {},
      idFactory = { "seg-${ids.incrementAndGet()}" },
    )
    val events = CopyOnWriteArrayList<DownloadProgress>()
    val collector = launch { engine.progress.collect { events += it } }

    val record = engine.enqueue(request(server.url("/h/index.m3u8").toString(), SourceKind.HLS))
    engine.awaitIdle()
    collector.cancel()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    val download = events.filter { it.phase == ProgressPhase.DOWNLOAD }
    assertTrue("several download events", download.size >= 2)
    assertTrue("every download event knows the total", download.all { it.segmentsTotal == 3 })
    val done = download.map { it.segmentsDone!! }
    assertTrue("within 0..total: $done", done.all { it in 0..3 })
    assertEquals("never goes backwards: $done", done, done.sorted())
    assertTrue("a finished segment is counted: $done", done.any { it >= 1 })
    // The processing stage reports no segments.
    assertTrue(events.filter { it.phase == ProgressPhase.PROCESSING }.all { it.segmentsDone == null && it.segmentsTotal == null })
  }

  @Test fun aFileDownloadsProgressEventsHaveNoSegmentFields() = runBlocking {
    val transfers = FakeTransfers { _, spec, onProgress ->
      spec.partFile.parentFile?.mkdirs()
      spec.partFile.writeBytes(ByteArray(1_000))
      onProgress(500, 1_000)
      onProgress(1_000, 1_000)
      TransferOutcome.Completed(1_000, 1_000, null, spec.url)
    }
    val engine = DownloadEngine(
      store = store,
      prober = Prober {
        ProbeResult.Success(SourceKind.PROGRESSIVE, it.url, "video/mp4", Container.MP4, 1_000, true, emptyList(), emptyList(), null)
      },
      transfers = transfers,
      verification = Verification { _, _ -> VerifyResult.Valid },
      inspector = MediaInspector { video() },
      library = library,
      paths = paths,
      scope = scope,
      retryDelay = {},
      idFactory = { "file-${ids.incrementAndGet()}" },
    )
    val events = CopyOnWriteArrayList<DownloadProgress>()
    val collector = launch { engine.progress.collect { events += it } }

    val record = engine.enqueue(request("https://cdn.example/v.mp4", SourceKind.PROGRESSIVE))
    engine.awaitIdle()
    collector.cancel()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertTrue(events.isNotEmpty())
    for (event in events) {
      assertNull(event.segmentsDone)
      assertNull(event.segmentsTotal)
    }
  }
}
