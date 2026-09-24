package com.vidorax.media.engine

import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vidorax.media.db.MediaDatabase
import com.vidorax.media.library.LibraryStore
import com.vidorax.media.library.MediaInfo
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.LibraryQuery
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.plan.AndroidDecoderSupport
import com.vidorax.media.plan.HlsPlanner
import com.vidorax.media.plan.Probe
import com.vidorax.media.transfer.HlsCheckpoint
import com.vidorax.media.transfer.HlsTransfer
import com.vidorax.media.transfer.ProgressiveTransfer
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On-device end-to-end validation of unencrypted VOD HLS through the REAL engine: Media3 playlist parsing, OkHttp,
 * SQLite, the segment transfer, the verifier, MediaExtractor/MediaMetadataRetriever and the filesystem — then the
 * finished library file is opened with Media3 ExoPlayer (the player expo-video runs) to prove it plays and seeks.
 * Fixtures are real H.264/AAC HLS renditions generated with ffmpeg; the server is an on-device MockWebServer.
 */
@RunWith(AndroidJUnit4::class)
class HlsE2EAndroidTest {
  private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

  private lateinit var db: MediaDatabase
  private lateinit var paths: StoragePaths
  private lateinit var library: LibraryStore
  private lateinit var store: SqliteDownloadStore
  private lateinit var http: HttpClient
  private lateinit var scope: CoroutineScope
  private lateinit var server: MockWebServer
  private val requests = CopyOnWriteArrayList<RecordedRequest>()
  private val throttled = ConcurrentHashMap.newKeySet<String>()
  private val failOnce = ConcurrentHashMap<String, AtomicInteger>()

  private fun newEngine(): DownloadEngine {
    val planner = HlsPlanner(http, AndroidDecoderSupport)
    return DownloadEngine(
      store = store,
      prober = RealProber(Probe(http, planner)),
      transfers = RealTransfers(ProgressiveTransfer(http)),
      verification = RealVerification,
      inspector = RealMediaInspector(MediaInfo(context)),
      library = RealLibraryWriter(library),
      paths = paths,
      scope = scope,
      hls = RealHlsDownloads(planner, HlsTransfer(http)),
    )
  }

  @Before fun setUp() = runBlocking {
    db = MediaDatabase(context)
    db.transaction { it.execSQL("DELETE FROM downloads"); it.execSQL("DELETE FROM library") }
    paths = StoragePaths.from(context)
    listOf(paths.libraryDir, paths.workRoot, paths.thumbnailsDir).forEach { it.deleteRecursively() }
    library = LibraryStore(db, paths)
    store = SqliteDownloadStore(db)
    // The fixture server is on-device loopback; production refuses non-public hosts.
    http = HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL)
    scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    server = MockWebServer().apply { dispatcher = FixtureDispatcher(); start() }
  }

  @After fun tearDown() {
    runCatching { server.shutdown() }
    scope.cancel()
    db.close()
  }

  private fun resource(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing $path" }.use { it.readBytes() }

  private fun segments(variant: String, ext: String = "ts") = (0..3).map { resource("/hls/$variant/seg$it.$ext") }

  private inner class FixtureDispatcher : Dispatcher() {
    override fun dispatch(request: RecordedRequest): MockResponse {
      requests += request
      val url = request.requestUrl!!
      val path = url.encodedPath
      failOnce[path]?.let { if (it.getAndIncrement() == 0) return MockResponse().setResponseCode(503) }
      // Token-protected tree: every request must carry the token the page's playlist URL was issued with.
      if (path.startsWith("/tok/")) {
        if (url.queryParameter("token") != "T0K") return MockResponse().setResponseCode(403)
        return serve(path.removePrefix("/tok"), path)
      }
      if (path == "/aes/index.m3u8") return text(String(resource("/hls/aes.m3u8")))
      if (path == "/live/index.m3u8") {
        return text(String(resource("/hls/ts/360/index.m3u8")).replace("#EXT-X-ENDLIST", "").replace("#EXT-X-PLAYLIST-TYPE:VOD\n", ""))
      }
      return serve(path.removePrefix("/slow"), path)
    }

    private fun serve(fixturePath: String, requestPath: String): MockResponse {
      val stream = javaClass.getResourceAsStream("/hls$fixturePath") ?: return MockResponse().setResponseCode(404)
      val bytes = stream.use { it.readBytes() }
      if (fixturePath.endsWith(".m3u8")) return text(String(bytes))
      return MockResponse().setHeader("Content-Type", if (fixturePath.endsWith(".ts")) "video/mp2t" else "video/mp4")
        .setBody(Buffer().write(bytes))
        .apply {
          if (requestPath.startsWith("/slow/") && requestPath.endsWith("seg1.ts") && requestPath in throttled) {
            throttleBody(4_096, 60, TimeUnit.MILLISECONDS)
          }
        }
    }

    private fun text(body: String) = MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl").setBody(body)
  }

  private fun request(path: String, variant: VariantChoice? = null) = EnqueueRequest(
    url = server.url(path).toString(),
    kind = SourceKind.HLS,
    manifestText = null,
    audioUrl = null,
    variant = variant,
    request = RequestContext("VidoraX-E2E", "https://page.example/watch", null, emptyMap(), useCookies = false),
    title = "HLS Clip",
    site = SiteId.WEB,
    pageUrl = "https://page.example/watch",
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = null,
  )

  private fun count(path: String) = requests.count { it.requestUrl!!.encodedPath == path }

  private suspend fun pollUntil(timeoutMs: Long = 20_000, predicate: suspend () -> Boolean) {
    withTimeout(timeoutMs) { while (!predicate()) delay(40) }
  }

  // ---------- the player path ----------

  private data class Playback(val durationMs: Long, val width: Int, val height: Int, val seekable: Boolean, val positionAfterSeekMs: Long)

  /** Opens the file with Media3 ExoPlayer — what expo-video plays — and seeks to the middle. */
  private fun play(file: File): Playback {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    lateinit var player: ExoPlayer
    var error: PlaybackException? = null
    instrumentation.runOnMainSync {
      player = ExoPlayer.Builder(context).build()
      player.addListener(object : Player.Listener {
        override fun onPlayerError(e: PlaybackException) { error = e }
      })
      player.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)))
      player.prepare()
    }
    try {
      waitMain(10_000) { error != null || player.playbackState == Player.STATE_READY }
      error?.let { throw AssertionError("ExoPlayer could not play ${file.name}: ${it.errorCodeName}", it) }
      var duration = 0L
      var width = 0
      var height = 0
      var seekable = false
      instrumentation.runOnMainSync {
        duration = player.duration
        seekable = player.isCurrentMediaItemSeekable
        val video = player.currentTracks.groups.firstOrNull { it.type == C.TRACK_TYPE_VIDEO }?.getTrackFormat(0)
        width = video?.width ?: 0
        height = video?.height ?: 0
        player.seekTo(duration / 2)
      }
      waitMain(10_000) { error != null || player.playbackState == Player.STATE_READY && !player.isLoading }
      var position = 0L
      instrumentation.runOnMainSync { position = player.currentPosition }
      return Playback(duration, width, height, seekable, position)
    } finally {
      instrumentation.runOnMainSync { player.release() }
    }
  }

  private fun waitMain(timeoutMs: Long, condition: () -> Boolean) {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      var done = false
      InstrumentationRegistry.getInstrumentation().runOnMainSync { done = condition() }
      if (done) return
      Thread.sleep(50)
    }
    throw AssertionError("timed out waiting for the player")
  }

  private fun assertPlays(file: File, expectWidth: Int, expectHeight: Int) {
    val playback = play(file)
    assertTrue("duration ${playback.durationMs}", playback.durationMs in 7_000..9_000)
    assertEquals(expectWidth, playback.width)
    assertEquals(expectHeight, playback.height)
    assertTrue("seekable", playback.seekable)
    assertTrue("seek landed near the middle (${playback.positionAfterSeekMs})", playback.positionAfterSeekMs in 3_000..6_000)
  }

  // ---------- 7/9: master playlist, qualities ----------

  @Test fun masterPlaylistDownloadsTheBestVariantAsOnePlayableFile() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/ts/master.m3u8"))
    engine.awaitIdle()

    val row = store.find(rec.id)!!
    assertEquals(DownloadState.COMPLETED, row.state)
    val item = library.get(rec.id)!!
    assertEquals(Container.TS, item.container)
    assertTrue(item.file.name.endsWith(".ts"))
    assertArrayEquals("segments in order, byte for byte", segments("ts/360").reduce { a, b -> a + b }, item.file.readBytes())
    assertEquals(640, item.width)
    assertEquals(360, item.height)
    assertTrue("duration from the real file", (item.durationMs ?: 0) in 7_000..9_000)
    assertTrue(item.hasAudio)
    assertFalse("part + checkpoint cleaned", paths.workDir(rec.id).exists())
    assertEquals("the other quality is never fetched", 0, count("/ts/240/index.m3u8"))
    assertPlays(item.file, 640, 360)
  }

  @Test fun theChosenLowerQualityIsDownloaded() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/ts/master.m3u8", VariantChoice(null, null, 240)))
    engine.awaitIdle()

    val item = library.get(rec.id)!!
    assertArrayEquals(segments("ts/240").reduce { a, b -> a + b }, item.file.readBytes())
    assertEquals(240, item.height)
    assertPlays(item.file, 426, 240)
  }

  // ---------- 8: media playlist, fMP4 ----------

  @Test fun anFmp4MediaPlaylistBecomesOnePlayableMp4(): Unit = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/fmp4/index.m3u8"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.find(rec.id)!!.state)
    val item = library.get(rec.id)!!
    assertEquals(Container.MP4, item.container)
    val init = resource("/hls/fmp4/init.mp4")
    val bytes = item.file.readBytes()
    assertArrayEquals("init section first", init, bytes.copyOfRange(0, init.size))
    assertEquals("one sidx for the whole file right after the init", "sidx", String(bytes, init.size + 4, 4, Charsets.US_ASCII))
    // Every segment's media (moof+mdat) is present byte for byte, in order.
    var cursor = init.size
    for (segment in segments("fmp4", "m4s")) {
      val moof = indexOf(segment, "moof".toByteArray()) - 4
      val media = segment.copyOfRange(moof, segment.size)
      val at = indexOf(bytes, media, cursor)
      assertTrue("segment media found in order", at >= cursor)
      cursor = at + media.size
    }
    assertEquals(bytes.size, cursor)
    assertTrue("metadata reads the full duration (${item.durationMs})", (item.durationMs ?: 0) in 7_000..9_000)
    val playback = play(item.file)
    android.util.Log.i("HlsE2E", "fMP4 playback: $playback")
    assertPlays(item.file, 640, 360)
  }

  private fun indexOf(haystack: ByteArray, needle: ByteArray, from: Int = 0): Int {
    outer@ for (i in from..haystack.size - needle.size) {
      for (j in needle.indices) if (haystack[i + j] != needle[j]) continue@outer
      return i
    }
    return -1
  }

  // ---------- 11/13: pause, resume, restart ----------

  @Test fun pauseAndResumeContinueFromTheCheckpointWithoutDuplicateBytes() = runBlocking {
    throttled += "/slow/ts/360/seg1.ts"
    val engine = newEngine()
    val rec = engine.enqueue(request("/slow/ts/360/index.m3u8"))
    val checkpoint = File(paths.workDir(rec.id), DownloadEngine.HLS_CHECKPOINT_NAME)
    pollUntil { HlsCheckpoint.read(checkpoint)?.completed == 1 }
    engine.pause(rec.id)
    assertEquals(DownloadState.PAUSED, store.find(rec.id)!!.state)
    val atPause = requests.size
    delay(500)
    assertEquals("paused: no new segment request", atPause, requests.size)

    throttled.clear()
    engine.resume(rec.id)
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.find(rec.id)!!.state)
    val item = library.get(rec.id)!!
    assertArrayEquals(segments("ts/360").reduce { a, b -> a + b }, item.file.readBytes())
    assertEquals("finished segment not refetched", 1, count("/slow/ts/360/seg0.ts"))
    assertEquals(1, library.list(LibraryQuery()).items.count { it.id == rec.id })
    assertPlays(item.file, 640, 360)
  }

  @Test fun aProcessRestartRecoversFromTheCheckpoint() = runBlocking {
    throttled += "/slow/ts/360/seg1.ts"
    val first = newEngine()
    val rec = first.enqueue(request("/slow/ts/360/index.m3u8"))
    val checkpoint = File(paths.workDir(rec.id), DownloadEngine.HLS_CHECKPOINT_NAME)
    pollUntil { HlsCheckpoint.read(checkpoint)?.completed == 1 }
    first.pause(rec.id)
    // Process death mid-download: the row still says DOWNLOADING with an untrustworthy byte count.
    store.save(store.find(rec.id)!!.copy(state = DownloadState.DOWNLOADING, bytesDone = 999_999))

    throttled.clear()
    val second = newEngine()
    second.restore()
    second.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.find(rec.id)!!.state)
    assertArrayEquals(segments("ts/360").reduce { a, b -> a + b }, library.get(rec.id)!!.file.readBytes())
    assertEquals(1, count("/slow/ts/360/seg0.ts"))
  }

  // ---------- 10: tokenized HLS ----------

  @Test fun aTokenizedStreamCarriesItsTokenToEveryChild() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/tok/ts/master.m3u8?token=T0K"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.find(rec.id)!!.state)
    assertArrayEquals(segments("ts/360").reduce { a, b -> a + b }, library.get(rec.id)!!.file.readBytes())
  }

  // ---------- 14/15: protected, live ----------

  @Test fun aes128HlsIsProtectedAndNothingButThePlaylistIsFetched() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/aes/index.m3u8"))
    engine.awaitIdle()

    val row = store.find(rec.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.DRM_PROTECTED, row.errorCode)
    assertEquals(listOf("/aes/index.m3u8"), requests.map { it.requestUrl!!.encodedPath })
    assertNull(library.get(rec.id))
  }

  @Test fun aLiveStreamIsUnsupported() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/live/index.m3u8"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.LIVE_UNSUPPORTED, store.find(rec.id)!!.errorCode)
    assertEquals(0, requests.count { it.requestUrl!!.encodedPath.endsWith(".ts") })
  }

  // ---------- 16: temporary failure ----------

  @Test fun aTemporaryServerErrorOnASegmentIsWaitedOut() = runBlocking {
    failOnce["/ts/360/seg2.ts"] = AtomicInteger(0)
    val engine = newEngine()
    val rec = engine.enqueue(request("/ts/360/index.m3u8"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.find(rec.id)!!.state)
    assertArrayEquals(segments("ts/360").reduce { a, b -> a + b }, library.get(rec.id)!!.file.readBytes())
    assertEquals(2, count("/ts/360/seg2.ts"))
    assertEquals(1, count("/ts/360/seg1.ts"))
    assertNotNull(library.get(rec.id))
  }
}
