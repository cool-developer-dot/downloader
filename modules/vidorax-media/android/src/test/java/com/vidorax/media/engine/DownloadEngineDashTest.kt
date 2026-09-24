package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
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
import com.vidorax.media.plan.DashPlanner
import com.vidorax.media.plan.HlsPlanner
import com.vidorax.media.plan.Probe
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The engine downloading DASH through the REAL planner (Media3 parsing), probe, progressive transfer, verifier and
 * HTTP client against MockWebServer: only a single-file representation that already is the whole video becomes a
 * library file; every other manifest fails with its own code before a media byte is fetched.
 */
@RunWith(RobolectricTestRunner::class)
class DownloadEngineDashTest {
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

  private val av = fixture("/media/progressive/av.mp4")
  private val videoOnly = fixture("/media/progressive/video-only.mp4")
  private val mov = fixture("/media/formats/qt.mov")

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

  private fun engine(settings: DownloadSettings = DownloadSettings.DEFAULT): DownloadEngine {
    val probe = Probe(http, HlsPlanner(http), DashPlanner(http))
    return DownloadEngine(
      store = store,
      prober = RealProber(probe),
      transfers = RealTransfers(ProgressiveTransfer(http)),
      verification = RealVerification,
      inspector = MediaInspector { video() },
      library = library,
      paths = paths,
      scope = scope,
      hls = RealHlsDownloads(HlsPlanner(http), HlsTransfer(http)),
      dash = RealDashDownloads(probe),
      retryDelay = { delays += it },
      initialSettings = settings,
      idFactory = { "dash-${ids.incrementAndGet()}" },
    )
  }

  private fun video() = MediaMetadata(
    durationMs = 10_000, width = 640, height = 360, bitrate = null, hasVideo = true, hasAudio = true,
    videoCodec = "video/avc", audioCodec = "audio/mp4a-latm", containerMimeType = "video/mp4",
  )

  private fun manifest(path: String, body: () -> String) {
    // trim(), not trimIndent(): the XML declaration must be the first thing in the document.
    routes[path] = { MockResponse().setHeader("Content-Type", "application/dash+xml").setBody(body().trim()) }
  }

  /** A file server that honours `Range: bytes=N-` like a CDN does, optionally throttled. */
  private fun serveRanged(path: String, bytes: ByteArray, throttle: Boolean = false, status: (RecordedRequest) -> Int? = { null }) {
    routes[path] = handler@{ request ->
      status(request)?.let { return@handler MockResponse().setResponseCode(it) }
      val start = request.getHeader("Range")?.substringAfter("bytes=")?.substringBefore('-')?.toLongOrNull()
      val response = if (start == null) {
        MockResponse().setResponseCode(200).setBody(Buffer().write(bytes))
      } else {
        MockResponse().setResponseCode(206)
          .setHeader("Content-Range", "bytes $start-${bytes.size - 1}/${bytes.size}")
          .setBody(Buffer().write(bytes.copyOfRange(start.toInt(), bytes.size)))
      }
      response.setHeader("Content-Type", "video/mp4").setHeader("Accept-Ranges", "bytes").setHeader("ETag", "\"v1\"")
        .apply { if (throttle) throttleBody(256, 40, TimeUnit.MILLISECONDS) }
    }
  }

  private fun rep(id: String, height: Int, codecs: String, file: String, width: Int = height * 16 / 9) = """
    <Representation id="$id" bandwidth="${height * 3000}" width="$width" height="$height" codecs="$codecs"><BaseURL>$file</BaseURL></Representation>
  """

  private fun mpd(vararg reps: String, extraSets: String = "") = """
    <?xml version="1.0" encoding="UTF-8"?>
    <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S" minBufferTime="PT2S">
      <Period><AdaptationSet mimeType="video/mp4" contentType="video">${reps.joinToString("")}</AdaptationSet>$extraSets</Period>
    </MPD>
  """

  private val separateAudio = """
    <AdaptationSet mimeType="audio/mp4" contentType="audio"><Representation id="a" bandwidth="128000" codecs="mp4a.40.2"><BaseURL>a.m4a</BaseURL></Representation></AdaptationSet>
  """

  private fun request(path: String, kind: SourceKind = SourceKind.DASH, variant: VariantChoice? = null) = EnqueueRequest(
    url = server.url(path).toString(),
    kind = kind,
    manifestText = null,
    audioUrl = null,
    variant = variant,
    request = RequestContext("VidoraX-Test-UA", "https://page.example/watch", null, emptyMap(), useCookies = false),
    title = "Clip",
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

  // ---------- downloadable ----------

  @Test fun aMuxedRepresentationDownloadsAsOneVerifiedLibraryFile() = runBlocking {
    manifest("/d/muxed.mpd") { mpd(rep("av", 360, "avc1.42c01e,mp4a.40.2", "av.mp4", width = 640)) }
    serveRanged("/d/av.mp4", av)
    val engine = engine()

    val record = engine.enqueue(request("/d/muxed.mpd"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.COMPLETED, row.state)
    assertEquals(SourceKind.DASH, row.kind)
    assertEquals("the row keeps the manifest, never a file URL that can expire", server.url("/d/muxed.mpd").toString(), row.url)
    val item = library.items[record.id]!!
    assertEquals(Container.MP4, item.container)
    assertArrayEquals("the representation file, byte for byte", av, item.file.readBytes())
    assertEquals(av.size.toLong(), row.bytesDone)
    assertTrue(!paths.workDir(record.id).exists())
  }

  @Test fun theChosenRepresentationIsTheOneDownloadedAndIsRemembered() = runBlocking {
    manifest("/q/multi.mpd") {
      mpd(rep("av-360", 360, "avc1.42c01e,mp4a.40.2", "360.mp4"), rep("av-720", 720, "avc1.64001f,mp4a.40.2", "720.mov"))
    }
    serveRanged("/q/360.mp4", av)
    serveRanged("/q/720.mov", mov)
    val engine = engine()

    val picked = engine.enqueue(request("/q/multi.mpd", variant = VariantChoice("av-360", null, null)))
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(picked.id)!!.state)
    assertEquals("av-360", store.current(picked.id)!!.variant!!.videoId)
    assertArrayEquals(av, library.items[picked.id]!!.file.readBytes())
    assertEquals("the other quality is never fetched", 0, count("/q/720.mov"))

    val best = engine.enqueue(request("/q/multi.mpd"))
    engine.awaitIdle()
    assertArrayEquals("no choice: the best quality", mov, library.items[best.id]!!.file.readBytes())
    assertEquals(Container.MOV, library.items[best.id]!!.container)
  }

  @Test fun aProbeReportsEveryDownloadableQualityAndClassifiesTheOneEnqueueWouldPick() = runBlocking {
    manifest("/p/multi.mpd") {
      mpd(rep("av-360", 360, "avc1.42c01e,mp4a.40.2", "360.mp4"), rep("av-720", 720, "avc1.64001f,mp4a.40.2", "720.mp4"))
    }
    serveRanged("/p/360.mp4", av)
    serveRanged("/p/720.mp4", fixture("/media/formats/audio.m4a"))
    val engine = engine()
    val ctx = RequestContext(null, null, null, emptyMap(), useCookies = false)

    val capped = engine.probe(ProbeRequest(server.url("/p/multi.mpd").toString(), SourceKind.DASH, null, ctx, VariantChoice(null, null, 480)))
    assertTrue("got $capped", capped is ProbeResult.Success)
    assertEquals(listOf("av-720", "av-360"), (capped as ProbeResult.Success).variants.map { it.id })

    // The 720p file is audio only: its own verdict never borrows the 360p one's.
    val best = engine.probe(ProbeRequest(server.url("/p/multi.mpd").toString(), SourceKind.DASH, null, ctx, null))
    assertEquals(ProbeFailure.UNSUPPORTED_FORMAT, (best as ProbeResult.Failure).reason)
  }

  @Test fun anExtensionlessManifestEnqueuedAsAFileIsDownloadedAsTheDashItIs() = runBlocking {
    manifest("/x/stream") { mpd(rep("av", 360, "avc1.42c01e,mp4a.40.2", "av.mp4", width = 640)) }
    serveRanged("/x/av.mp4", av)
    val engine = engine()

    val record = engine.enqueue(request("/x/stream", kind = SourceKind.PROGRESSIVE))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals(av, library.items[record.id]!!.file.readBytes())
  }

  // ---------- refused before any media byte ----------

  @Test fun separateAudioAndVideoFailsAsUnsupportedWithoutFetchingMedia() = runBlocking {
    manifest("/s/split.mpd") { mpd(rep("v", 720, "avc1.64001f", "v.mp4"), extraSets = separateAudio) }
    serveRanged("/s/v.mp4", videoOnly)
    serveRanged("/s/a.m4a", fixture("/media/formats/audio.m4a"))
    val engine = engine()

    val record = engine.enqueue(request("/s/split.mpd"))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.UNSUPPORTED_FORMAT, row.errorCode)
    assertEquals(0, count("/s/v.mp4") + count("/s/a.m4a"))
    assertTrue(library.items.isEmpty())
  }

  @Test fun aProtectedManifestFailsAsProtected() = runBlocking {
    manifest("/w/drm.mpd") {
      mpd(
        """<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>""" +
          rep("av", 360, "avc1.42c01e,mp4a.40.2", "av.mp4"),
      )
    }
    serveRanged("/w/av.mp4", av)
    val engine = engine()

    val record = engine.enqueue(request("/w/drm.mpd"))
    engine.awaitIdle()

    assertEquals(DownloadErrorCode.DRM_PROTECTED, store.current(record.id)!!.errorCode)
    assertEquals(0, count("/w/av.mp4"))
  }

  @Test fun aLiveManifestFailsAsLive() = runBlocking {
    routes["/l/live.mpd"] = {
      MockResponse().setHeader("Content-Type", "application/dash+xml").setBody(
        """<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" availabilityStartTime="2026-01-01T00:00:00Z" minimumUpdatePeriod="PT2S" minBufferTime="PT2S">
          <Period start="PT0S"><AdaptationSet mimeType="video/mp4" contentType="video">${rep("av", 360, "avc1.42c01e,mp4a.40.2", "av.mp4")}</AdaptationSet></Period></MPD>""",
      )
    }
    val engine = engine()

    val record = engine.enqueue(request("/l/live.mpd"))
    engine.awaitIdle()

    assertEquals(DownloadErrorCode.LIVE_UNSUPPORTED, store.current(record.id)!!.errorCode)
  }

  // ---------- transient, expiry, pause/resume, restart ----------

  @Test fun aTemporaryManifestFailureIsWaitedOutThenCompletes() = runBlocking {
    val calls = AtomicInteger(0)
    val body = mpd(rep("av", 360, "avc1.42c01e,mp4a.40.2", "av.mp4", width = 640)).trim()
    routes["/t/flaky.mpd"] = {
      if (calls.incrementAndGet() <= 2) MockResponse().setResponseCode(503)
      else MockResponse().setHeader("Content-Type", "application/dash+xml").setBody(body)
    }
    serveRanged("/t/av.mp4", av)
    val engine = engine()

    val record = engine.enqueue(request("/t/flaky.mpd"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertTrue("waited, never failed", DownloadState.WAITING_RETRY in store.stateHistory(record.id))
    assertEquals(2, delays.size)
    assertArrayEquals(av, library.items[record.id]!!.file.readBytes())
  }

  @Test fun anExpiredRepresentationLinkIsRenewedThroughTheManifest() = runBlocking {
    val fetches = AtomicInteger(0)
    // Every manifest fetch signs the file anew; the first signature stops working after the probe read it.
    manifest("/e/signed.mpd") { mpd(rep("av", 360, "avc1.42c01e,mp4a.40.2", "av.mp4?sig=${fetches.incrementAndGet()}", width = 640)) }
    val firstSignatureUses = AtomicInteger(0)
    serveRanged("/e/av.mp4", av) { request ->
      val sig = request.requestUrl!!.queryParameter("sig")
      if (sig == "1" && firstSignatureUses.incrementAndGet() > 1) 403 else null
    }
    val engine = engine()

    val record = engine.enqueue(request("/e/signed.mpd"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals(av, library.items[record.id]!!.file.readBytes())
    assertTrue("renewed from the manifest", requests.any { it.requestUrl!!.queryParameter("sig") == "2" })
  }

  @Test fun pauseAndResumeContinueFromThePartFileThroughTheManifest() = runBlocking {
    manifest("/r/pause.mpd") { mpd(rep("av", 360, "avc1.42c01e,mp4a.40.2", "av.mp4", width = 640)) }
    serveRanged("/r/av.mp4", av, throttle = true)
    val engine = engine()
    val record = engine.enqueue(request("/r/pause.mpd"))
    val part = File(paths.workDir(record.id), DownloadEngine.PART_NAME)

    waitFor { part.isFile && part.length() > 0 }
    engine.pause(record.id)
    assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
    val onDisk = part.length()
    assertTrue(onDisk in 1 until av.size)

    serveRanged("/r/av.mp4", av)
    engine.resume(record.id)
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals(av, library.items[record.id]!!.file.readBytes())
    val resumed = requests.last { it.requestUrl!!.encodedPath == "/r/av.mp4" }
    assertEquals("resumed from the bytes on disk", "bytes=$onDisk-", resumed.getHeader("Range"))
  }

  @Test fun aRestartedProcessResolvesTheManifestAgainAndFinishesWithoutADuplicate() = runBlocking {
    manifest("/k/restart.mpd") { mpd(rep("av", 360, "avc1.42c01e,mp4a.40.2", "av.mp4", width = 640)) }
    serveRanged("/k/av.mp4", av, throttle = true)
    val first = engine()
    val record = first.enqueue(request("/k/restart.mpd"))
    val part = File(paths.workDir(record.id), DownloadEngine.PART_NAME)
    waitFor { part.isFile && part.length() > 0 }
    first.pause(record.id)
    // The process died mid-download: the row still says DOWNLOADING.
    store.save(store.current(record.id)!!.copy(state = DownloadState.DOWNLOADING))

    serveRanged("/k/av.mp4", av)
    val second = engine()
    second.restore()
    second.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals(av, library.items[record.id]!!.file.readBytes())
    assertEquals(1, library.insertCalls.get())
  }
}
