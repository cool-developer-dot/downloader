package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.plan.HlsPlanner
import com.vidorax.media.plan.Probe
import com.vidorax.media.transfer.HlsCheckpoint
import com.vidorax.media.transfer.HlsTransfer
import com.vidorax.media.transfer.ProgressiveTransfer
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The engine driving unencrypted VOD HLS through the REAL planner (Media3 parsing), segment transfer, verifier
 * and HTTP client against MockWebServer: detect → classify → enqueue → transfer → verify → finalize → library.
 */
@RunWith(RobolectricTestRunner::class)
class DownloadEngineHlsTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private lateinit var server: MockWebServer
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)
  private val routes = ConcurrentHashMap<String, (RecordedRequest) -> MockResponse>()
  private val requests = CopyOnWriteArrayList<RecordedRequest>()
  private val delays = CopyOnWriteArrayList<Long>()
  private val http = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)

  private val seg0 = fixture("/media/hls-ts/seg0.ts")
  private val seg1 = fixture("/media/hls-ts/seg1.ts")
  private val other = fixture("/media/hls-ts/other.ts")
  private val init = fixture("/media/hls-fmp4/video-init.mp4")
  private val fragment = fixture("/media/hls-fmp4/video0.m4s")

  @Before fun setUp() {
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
    server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        requests += request
        return routes[request.requestUrl!!.encodedPath]?.invoke(request) ?: MockResponse().setResponseCode(404)
      }
    }
    server.start()
  }

  @After fun tearDown() {
    runCatching { server.shutdown() }
    dispatcher.close()
  }

  private fun fixture(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing fixture $path" }.use { it.readBytes() }

  private fun engine(
    inspector: MediaInspector = MediaInspector { video() },
    settings: DownloadSettings = DownloadSettings.DEFAULT,
  ) = DownloadEngine(
    store = store,
    prober = RealProber(Probe(http, HlsPlanner(http))),
    transfers = RealTransfers(ProgressiveTransfer(http)),
    verification = RealVerification,
    inspector = inspector,
    library = library,
    paths = paths,
    scope = scope,
    hls = RealHlsDownloads(HlsPlanner(http), HlsTransfer(http)),
    retryDelay = { delays += it },
    initialSettings = settings,
    idFactory = { "hls-${ids.incrementAndGet()}" },
  )

  private fun video() = MediaMetadata(
    durationMs = 12_000, width = 640, height = 360, bitrate = null, hasVideo = true, hasAudio = true,
    videoCodec = "video/avc", audioCodec = "audio/mp4a-latm", containerMimeType = "video/mp2ts",
  )

  private fun playlist(path: String, body: String) {
    routes[path] = { MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl").setBody(body.trimIndent()) }
  }

  private fun serve(path: String, bytes: ByteArray, throttle: Boolean = false) {
    routes[path] = {
      MockResponse().setBody(Buffer().write(bytes)).apply { if (throttle) throttleBody(512, 30, TimeUnit.MILLISECONDS) }
    }
  }

  private fun mediaPlaylist(vararg segments: String, endList: Boolean = true, extra: String = "") = buildString {
    append("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n$extra")
    for (s in segments) append("#EXTINF:4.0,\n$s\n")
    if (endList) append("#EXT-X-ENDLIST\n")
  }

  private fun request(path: String, kind: SourceKind = SourceKind.HLS, variant: VariantChoice? = null) = EnqueueRequest(
    url = server.url(path).toString(),
    kind = kind,
    manifestText = null,
    audioUrl = null,
    variant = variant,
    request = RequestContext("VidoraX-Test-UA", "https://page.example/watch", null, emptyMap(), useCookies = false),
    title = "Stream",
    site = SiteId.WEB,
    pageUrl = "https://page.example/watch",
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = "360p",
    saveToGallery = null,
  )

  private fun count(path: String) = requests.count { it.requestUrl!!.encodedPath == path }

  private suspend fun waitFor(timeoutMs: Long = 15_000, predicate: suspend () -> Boolean) {
    withTimeout(timeoutMs) { while (!predicate()) delay(20) }
  }

  private fun serveMaster() {
    playlist(
      "/m/master.m3u8",
      """
      #EXTM3U
      #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
      low/index.m3u8
      #EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
      hi/index.m3u8
      """,
    )
    playlist("/m/low/index.m3u8", mediaPlaylist("s0.ts", "s1.ts"))
    playlist("/m/hi/index.m3u8", mediaPlaylist("s0.ts", "s1.ts", "s2.ts"))
    serve("/m/low/s0.ts", seg0)
    serve("/m/low/s1.ts", seg1)
    serve("/m/hi/s0.ts", seg0)
    serve("/m/hi/s1.ts", seg1)
    serve("/m/hi/s2.ts", other)
  }

  // ---------- the whole pipeline ----------

  @Test fun aMasterPlaylistDownloadsItsBestVariantIntoOneVerifiedLibraryFile() = runBlocking {
    serveMaster()
    val engine = engine()
    val events = CopyOnWriteArrayList<DownloadProgress>()
    val collector = launch { engine.progress.collect { events += it } }

    val record = engine.enqueue(request("/m/master.m3u8"))
    engine.awaitIdle()
    collector.cancel()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.COMPLETED, row.state)
    assertEquals(SourceKind.HLS, row.kind)
    val item = library.items[record.id]!!
    assertEquals(Container.TS, item.container)
    assertTrue(item.file.name.endsWith(".ts"))
    assertArrayEquals("segments in playlist order, byte for byte", seg0 + seg1 + other, item.file.readBytes())
    assertEquals(item.file.length(), row.totalBytes)
    assertEquals(item.file.length(), row.bytesDone)
    assertFalse("work dir (part + checkpoint) cleaned", paths.workDir(record.id).exists())
    assertEquals("the lower variant is never touched", 0, count("/m/low/index.m3u8"))
    assertTrue(events.isNotEmpty())
    assertEquals(listOf(DownloadState.QUEUED, DownloadState.PROBING, DownloadState.DOWNLOADING), store.stateHistory(record.id).distinct().take(3))
  }

  @Test fun theChosenQualityIsTheOneDownloadedAndIsRemembered() = runBlocking {
    serveMaster()
    val engine = engine()
    val record = engine.enqueue(request("/m/master.m3u8", variant = VariantChoice(null, null, 400)))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals(400, store.current(record.id)!!.variant!!.maxHeight)
    assertArrayEquals(seg0 + seg1, library.items[record.id]!!.file.readBytes())
    assertEquals(0, count("/m/hi/index.m3u8"))
  }

  @Test fun aProbeClassifiesTheQualityThatWouldBeDownloaded() = runBlocking {
    // Only the low quality is encrypted: its verdict must not borrow the clear high quality's.
    playlist(
      "/q/master.m3u8",
      """
      #EXTM3U
      #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
      low/index.m3u8
      #EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
      hi/index.m3u8
      """,
    )
    playlist("/q/low/index.m3u8", mediaPlaylist("s0.ts", extra = "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n"))
    playlist("/q/hi/index.m3u8", mediaPlaylist("s0.ts"))
    val context = RequestContext("VidoraX-Test-UA", "https://page.example/watch", null, emptyMap(), useCookies = false)
    fun probe(variant: VariantChoice?) = ProbeRequest(server.url("/q/master.m3u8").toString(), SourceKind.HLS, null, context, variant)
    fun reason(result: ProbeResult) = (result as? ProbeResult.Failure)?.reason

    assertTrue(engine().probe(probe(null)) is ProbeResult.Success)
    assertEquals(ProbeFailure.DRM_PROTECTED, reason(engine().probe(probe(VariantChoice(null, null, 400)))))
    val preferLow = engine(settings = DownloadSettings.DEFAULT.copy(preferredMaxHeight = 400))
    assertEquals("the preferred-quality setting applies as it would at enqueue", ProbeFailure.DRM_PROTECTED, reason(preferLow.probe(probe(null))))
    assertEquals(0, count("/q/low/key.bin"))
    assertEquals("the encrypted variant is refused from its playlist alone", 0, count("/q/low/s0.ts"))
  }

  @Test fun anFmp4MediaPlaylistBecomesOneMp4() = runBlocking {
    playlist("/f/index.m3u8", mediaPlaylist("a.m4s", "b.m4s", extra = "#EXT-X-MAP:URI=\"init.mp4\"\n"))
    serve("/f/init.mp4", init)
    serve("/f/a.m4s", fragment)
    serve("/f/b.m4s", fragment)
    val engine = engine()

    val record = engine.enqueue(request("/f/index.m3u8"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    val item = library.items[record.id]!!
    assertEquals(Container.MP4, item.container)
    assertTrue(item.file.name.endsWith(".mp4"))
    val bytes = item.file.readBytes()
    assertArrayEquals(init, bytes.copyOfRange(0, init.size))
    val boxes = com.vidorax.media.transfer.Fmp4Boxes.topLevel(bytes)
    assertEquals("one index for the whole file", listOf("ftyp", "moov", "sidx"), boxes.take(3).map { it.type })
    assertEquals(2, boxes.count { it.type == "moof" })
    assertEquals(1, boxes.count { it.type == "sidx" })
  }

  @Test fun anExtensionlessUrlThatServesAPlaylistIsDownloadedAsHls() = runBlocking {
    playlist("/watch/abc123", mediaPlaylist("/seg/s0.ts", "/seg/s1.ts"))
    serve("/seg/s0.ts", seg0)
    serve("/seg/s1.ts", seg1)
    val engine = engine()

    val record = engine.enqueue(request("/watch/abc123", kind = SourceKind.PROGRESSIVE))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals(seg0 + seg1, library.items[record.id]!!.file.readBytes())
  }

  // ---------- pause / resume / restart ----------

  @Test fun pauseStopsNewSegmentsAndResumeContinuesFromTheCheckpoint() = runBlocking {
    val big = other + other + other + other
    playlist("/p/index.m3u8", mediaPlaylist("s0.ts", "s1.ts", "s2.ts"))
    serve("/p/s0.ts", seg0)
    serve("/p/s1.ts", big, throttle = true)
    serve("/p/s2.ts", seg1)
    val engine = engine()
    val record = engine.enqueue(request("/p/index.m3u8"))
    val checkpoint = File(paths.workDir(record.id), DownloadEngine.HLS_CHECKPOINT_NAME)

    waitFor { HlsCheckpoint.read(checkpoint)?.completed == 1 }
    engine.pause(record.id)
    assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
    val requestsAtPause = requests.size
    delay(300)
    assertEquals("a paused download starts no new request", requestsAtPause, requests.size)
    assertEquals(0, count("/p/s2.ts"))

    serve("/p/s1.ts", big)
    engine.resume(record.id)
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals(seg0 + big + seg1, library.items[record.id]!!.file.readBytes())
    assertEquals("the finished segment is not fetched again", 1, count("/p/s0.ts"))
    assertEquals(1, library.items.size)
  }

  @Test fun aRestartedProcessRecoversFromTheCheckpointWithoutADuplicate() = runBlocking {
    val big = other + other + other
    playlist("/r/index.m3u8", mediaPlaylist("s0.ts", "s1.ts"))
    serve("/r/s0.ts", seg0)
    serve("/r/s1.ts", big, throttle = true)
    val first = engine()
    val record = first.enqueue(request("/r/index.m3u8"))
    val checkpoint = File(paths.workDir(record.id), DownloadEngine.HLS_CHECKPOINT_NAME)
    waitFor { HlsCheckpoint.read(checkpoint)?.completed == 1 }
    first.pause(record.id)
    // The process died mid-download: the row still says DOWNLOADING, with a byte count nobody can trust.
    store.save(store.current(record.id)!!.copy(state = DownloadState.DOWNLOADING, bytesDone = 999_999))

    serve("/r/s1.ts", big)
    val second = engine()
    second.restore()
    second.restore() // idempotent: never a second worker
    second.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals(seg0 + big, library.items[record.id]!!.file.readBytes())
    assertEquals(1, count("/r/s0.ts"))
    assertEquals(1, library.insertCalls.get())
  }

  // ---------- truthful refusals ----------

  @Test fun encryptedHlsFailsAsProtectedWithoutTouchingASegmentOrKey() = runBlocking {
    playlist("/e/index.m3u8", mediaPlaylist("s0.ts", extra = "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n"))
    val engine = engine()
    val record = engine.enqueue(request("/e/index.m3u8"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.DRM_PROTECTED, row.errorCode)
    assertEquals(listOf("/e/index.m3u8"), requests.map { it.requestUrl!!.encodedPath })
    assertTrue(library.items.isEmpty())
    assertTrue("a protected source is never retried", delays.isEmpty())
  }

  @Test fun aLiveStreamFailsAsUnsupported() = runBlocking {
    playlist("/l/index.m3u8", mediaPlaylist("s0.ts", endList = false))
    val engine = engine()
    val record = engine.enqueue(request("/l/index.m3u8"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.LIVE_UNSUPPORTED, store.current(record.id)!!.errorCode)
    assertEquals(0, count("/l/s0.ts"))
  }

  @Test fun anAudioOnlyResultIsNotAVideoDownload() = runBlocking {
    playlist("/ao/index.m3u8", mediaPlaylist("s0.ts"))
    serve("/ao/s0.ts", seg0)
    val engine = engine(inspector = MediaInspector { video().copy(hasVideo = false, width = null, height = null) })
    val record = engine.enqueue(request("/ao/index.m3u8"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.UNSUPPORTED_FORMAT, store.current(record.id)!!.errorCode)
    assertTrue(library.items.isEmpty())
  }

  // ---------- transient failures ----------

  @Test fun aPlaylistServerErrorIsWaitedOutNotReported() = runBlocking {
    val calls = AtomicInteger(0)
    routes["/t/index.m3u8"] = {
      if (calls.incrementAndGet() <= 2) MockResponse().setResponseCode(503)
      else MockResponse().setBody(mediaPlaylist("s0.ts"))
    }
    serve("/t/s0.ts", seg0)
    val engine = engine()
    val record = engine.enqueue(request("/t/index.m3u8"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertTrue(DownloadState.WAITING_RETRY in store.stateHistory(record.id))
    assertEquals(DownloadEngine.CLASSIFY_RETRY_DELAYS_MS.take(2), delays.toList())
  }

  @Test fun aSegmentServerErrorIsRetriedFromTheSameSegment() = runBlocking {
    val calls = AtomicInteger(0)
    playlist("/s/index.m3u8", mediaPlaylist("s0.ts", "s1.ts"))
    serve("/s/s0.ts", seg0)
    routes["/s/s1.ts"] = {
      if (calls.incrementAndGet() == 1) MockResponse().setResponseCode(503) else MockResponse().setBody(Buffer().write(seg1))
    }
    val engine = engine()
    val record = engine.enqueue(request("/s/index.m3u8"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals(seg0 + seg1, library.items[record.id]!!.file.readBytes())
    assertEquals(1, count("/s/s0.ts"))
  }

  @Test fun anExpiredSegmentLinkReReadsThePlaylistOnceAndContinues() = runBlocking {
    val playlistReads = AtomicInteger(0)
    routes["/x/index.m3u8"] = {
      val n = playlistReads.incrementAndGet()
      MockResponse().setBody(mediaPlaylist("s0.ts?tok=$n", "s1.ts?tok=$n"))
    }
    routes["/x/s0.ts"] = { MockResponse().setBody(Buffer().write(seg0)) }
    routes["/x/s1.ts"] = { r ->
      if (r.requestUrl!!.queryParameter("tok") == "1") MockResponse().setResponseCode(403)
      else MockResponse().setBody(Buffer().write(seg1))
    }
    val engine = engine()
    val record = engine.enqueue(request("/x/index.m3u8"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals(2, playlistReads.get())
    assertArrayEquals(seg0 + seg1, library.items[record.id]!!.file.readBytes())
    assertEquals("the segment finished before the refresh is kept", 1, count("/x/s0.ts"))
  }

  @Test fun aStreamThatNeedsTheBrowsingSessionGetsItForPlaylistsAndSegments() = runBlocking {
    val sessionHttp = HttpClient.create(cookies = { "sid=user" }, urlPolicy = UrlPolicy.ALLOW_ALL)
    val cookieRequired = { bytes: ByteArray?, body: String? ->
      { r: RecordedRequest ->
        if (r.getHeader("Cookie") != "sid=user") MockResponse().setResponseCode(403)
        else if (body != null) MockResponse().setBody(body) else MockResponse().setBody(Buffer().write(bytes!!))
      }
    }
    routes["/c/index.m3u8"] = cookieRequired(null, mediaPlaylist("s0.ts", "s1.ts"))
    routes["/c/s0.ts"] = cookieRequired(seg0, null)
    routes["/c/s1.ts"] = cookieRequired(seg1, null)
    val engine = DownloadEngine(
      store = store,
      prober = RealProber(Probe(sessionHttp, HlsPlanner(sessionHttp))),
      transfers = RealTransfers(ProgressiveTransfer(sessionHttp)),
      verification = RealVerification,
      inspector = MediaInspector { video() },
      library = library,
      paths = paths,
      scope = scope,
      hls = RealHlsDownloads(HlsPlanner(sessionHttp), HlsTransfer(sessionHttp)),
      retryDelay = { delays += it },
      idFactory = { "sess-${ids.incrementAndGet()}" },
    )

    val record = engine.enqueue(request("/c/index.m3u8"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals(seg0 + seg1, library.items[record.id]!!.file.readBytes())
    assertTrue(store.current(record.id)!!.request.useCookies)
    assertEquals("one refused try without the session, then everything with it", 1, requests.count { it.getHeader("Cookie") == null })
  }

  @Test fun aSegmentThatIsGoneFailsAsASegmentFailure() = runBlocking {
    playlist("/g/index.m3u8", mediaPlaylist("s0.ts", "missing.ts"))
    serve("/g/s0.ts", seg0)
    val engine = engine()
    val record = engine.enqueue(request("/g/index.m3u8"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.SEGMENT_FAILED, store.current(record.id)!!.errorCode)
    assertNull(library.items[record.id])
  }

  @Test fun aDownloadWaitingToRetryCanBePaused() = runBlocking {
    routes["/w/index.m3u8"] = { MockResponse().setResponseCode(503) }
    val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
    val waiting = DownloadEngine(
      store = store,
      prober = RealProber(Probe(http)),
      transfers = RealTransfers(ProgressiveTransfer(http)),
      verification = RealVerification,
      inspector = MediaInspector { video() },
      library = library,
      paths = paths,
      scope = scope,
      hls = RealHlsDownloads(HlsPlanner(http), HlsTransfer(http)),
      retryDelay = { gate.await() },
      idFactory = { "wait-${ids.incrementAndGet()}" },
    )
    val record = waiting.enqueue(request("/w/index.m3u8"))
    waitFor { store.current(record.id)?.state == DownloadState.WAITING_RETRY }

    waiting.pause(record.id)

    assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
    waiting.awaitIdle()
    assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
  }
}
