package com.vidorax.media.engine

import com.vidorax.media.InvalidStateException
import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.plan.HlsPlanner
import com.vidorax.media.plan.Probe
import com.vidorax.media.transfer.HlsTransfer
import com.vidorax.media.transfer.LiveCheckpoint
import com.vidorax.media.transfer.ProgressiveTransfer
import com.vidorax.media.transfer.TsJoin
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.Job
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancelAndJoin
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
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * F6: the engine recording a live HLS stream through the REAL planner, segment fetches and HTTP client against a
 * playlist that grows while it records: setting → plan → RECORDING → Stop / end → verified library file; a process
 * death mid-recording is finalized on the next start.
 */
@RunWith(RobolectricTestRunner::class)
class DownloadEngineLiveTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private lateinit var server: MockWebServer
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)
  private val requests = CopyOnWriteArrayList<RecordedRequest>()
  private val segments = ConcurrentHashMap<String, ByteArray>()
  private val http = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)

  /** What the live playlist lists now (segment names), and whether it says the stream ended. */
  @Volatile private var listed: List<String> = emptyList()

  @Volatile private var ended = false

  /** Called on every playlist request, before it is answered: lets a test grow the stream as it is read. */
  @Volatile private var onPlaylist: (Int) -> Unit = {}
  private val playlistReads = AtomicInteger(0)

  private val seg0 = fixture("/media/hls-ts/seg0.ts")
  private val seg1 = fixture("/media/hls-ts/seg1.ts")
  private val other = fixture("/media/hls-ts/other.ts")

  private val on = DownloadSettings.DEFAULT.copy(liveRecording = true)

  @Before fun setUp() {
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
    segments["/live/s0.ts"] = seg0
    segments["/live/s1.ts"] = seg1
    segments["/live/s2.ts"] = other
    server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        requests += request
        val path = request.requestUrl!!.encodedPath
        if (path == "/live/index.m3u8") {
          onPlaylist(playlistReads.incrementAndGet())
          return MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl").setBody(livePlaylist())
        }
        return segments[path]?.let { MockResponse().setBody(Buffer().write(it)) } ?: MockResponse().setResponseCode(404)
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

  private fun livePlaylist(): String = buildString {
    // The shortest reload the recorder uses (2 s) keeps the test quick.
    append("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n")
    for (name in listed) append("#EXTINF:2.0,\n$name\n")
    if (ended) append("#EXT-X-ENDLIST\n")
  }

  private fun engine(
    settings: DownloadSettings = on,
    engineScope: CoroutineScope = scope,
    freeSpace: FreeSpace = FreeSpace { Long.MAX_VALUE },
  ) = DownloadEngine(
    store = store,
    prober = RealProber(Probe(http, HlsPlanner(http))),
    transfers = RealTransfers(ProgressiveTransfer(http)),
    verification = RealVerification,
    inspector = MediaInspector { video() },
    library = library,
    paths = paths,
    scope = engineScope,
    hls = RealHlsDownloads(HlsPlanner(http), HlsTransfer(http)),
    retryDelay = {},
    initialSettings = settings,
    idFactory = { "live-${ids.incrementAndGet()}" },
    freeSpace = freeSpace,
  )

  private fun video() = MediaMetadata(
    durationMs = 6_000, width = 640, height = 360, bitrate = null, hasVideo = true, hasAudio = true,
    videoCodec = "video/avc", audioCodec = "audio/mp4a-latm", containerMimeType = "video/mp2ts",
  )

  private fun request(kind: SourceKind = SourceKind.LIVE) = EnqueueRequest(
    url = server.url("/live/index.m3u8").toString(),
    kind = kind,
    manifestText = null,
    audioUrl = null,
    variant = null,
    request = RequestContext("VidoraX-Test-UA", "https://page.example/live", null, emptyMap(), useCookies = false),
    title = "Live",
    site = SiteId.WEB,
    pageUrl = "https://page.example/live",
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = "Live",
    saveToGallery = null,
  )

  private fun count(path: String) = requests.count { it.requestUrl!!.encodedPath == path }

  private fun checkpointOf(id: String) = LiveCheckpoint.read(File(paths.workDir(id), DownloadEngine.LIVE_CHECKPOINT_NAME))

  private suspend fun waitFor(timeoutMs: Long = 15_000, predicate: suspend () -> Boolean) {
    withTimeout(timeoutMs) { while (!predicate()) delay(20) }
  }

  @Test fun withTheSettingOffALiveStreamIsNotRecorded() = runBlocking {
    listed = listOf("s0.ts", "s1.ts")
    val engine = engine(settings = DownloadSettings.DEFAULT)
    val record = engine.enqueue(request())
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.LIVE_UNSUPPORTED, row.errorCode)
    assertEquals("nothing is fetched", 0, requests.size)
    assertTrue(library.items.isEmpty())
  }

  @Test fun aLiveStreamIsRecordedAsItGrowsUntilItEndsIntoOneLibraryFile() = runBlocking {
    listed = listOf("s0.ts", "s1.ts")
    // The plan and the first reload see two segments; the next reload a third one and the end of the stream.
    onPlaylist = { read -> if (read >= 3) { listed = listOf("s0.ts", "s1.ts", "s2.ts"); ended = true } }
    val engine = engine()
    val events = CopyOnWriteArrayList<DownloadProgress>()
    val collector = launch { engine.progress.collect { events += it } }

    val record = engine.enqueue(request())
    assertEquals(SourceKind.LIVE, record.kind)
    engine.awaitIdle()
    collector.cancel()

    val row = store.current(record.id)!!
    assertEquals(row.errorMessage, DownloadState.COMPLETED, row.state)
    assertTrue(DownloadState.RECORDING in store.stateHistory(record.id))
    val item = library.items[record.id]!!
    assertArrayEquals("every segment once, in order", TsJoin.of(seg0, seg1, other), item.file.readBytes())
    assertEquals(Container.TS, item.container)
    assertEquals(1, count("/live/s0.ts"))
    assertEquals(1, count("/live/s2.ts"))
    assertFalse("work dir (part + checkpoint) cleaned", paths.workDir(record.id).exists())
    assertTrue("progress carries the recorded length", events.any { (it.recordedMs ?: 0) >= 4_000 })
    assertNull("a live recording has no total", events.firstNotNullOfOrNull { it.totalBytes })
  }

  @Test fun stopFinalizesWhatWasRecordedAndAddsNothingAfter() = runBlocking {
    listed = listOf("s0.ts", "s1.ts")
    val engine = engine()
    val record = engine.enqueue(request())
    waitFor { checkpointOf(record.id)?.lastSequence == 1L }
    assertEquals(DownloadState.RECORDING, store.current(record.id)!!.state)
    assertEquals(4_000L, engine.listDownloads().single { it.id == record.id }.recordedMs)

    listed = listOf("s0.ts", "s1.ts", "s2.ts")
    val stopped = engine.stopRecording(record.id)
    assertEquals(record.id, stopped.id)
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals(TsJoin.of(seg0, seg1), library.items[record.id]!!.file.readBytes())
    assertEquals("nothing is fetched after Stop", 0, count("/live/s2.ts"))
  }

  @Test fun aRecordingIsNeitherPausedNorStoppedWhenItIsNotOne() = runBlocking {
    listed = listOf("s0.ts", "s1.ts")
    val engine = engine()
    val record = engine.enqueue(request())
    waitFor { checkpointOf(record.id)?.lastSequence == 1L }
    try {
      engine.pause(record.id)
      fail("a recording is stopped, not paused")
    } catch (expected: InvalidStateException) {
    }
    engine.pauseAll()
    assertEquals(DownloadState.RECORDING, store.current(record.id)!!.state)
    engine.stopRecording(record.id)
    engine.awaitIdle()
    try {
      engine.stopRecording(record.id)
      fail("a finished recording cannot be stopped")
    } catch (expected: InvalidStateException) {
    }
  }

  @Test fun aRecordingInterruptedByAProcessDeathIsFinalizedOnTheNextStart() = runBlocking {
    listed = listOf("s0.ts", "s1.ts")
    val firstScope = CoroutineScope(dispatcher + Job())
    val first = engine(engineScope = firstScope)
    val record = first.enqueue(request())
    waitFor { checkpointOf(record.id)?.lastSequence == 1L }
    // The process dies: nothing runs any more, the row still says RECORDING, half a segment may follow the last
    // whole one.
    firstScope.coroutineContext[Job]!!.cancelAndJoin()
    assertEquals(DownloadState.RECORDING, store.current(record.id)!!.state)
    File(paths.workDir(record.id), DownloadEngine.PART_NAME).appendBytes(other.copyOf(1_000))
    val readsBefore = playlistReads.get()

    listed = listOf("s0.ts", "s1.ts", "s2.ts")
    val second = engine()
    second.restore()
    second.restore() // idempotent
    second.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertArrayEquals("exactly the checkpointed segments", TsJoin.of(seg0, seg1), library.items[record.id]!!.file.readBytes())
    assertEquals("a finalized recording does not record on", readsBefore, playlistReads.get())
    assertEquals(1, library.insertCalls.get())
  }

  @Test fun aStreamThatNeverSendsVideoFailsWithoutALibraryItem() = runBlocking {
    listed = listOf("s0.ts")
    val engine = engine(freeSpace = FreeSpace { 1_000 })
    val record = engine.enqueue(request())
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.NO_SPACE, row.errorCode)
    assertEquals(0, count("/live/s0.ts"))
    assertTrue(library.items.isEmpty())
    assertFalse(paths.workDir(record.id).exists())
  }

  @Test fun aProbeOffersALiveStreamForRecordingOnlyWhenTheSettingIsOn() = runBlocking {
    listed = listOf("s0.ts", "s1.ts")
    val probe = com.vidorax.media.model.ProbeRequest(
      url = server.url("/live/index.m3u8").toString(),
      kind = SourceKind.HLS,
      manifestText = null,
      request = RequestContext("VidoraX-Test-UA", "https://page.example/live", null, emptyMap(), useCookies = false),
    )
    val off = engine(settings = DownloadSettings.DEFAULT).probe(probe)
    assertEquals(com.vidorax.media.model.ProbeFailure.LIVE_UNSUPPORTED, (off as com.vidorax.media.model.ProbeResult.Failure).reason)

    val on = engine().probe(probe) as com.vidorax.media.model.ProbeResult.Success
    assertEquals(SourceKind.LIVE, on.kind)
    assertNull("a live stream has no length yet", on.durationMs)
    assertFalse(on.resumable)
    assertEquals("the same answer when asked for a recording", SourceKind.LIVE, (engine().probe(probe.copy(kind = SourceKind.LIVE)) as com.vidorax.media.model.ProbeResult.Success).kind)

    assertEquals("only the first bytes of one segment, to confirm it is a video", 0, count("/live/s1.ts"))

    ended = true
    assertEquals("a stream that ended is a download again", SourceKind.HLS, (engine().probe(probe) as com.vidorax.media.model.ProbeResult.Success).kind)
  }

  @Test fun anEncryptedLiveStreamIsRefusedAsProtected() = runBlocking {
    listed = listOf("s0.ts")
    segments["/live/key.bin"] = ByteArray(16)
    val engine = engine()
    server.dispatcher.let { real ->
      server.dispatcher = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse =
          if (request.requestUrl!!.encodedPath == "/live/index.m3u8") {
            MockResponse().setBody(livePlaylist().replace("#EXT-X-MEDIA-SEQUENCE:0\n", "#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n"))
          } else {
            real.dispatch(request)
          }
      }
    }
    val record = engine.enqueue(request())
    engine.awaitIdle()

    assertEquals(DownloadErrorCode.DRM_PROTECTED, store.current(record.id)!!.errorCode)
    val probe = com.vidorax.media.model.ProbeRequest(record.let { server.url("/live/index.m3u8").toString() }, SourceKind.HLS, null, request().request)
    val verdict = engine.probe(probe) as com.vidorax.media.model.ProbeResult.Failure
    assertEquals("an encrypted live stream is never offered for recording", com.vidorax.media.model.ProbeFailure.DRM_PROTECTED, verdict.reason)
    assertEquals(0, count("/live/s0.ts"))
    assertEquals(0, count("/live/key.bin"))
  }
}
