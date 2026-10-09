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
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.plan.AndroidDecoderSupport
import com.vidorax.media.plan.DashPlanner
import com.vidorax.media.plan.HlsPlanner
import com.vidorax.media.plan.Probe
import com.vidorax.media.process.AndroidCodecSupport
import com.vidorax.media.process.MediaProcessor
import com.vidorax.media.process.Remuxer
import com.vidorax.media.process.TransformerTranscoder
import com.vidorax.media.transfer.HlsTransfer
import com.vidorax.media.transfer.ProgressiveTransfer
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Separate video and audio through the production wiring on a device: the real engine, SQLite, OkHttp, the
 * processing layer (Media3 muxers + Transformer), the library and ExoPlayer — a split source and an HLS stream whose
 * sound is a separate rendition each become one library file with picture and sound.
 */
@RunWith(AndroidJUnit4::class)
class MergeE2EAndroidTest {
  private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

  private lateinit var db: MediaDatabase
  private lateinit var paths: StoragePaths
  private lateinit var library: LibraryStore
  private lateinit var http: HttpClient
  private lateinit var scope: CoroutineScope
  private lateinit var server: MockWebServer
  private val files = HashMap<String, Pair<ByteArray, String>>()

  @Before fun setUp() = runBlocking {
    db = MediaDatabase(context)
    db.transaction { it.execSQL("DELETE FROM downloads"); it.execSQL("DELETE FROM library") }
    paths = StoragePaths.from(context)
    listOf(paths.libraryDir, paths.workRoot, paths.thumbnailsDir).forEach { it.deleteRecursively() }
    library = LibraryStore(db, paths)
    http = HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL)
    scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    server = MockWebServer().apply {
      dispatcher = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
          val (bytes, type) = files[request.requestUrl!!.encodedPath] ?: return MockResponse().setResponseCode(404)
          val start = request.getHeader("Range")?.substringAfter("bytes=")?.substringBefore('-')?.toLongOrNull()
          val end = request.getHeader("Range")?.substringAfter('-')?.toLongOrNull()?.coerceAtMost(bytes.size - 1L) ?: (bytes.size - 1L)
          val response = if (start == null) {
            MockResponse().setResponseCode(200).setBody(Buffer().write(bytes))
          } else {
            MockResponse().setResponseCode(206)
              .setHeader("Content-Range", "bytes $start-$end/${bytes.size}")
              .setBody(Buffer().write(bytes.copyOfRange(start.toInt(), end.toInt() + 1)))
          }
          return response.setHeader("Content-Type", type).setHeader("Accept-Ranges", "bytes")
        }
      }
      start()
    }
  }

  @After fun tearDown() {
    runCatching { server.shutdown() }
    scope.cancel()
    db.close()
  }

  private fun resource(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing $path" }.use { it.readBytes() }

  private fun engine(): DownloadEngine {
    val planner = HlsPlanner(http, AndroidDecoderSupport)
    val probe = Probe(http, planner, DashPlanner(http, AndroidDecoderSupport))
    return DownloadEngine(
      store = SqliteDownloadStore(db),
      prober = RealProber(probe),
      transfers = RealTransfers(ProgressiveTransfer(http)),
      verification = RealVerification,
      inspector = RealMediaInspector(MediaInfo(context)),
      library = RealLibraryWriter(library),
      paths = paths,
      scope = scope,
      hls = RealHlsDownloads(planner, HlsTransfer(http)),
      dash = RealDashDownloads(probe),
      split = RealSplitDownloads(probe),
      processing = RealMediaProcessing(MediaProcessor(Remuxer(), TransformerTranscoder(context), AndroidCodecSupport)),
    )
  }

  private fun request(path: String, kind: SourceKind, audioPath: String? = null) = EnqueueRequest(
    url = server.url(path).toString(),
    kind = kind,
    manifestText = null,
    audioUrl = audioPath?.let { server.url(it).toString() },
    variant = null,
    request = RequestContext("VidoraX-Test-UA", "https://page.example/reel/1", null, emptyMap(), useCookies = false),
    title = "Merged",
    site = SiteId.WEB,
    pageUrl = "https://page.example/reel/1",
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = false,
  )

  private fun tracksOf(file: File): Pair<String?, String?> {
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
      val deadline = System.currentTimeMillis() + 15_000
      var ready = false
      while (!ready && System.currentTimeMillis() < deadline) {
        instrumentation.runOnMainSync { ready = error != null || player.playbackState == Player.STATE_READY }
        if (!ready) Thread.sleep(50)
      }
      error?.let { throw AssertionError("ExoPlayer could not play ${file.name}: ${it.errorCodeName}", it) }
      var video: String? = null
      var audio: String? = null
      instrumentation.runOnMainSync {
        video = player.currentTracks.groups.firstOrNull { it.type == C.TRACK_TYPE_VIDEO }?.getTrackFormat(0)?.sampleMimeType
        audio = player.currentTracks.groups.firstOrNull { it.type == C.TRACK_TYPE_AUDIO }?.getTrackFormat(0)?.sampleMimeType
      }
      return video to audio
    } finally {
      instrumentation.runOnMainSync { player.release() }
    }
  }

  @Test fun aSplitSourceBecomesOneLibraryFileWithPictureAndSound() = runBlocking {
    files["/r/video.mp4"] = resource("/process/split-video.mp4") to "video/mp4"
    files["/r/audio.m4a"] = resource("/process/split-audio.m4a") to "audio/mp4"
    val engine = engine()

    val record = engine.enqueue(request("/r/video.mp4", SourceKind.SPLIT, "/r/audio.m4a"))
    engine.awaitIdle()

    val row = SqliteDownloadStore(db).find(record.id)!!
    assertEquals("${row.errorCode} ${row.errorMessage}", DownloadState.COMPLETED, row.state)
    val item = library.get(record.id)
    assertNotNull(item)
    assertEquals(Container.MP4, item!!.container)
    assertTrue("the library knows it has sound", item.hasAudio)
    val (video, audio) = tracksOf(item.file)
    assertEquals("video/avc", video)
    assertEquals("audio/mp4a-latm", audio)
    assertTrue("no track file left behind", !paths.workDir(record.id).exists())
  }

  @Test fun anHlsStreamWithASeparateAudioRenditionBecomesOneFile() = runBlocking {
    files["/h/master.m3u8"] = """
      #EXTM3U
      #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,URI="audio.m3u8"
      #EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=96x54,CODECS="avc1.64000a,mp4a.40.2",AUDIO="aud"
      video.m3u8
    """.trimIndent().toByteArray() to "application/vnd.apple.mpegurl"
    files["/h/video.m3u8"] = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nvideo.ts\n#EXT-X-ENDLIST\n".toByteArray() to "application/vnd.apple.mpegurl"
    files["/h/audio.m3u8"] = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\naudio.ts\n#EXT-X-ENDLIST\n".toByteArray() to "application/vnd.apple.mpegurl"
    files["/h/video.ts"] = resource("/process/video.ts") to "video/mp2t"
    files["/h/audio.ts"] = resource("/process/audio.ts") to "video/mp2t"
    val engine = engine()

    val record = engine.enqueue(request("/h/master.m3u8", SourceKind.HLS))
    engine.awaitIdle()

    val row = SqliteDownloadStore(db).find(record.id)!!
    assertEquals("${row.errorCode} ${row.errorMessage}", DownloadState.COMPLETED, row.state)
    val item = library.get(record.id)!!
    assertEquals(Container.MP4, item.container)
    val (video, audio) = tracksOf(item.file)
    assertEquals("video/avc", video)
    assertEquals("audio/mp4a-latm", audio)
  }
}
