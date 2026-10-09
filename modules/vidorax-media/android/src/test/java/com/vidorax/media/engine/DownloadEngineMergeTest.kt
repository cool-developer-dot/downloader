package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.ProcessingStage
import com.vidorax.media.model.ProgressPhase
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.plan.DashPlanner
import com.vidorax.media.plan.HlsPlanner
import com.vidorax.media.plan.Probe
import com.vidorax.media.process.MediaFiles
import com.vidorax.media.process.MediaProcessor
import com.vidorax.media.process.TrackContainer
import com.vidorax.media.process.TrackKind
import com.vidorax.media.transfer.HlsTransfer
import com.vidorax.media.transfer.ProgressiveTransfer
import java.io.File
import java.nio.ByteBuffer
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Separate video and audio through the REAL engine, planners, transfers, remuxer and HTTP client (MockWebServer):
 * split files (a MediaSource player's two tracks), HLS with a separate audio rendition (MPEG-TS video + packed audio
 * whose ID3 timestamp keeps the sync, and fMP4 renditions), single-track MPEG-TS remuxed to MP4 — and the refusals
 * that keep two different videos from ever being merged.
 */
@RunWith(RobolectricTestRunner::class)
class DownloadEngineMergeTest {
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
  private val http = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)

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

  private fun engine(processing: MediaProcessing = RealMediaProcessing(MediaProcessor())): DownloadEngine {
    val hlsPlanner = HlsPlanner(http)
    val probe = Probe(http, hlsPlanner, DashPlanner(http))
    return DownloadEngine(
      store = store,
      prober = RealProber(probe),
      transfers = RealTransfers(ProgressiveTransfer(http)),
      verification = RealVerification,
      inspector = MediaInspector { metadata() },
      library = library,
      paths = paths,
      scope = scope,
      hls = RealHlsDownloads(hlsPlanner, HlsTransfer(http)),
      dash = RealDashDownloads(probe),
      split = RealSplitDownloads(probe),
      processing = processing,
      retryDelay = { },
      initialSettings = DownloadSettings.DEFAULT,
      idFactory = { "merge-${ids.incrementAndGet()}" },
    )
  }

  private fun metadata() = MediaMetadata(
    durationMs = 2_000, width = 96, height = 54, bitrate = null, hasVideo = true, hasAudio = true,
    videoCodec = "video/avc", audioCodec = "audio/mp4a-latm", containerMimeType = "video/mp4",
  )

  /** A file server honouring `Range: bytes=N-`, optionally throttled. */
  private fun serve(path: String, bytes: ByteArray, type: String = "video/mp4", throttle: Boolean = false) {
    routes[path] = { request ->
      val range = request.getHeader("Range")?.substringAfter("bytes=")
      val start = range?.substringBefore('-')?.toLongOrNull()
      val end = range?.substringAfter('-')?.toLongOrNull()?.coerceAtMost(bytes.size - 1L) ?: (bytes.size - 1L)
      val response = if (start == null) {
        MockResponse().setResponseCode(200).setBody(Buffer().write(bytes))
      } else {
        MockResponse().setResponseCode(206)
          .setHeader("Content-Range", "bytes $start-$end/${bytes.size}")
          .setBody(Buffer().write(bytes.copyOfRange(start.toInt(), end.toInt() + 1)))
      }
      response.setHeader("Content-Type", type).setHeader("Accept-Ranges", "bytes").setHeader("ETag", "\"${bytes.size}\"")
        .apply { if (throttle) throttleBody(1024, 20, TimeUnit.MILLISECONDS) }
    }
  }

  private fun playlist(path: String, body: String) {
    routes[path] = { MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl").setBody(body.trimIndent()) }
  }

  private fun request(path: String, kind: SourceKind, audioPath: String? = null) = EnqueueRequest(
    url = server.url(path).toString(),
    kind = kind,
    manifestText = null,
    audioUrl = audioPath?.let { server.url(it).toString() },
    variant = null,
    request = RequestContext("VidoraX-Test-UA", "https://page.example/reel/1", null, emptyMap(), useCookies = false),
    title = "Reel",
    site = SiteId.WEB,
    pageUrl = "https://page.example/reel/1",
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = false,
  )

  private fun count(path: String) = requests.count { it.requestUrl!!.encodedPath == path }

  private fun row(id: String) = store.current(id)!!

  /** First presentation time per track kind of a finished file. */
  private fun starts(file: File): Map<TrackKind, Long> {
    val extractor = MediaFiles.open(file, TrackContainer.MP4)
    try {
      val kinds = (0 until extractor.trackCount).associateWith { MediaFiles.track(it, extractor.getTrackFormat(it))!!.kind }
      kinds.keys.forEach { extractor.selectTrack(it) }
      val first = HashMap<TrackKind, Long>()
      val buffer = ByteBuffer.allocateDirect(1 shl 20)
      var n = 0
      while (extractor.sampleTrackIndex >= 0 && n++ < 400) {
        buffer.clear()
        extractor.readSampleData(buffer, 0)
        val kind = kinds.getValue(extractor.sampleTrackIndex)
        first[kind] = minOf(first[kind] ?: Long.MAX_VALUE, extractor.sampleTime)
        extractor.advance()
      }
      return first
    } finally {
      extractor.release()
    }
  }

  private fun assertMerged(file: File) {
    val info = checkNotNull(MediaFiles.read(file, TrackContainer.MP4)) { "the finished file is readable" }
    assertNotNull("picture", info.video)
    assertNotNull("sound", info.audio)
    assertFalse("a plain, seekable MP4", info.fragmented)
  }

  // ---------- split files ----------

  @Test fun aSplitSourceDownloadsBothFilesAndMergesThem() = runBlocking {
    serve("/r/video.mp4", fixture("/media/process/split-video.mp4"))
    serve("/r/audio.m4a", fixture("/media/process/split-audio.m4a"), type = "audio/mp4")
    val engine = engine()
    val stages = CopyOnWriteArrayList<ProcessingStage>()
    val watcher = scope.launch { engine.progress.collect { p: DownloadProgress -> if (p.phase == ProgressPhase.PROCESSING) p.stage?.let { stages += it } } }

    val record = engine.enqueue(request("/r/video.mp4", SourceKind.SPLIT, "/r/audio.m4a"))
    engine.awaitIdle()
    watcher.cancel()

    val row = row(record.id)
    assertEquals("${row.errorCode} ${row.errorMessage}", DownloadState.COMPLETED, row.state)
    assertEquals(SourceKind.SPLIT, row.kind)
    val item = library.items[record.id]!!
    assertEquals(Container.MP4, item.container)
    assertMerged(item.file)
    assertTrue("the merge was announced", ProcessingStage.MERGING in stages)
    assertFalse(paths.workDir(record.id).exists())
  }

  @Test fun theProbeSaysASplitSourceWillBeMerged() = runBlocking {
    serve("/p/video.mp4", fixture("/media/process/split-video.mp4"))
    serve("/p/audio.m4a", fixture("/media/process/split-audio.m4a"), type = "audio/mp4")
    val result = engine().probe(
      ProbeRequest(
        url = server.url("/p/video.mp4").toString(),
        kind = SourceKind.SPLIT,
        manifestText = null,
        request = RequestContext(null, null, null, emptyMap(), false),
        audioUrl = server.url("/p/audio.m4a").toString(),
      ),
    )
    result as ProbeResult.Success
    assertEquals(SourceKind.SPLIT, result.kind)
    assertTrue(result.mergesAudio)
    assertEquals(96, result.variants.single().width)
  }

  @Test fun tracksOfDifferentLengthsAreNeverDownloadedOrMerged() = runBlocking {
    serve("/m/video.mp4", fixture("/media/process/long-video.mp4"))
    serve("/m/audio.m4a", fixture("/media/process/short-audio.m4a"), type = "audio/mp4")
    val engine = engine()

    val record = engine.enqueue(request("/m/video.mp4", SourceKind.SPLIT, "/m/audio.m4a"))
    engine.awaitIdle()

    assertEquals(DownloadErrorCode.TRACK_MISMATCH, row(record.id).errorCode)
    assertTrue(library.items.isEmpty())
    // Only the classifying reads: the files themselves were never downloaded.
    assertTrue(requests.filter { it.requestUrl!!.encodedPath == "/m/video.mp4" }.all { it.getHeader("Range") == "bytes=0-" })
    assertEquals(1, count("/m/video.mp4"))
  }

  @Test fun anAudioFileWithoutSoundIsRefusedAsAMissingAudioTrack() = runBlocking {
    serve("/n/video.mp4", fixture("/media/process/split-video.mp4"))
    serve("/n/other.mp4", fixture("/media/process/long-video.mp4"))
    val engine = engine()
    val record = engine.enqueue(request("/n/video.mp4", SourceKind.SPLIT, "/n/other.mp4"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.AUDIO_TRACK_MISSING, row(record.id).errorCode)
  }

  @Test fun aVideoFileWithoutPictureIsRefusedAsAMissingVideoTrack() = runBlocking {
    serve("/x/a1.m4a", fixture("/media/process/split-audio.m4a"), type = "audio/mp4")
    serve("/x/a2.m4a", fixture("/media/process/short-audio.m4a"), type = "audio/mp4")
    val engine = engine()
    val record = engine.enqueue(request("/x/a1.m4a", SourceKind.SPLIT, "/x/a2.m4a"))
    engine.awaitIdle()
    assertEquals(DownloadErrorCode.VIDEO_TRACK_MISSING, row(record.id).errorCode)
  }

  @Test fun aPausedSplitDownloadResumesWithoutFetchingTheFinishedVideoAgain() = runBlocking {
    val audio = fixture("/media/process/split-audio.m4a")
    serve("/z/video.mp4", fixture("/media/process/split-video.mp4"))
    serve("/z/audio.m4a", audio, type = "audio/mp4", throttle = true)
    val engine = engine()
    val record = engine.enqueue(request("/z/video.mp4", SourceKind.SPLIT, "/z/audio.m4a"))
    val audioPart = File(paths.workDir(record.id), DownloadEngine.AUDIO_PART_NAME)
    withTimeout(15_000) { while (!(audioPart.isFile && audioPart.length() > 2048)) delay(10) }
    engine.pause(record.id)
    val videoFetches = count("/z/video.mp4")
    val partial = audioPart.length()

    engine.resume(record.id)
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, row(record.id).state)
    // Re-probed (one classifying read) but the finished video file was not transferred a second time.
    val afterResume = requests.filter { it.requestUrl!!.encodedPath == "/z/video.mp4" }.drop(videoFetches)
    assertTrue("only a classifying read of the video after resuming", afterResume.all { it.getHeader("Range") == "bytes=0-" } && afterResume.size <= 1)
    assertTrue("the audio continued from its .part", requests.any { it.requestUrl!!.encodedPath == "/z/audio.m4a" && it.getHeader("Range") == "bytes=$partial-" })
    assertMerged(library.items[record.id]!!.file)
  }

  // ---------- HLS separate audio ----------

  /** ADTS frames of an AAC stream. */
  private fun adtsFrames(bytes: ByteArray): List<ByteArray> {
    val frames = mutableListOf<ByteArray>()
    var off = 0
    while (off + 7 <= bytes.size) {
      val length = ((bytes[off + 3].toInt() and 0x03) shl 11) or ((bytes[off + 4].toInt() and 0xFF) shl 3) or ((bytes[off + 5].toInt() and 0xE0) shr 5)
      frames += bytes.copyOfRange(off, off + length)
      off += length
    }
    return frames
  }

  /** An ID3v2.4 tag with Apple's transport-stream timestamp PRIV frame, as HLS packed audio carries it. */
  private fun id3Timestamp(pts90k: Long): ByteArray {
    val owner = "com.apple.streaming.transportStreamTimestamp".toByteArray(Charsets.ISO_8859_1)
    val payload = owner + byteArrayOf(0) + ByteBuffer.allocate(8).putLong(pts90k).array()
    fun syncsafe(n: Int) = byteArrayOf(((n shr 21) and 0x7F).toByte(), ((n shr 14) and 0x7F).toByte(), ((n shr 7) and 0x7F).toByte(), (n and 0x7F).toByte())
    val frame = "PRIV".toByteArray() + syncsafe(payload.size) + byteArrayOf(0, 0) + payload
    return "ID3".toByteArray() + byteArrayOf(4, 0, 0) + syncsafe(frame.size) + frame
  }

  @Test fun anHlsStreamWithPackedAudioIsMergedAndKeepsItsSync() = runBlocking {
    // Video TS starts at PTS 11.400 s; the audio's ID3 tags say it starts at 11.3768 s (both from one encode).
    serve("/h/v0.ts", fixture("/media/hls-split/v0.ts"), type = "video/mp2t")
    serve("/h/v1.ts", fixture("/media/hls-split/v1.ts"), type = "video/mp2t")
    val frames = adtsFrames(fixture("/media/hls-split/audio.aac"))
    val half = frames.size / 2
    val firstPts = 1_023_910L
    val secondPts = firstPts + half * 1024L * 90_000L / 44_100L
    serve("/h/a0.aac", id3Timestamp(firstPts) + frames.take(half).reduce { a, b -> a + b }, type = "audio/aac")
    serve("/h/a1.aac", id3Timestamp(secondPts) + frames.drop(half).reduce { a, b -> a + b }, type = "audio/aac")
    playlist(
      "/h/master.m3u8",
      """
      #EXTM3U
      #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio.m3u8"
      #EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=96x54,CODECS="avc1.64000a,mp4a.40.2",AUDIO="aud"
      video.m3u8
      """,
    )
    playlist("/h/video.m3u8", "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\nv0.ts\n#EXTINF:1.0,\nv1.ts\n#EXT-X-ENDLIST")
    playlist("/h/audio.m3u8", "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\na0.aac\n#EXTINF:1.0,\na1.aac\n#EXT-X-ENDLIST")
    val engine = engine()

    val record = engine.enqueue(request("/h/master.m3u8", SourceKind.HLS))
    engine.awaitIdle()

    val row = row(record.id)
    assertEquals("${row.errorCode} ${row.errorMessage}", DownloadState.COMPLETED, row.state)
    val file = library.items[record.id]!!.file
    assertMerged(file)
    val starts = starts(file)
    assertTrue("audio first, at 0 (${starts[TrackKind.AUDIO]})", starts.getValue(TrackKind.AUDIO) in 0..1_000)
    assertTrue("video 23 ms later, as in the source (${starts[TrackKind.VIDEO]})", starts.getValue(TrackKind.VIDEO) in 18_000L..28_000L)
  }

  @Test fun anHlsStreamWithFmp4RenditionsIsMerged() = runBlocking {
    for (name in listOf("vinit.mp4", "fv0.m4s", "fv1.m4s", "ainit.mp4", "fa0.m4s", "fa1.m4s", "fa2.m4s")) {
      serve("/f/$name", fixture("/media/hls-split/$name"))
    }
    playlist(
      "/f/master.m3u8",
      """
      #EXTM3U
      #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="main",DEFAULT=YES,URI="audio.m3u8"
      #EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=96x54,CODECS="avc1.64000a,mp4a.40.2",AUDIO="a"
      video.m3u8
      """,
    )
    playlist("/f/video.m3u8", "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:1\n#EXT-X-MAP:URI=\"vinit.mp4\"\n#EXTINF:1.0,\nfv0.m4s\n#EXTINF:1.0,\nfv1.m4s\n#EXT-X-ENDLIST")
    playlist("/f/audio.m3u8", "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:1\n#EXT-X-MAP:URI=\"ainit.mp4\"\n#EXTINF:1.02,\nfa0.m4s\n#EXTINF:1.0,\nfa1.m4s\n#EXTINF:0.02,\nfa2.m4s\n#EXT-X-ENDLIST")
    val engine = engine()

    val record = engine.enqueue(request("/f/master.m3u8", SourceKind.HLS))
    engine.awaitIdle()

    val row = row(record.id)
    assertEquals("${row.errorCode} ${row.errorMessage}", DownloadState.COMPLETED, row.state)
    assertMerged(library.items[record.id]!!.file)
  }

  @Test fun aSingleTrackTransportStreamIsRemuxedIntoAnMp4() = runBlocking {
    serve("/t/av.ts", fixture("/media/process/av.ts"), type = "video/mp2t")
    playlist("/t/index.m3u8", "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nav.ts\n#EXT-X-ENDLIST")
    val engine = engine()

    val record = engine.enqueue(request("/t/index.m3u8", SourceKind.HLS))
    engine.awaitIdle()

    val row = row(record.id)
    assertEquals("${row.errorCode} ${row.errorMessage}", DownloadState.COMPLETED, row.state)
    val item = library.items[record.id]!!
    assertEquals(Container.MP4, item.container)
    assertTrue(item.file.name.endsWith(".mp4"))
    assertMerged(item.file)
  }
}
