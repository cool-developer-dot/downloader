package com.vidorax.media.transfer

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.RequestContext
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRefusedException
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.plan.HlsPlan
import com.vidorax.media.plan.HlsPlannedSegment
import com.vidorax.media.plan.HlsSegmentRef
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class HlsTransferTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var server: MockWebServer
  private val routes = ConcurrentHashMap<String, (RecordedRequest) -> MockResponse>()
  private val requests = CopyOnWriteArrayList<RecordedRequest>()
  private val http = HttpClient.create(cookies = { "sid=user" }, urlPolicy = UrlPolicy.ALLOW_ALL)
  private val transfer = HlsTransfer(http)
  private lateinit var part: File
  private lateinit var checkpoint: File

  private val seg0 = fixture("/media/hls-ts/seg0.ts")
  private val seg1 = fixture("/media/hls-ts/seg1.ts")
  private val other = fixture("/media/hls-ts/other.ts")
  private val init = fixture("/media/hls-fmp4/video-init.mp4")
  private val fragment = fixture("/media/hls-fmp4/video0.m4s")

  private val context = RequestContext("VidoraX-Test-UA", "https://page.example/watch", null, emptyMap(), useCookies = true)

  @Before fun setUp() {
    server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        requests += request
        val url = request.requestUrl!!
        val key = url.encodedPath + (url.encodedQuery?.let { "?$it" } ?: "")
        return (routes[key] ?: routes[url.encodedPath])?.invoke(request) ?: MockResponse().setResponseCode(404)
      }
    }
    server.start()
    val work = tmp.newFolder("work")
    part = File(work, "download.part")
    checkpoint = File(work, "hls.checkpoint")
  }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun fixture(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing fixture $path" }.use { it.readBytes() }

  private fun serve(path: String, bytes: ByteArray, throttle: Boolean = false) {
    routes[path] = {
      MockResponse().setBody(Buffer().write(bytes)).apply { if (throttle) throttleBody(512, 40, TimeUnit.MILLISECONDS) }
    }
  }

  /** A server with real byte-range semantics for one resource. */
  private fun serveRanged(path: String, bytes: ByteArray, honourRange: Boolean = true) {
    routes[path] = { request ->
      val range = request.getHeader("Range")?.removePrefix("bytes=")
      if (range == null || !honourRange) {
        MockResponse().setBody(Buffer().write(bytes))
      } else {
        val start = range.substringBefore('-').toInt()
        val end = range.substringAfter('-').toInt()
        MockResponse().setResponseCode(206)
          .setHeader("Content-Range", "bytes $start-$end/${bytes.size}")
          .setBody(Buffer().write(bytes.copyOfRange(start, end + 1)))
      }
    }
  }

  private fun seg(path: String, durationUs: Long = 4_000_000, initIndex: Int? = null, offset: Long? = null, length: Long? = null) =
    HlsPlannedSegment(HlsSegmentRef(server.url(path).toString(), offset, length), durationUs, initIndex)

  private fun plan(
    segments: List<HlsPlannedSegment>,
    inits: List<HlsSegmentRef> = emptyList(),
    fingerprint: String = "fp-1",
    container: Container = Container.TS,
  ) = HlsPlan(
    sourceUrl = server.url("/master.m3u8?auth=T0K").toString(),
    mediaPlaylistUrl = server.url("/v/index.m3u8?auth=T0K").toString(),
    inits = inits,
    segments = segments,
    durationUs = segments.sumOf { it.durationUs },
    selected = null,
    variants = emptyList(),
    containerHint = container,
    hasDiscontinuities = false,
    fingerprint = fingerprint,
    estimatedBytes = null,
  )

  private fun spec(plan: HlsPlan) = HlsTransferSpec(plan, context, part, checkpoint)

  private fun run(plan: HlsPlan, onProgress: (Long, Long?) -> Unit = { _, _ -> }) =
    runBlocking { transfer.transfer(spec(plan), onProgress) }

  // ---------- assembly ----------

  @Test fun transportStreamSegmentsAreConcatenatedInPlaylistOrder() {
    serve("/v/s0.ts", seg0)
    serve("/v/s1.ts", seg1)
    serve("/v/s2.ts", other)
    val progress = CopyOnWriteArrayList<Long>()

    val outcome = run(plan(listOf(seg("/v/s0.ts"), seg("/v/s1.ts"), seg("/v/s2.ts")))) { bytes, _ -> progress += bytes }

    assertArrayEquals(seg0 + seg1 + other, part.readBytes())
    assertEquals(Container.TS, outcome.container)
    assertEquals(part.length(), outcome.bytesWritten)
    assertEquals(progress, progress.sorted())
    assertEquals(part.length(), progress.last())
    val saved = HlsCheckpoint.read(checkpoint)!!
    assertEquals(3, saved.completed)
    assertEquals(part.length(), saved.partBytes)
    for (request in requests) {
      assertEquals("VidoraX-Test-UA", request.getHeader("User-Agent"))
      assertEquals("https://page.example/watch", request.getHeader("Referer"))
      assertEquals("sid=user", request.getHeader("Cookie"))
    }
  }

  @Test fun anFmp4InitSectionIsWrittenOnceBeforeItsSegments() {
    serve("/f/init.mp4", init)
    serve("/f/a.m4s", fragment)
    serve("/f/b.m4s", fragment)
    val initRef = HlsSegmentRef(server.url("/f/init.mp4").toString())

    val outcome = run(plan(listOf(seg("/f/a.m4s", initIndex = 0), seg("/f/b.m4s", initIndex = 0)), inits = listOf(initRef), container = Container.MP4))

    val bytes = part.readBytes()
    assertArrayEquals("the init section comes first, once", init, bytes.copyOfRange(0, init.size))
    val sidx = Fmp4Boxes.sidx(bytes, init.size)
    assertEquals("one index for the whole file, right after the init section", 2, sidx.sizes.size)
    val boxes = Fmp4Boxes.topLevel(bytes)
    assertEquals(1, boxes.count { it.type == "sidx" })
    assertEquals(2, boxes.count { it.type == "moof" })
    assertEquals(2, boxes.count { it.type == "mdat" })
    assertEquals(init.size + Fmp4Index.placeholderSize(2) + 2 * fragment.size, bytes.size.toLong())
    assertEquals(Container.MP4, outcome.container)
    assertEquals(bytes.size.toLong(), outcome.bytesWritten)
    assertEquals(1, requests.count { it.requestUrl!!.encodedPath == "/f/init.mp4" })
  }

  @Test fun byteRangeSegmentsAreExactSlicesEvenWhenTheServerIgnoresRange() {
    val all = seg0 + seg1
    for (honour in listOf(true, false)) {
      part.delete(); checkpoint.delete(); requests.clear()
      serveRanged("/r/all.ts", all, honourRange = honour)
      val segments = listOf(
        seg("/r/all.ts", offset = 0, length = seg0.size.toLong()),
        seg("/r/all.ts", offset = seg0.size.toLong(), length = seg1.size.toLong()),
      )
      run(plan(segments))
      assertArrayEquals("honourRange=$honour", all, part.readBytes())
      assertEquals("bytes=${seg0.size}-${all.size - 1}", requests[1].getHeader("Range"))
    }
  }

  // ---------- resume ----------

  @Test fun aPauseMidSegmentResumesAtThatSegmentWithoutDuplicateBytes() = runBlocking {
    serve("/v/s0.ts", seg0)
    val big = other + other + other
    serve("/v/s1.ts", big, throttle = true)
    serve("/v/s2.ts", seg1)
    val plan = plan(listOf(seg("/v/s0.ts"), seg("/v/s1.ts"), seg("/v/s2.ts")))

    val job = launch(Dispatchers.IO) { transfer.transfer(spec(plan)) }
    withTimeout(15_000) {
      while (!(HlsCheckpoint.read(checkpoint)?.completed == 1 && part.length() > seg0.size + 1024)) delay(20)
    }
    job.cancelAndJoin()

    val paused = HlsCheckpoint.read(checkpoint)!!
    assertEquals("only whole segments are checkpointed", 1, paused.completed)
    assertEquals(seg0.size.toLong(), paused.partBytes)
    assertTrue("the half segment is still on disk", part.length() > paused.partBytes)

    routes["/v/s1.ts"] = { MockResponse().setBody(Buffer().write(big)) }
    val outcome = transfer.transfer(spec(plan))

    assertArrayEquals("no byte written twice, none missing", seg0 + big + seg1, part.readBytes())
    assertEquals(part.length(), outcome.bytesWritten)
    assertEquals("a finished segment is never fetched again", 1, requests.count { it.requestUrl!!.encodedPath == "/v/s0.ts" })
  }

  @Test fun aCheckpointForAnotherStreamIsNeverResumedFrom() {
    serve("/v/s0.ts", seg0)
    serve("/v/s1.ts", seg1)
    part.writeBytes(ByteArray(9_000) { 7 })
    HlsCheckpoint.write(checkpoint, HlsCheckpoint("fp-OTHER", 1, 9_000, null, Container.TS))

    run(plan(listOf(seg("/v/s0.ts"), seg("/v/s1.ts"))))

    assertArrayEquals(seg0 + seg1, part.readBytes())
  }

  @Test fun aCheckpointClaimingMoreBytesThanTheFileHasIsIgnored() {
    serve("/v/s0.ts", seg0)
    part.writeBytes(ByteArray(10))
    HlsCheckpoint.write(checkpoint, HlsCheckpoint("fp-1", 1, 5_000, null, Container.TS))

    run(plan(listOf(seg("/v/s0.ts"))))

    assertArrayEquals(seg0, part.readBytes())
  }

  // ---------- failures keep their meaning ----------

  @Test fun aDroppedConnectionIsTransientAndLeavesTheCheckpointAtTheLastWholeSegment() {
    serve("/v/s0.ts", seg0)
    routes["/v/s1.ts"] = {
      MockResponse().setBody(Buffer().write(seg1 + seg1)).setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)
    }
    assertThrows(MediaNetworkException::class.java) { run(plan(listOf(seg("/v/s0.ts"), seg("/v/s1.ts")))) }
    assertEquals(1, HlsCheckpoint.read(checkpoint)!!.completed)
  }

  @Test fun httpStatusesSurfaceForTheEngineToClassify() {
    serve("/v/s0.ts", seg0)
    for ((status, transient) in listOf(403 to false, 404 to false, 503 to true, 429 to true)) {
      part.delete(); checkpoint.delete()
      routes["/v/s1.ts"] = { MockResponse().setResponseCode(status) }
      val error = assertThrows(MediaHttpException::class.java) { run(plan(listOf(seg("/v/s0.ts"), seg("/v/s1.ts")))) }
      assertEquals(status, error.statusCode)
      assertEquals(transient, error.isTransient)
    }
  }

  @Test fun segmentsThatNeedThePlaylistTokenGetItOnceItIsKnownToBeNeeded() {
    for (path in listOf("/v/s0.ts", "/v/s1.ts")) {
      routes[path] = { MockResponse().setResponseCode(403) }
    }
    serve("/v/s0.ts?auth=T0K", seg0)
    serve("/v/s1.ts?auth=T0K", seg1)

    run(plan(listOf(seg("/v/s0.ts"), seg("/v/s1.ts"))))

    assertArrayEquals(seg0 + seg1, part.readBytes())
    val sent = requests.map { it.requestUrl!!.let { u -> u.encodedPath + (u.encodedQuery?.let { q -> "?$q" } ?: "") } }
    assertEquals(listOf("/v/s0.ts", "/v/s0.ts?auth=T0K", "/v/s1.ts?auth=T0K"), sent)
  }

  @Test fun packedAudioIsRefusedAsAudioOnly() {
    serve("/a/s0.aac", "ID3".toByteArray() + ByteArray(2_000))
    val refused = assertThrows(MediaRefusedException::class.java) { run(plan(listOf(seg("/a/s0.aac")))) }
    assertEquals(ProbeFailure.UNSUPPORTED_FORMAT, refused.reason)
  }

  @Test fun fmp4FragmentsWithoutAnInitSectionAreRefused() {
    serve("/f/a.m4s", fragment)
    val refused = assertThrows(MediaRefusedException::class.java) { run(plan(listOf(seg("/f/a.m4s")))) }
    assertEquals(ProbeFailure.UNSUPPORTED_FORMAT, refused.reason)
  }

  @Test fun theCheckpointRoundTripsAndCarriesNoUrl() {
    HlsCheckpoint.write(checkpoint, HlsCheckpoint("abc", 7, 1234, 0, Container.MP4))
    assertEquals(HlsCheckpoint("abc", 7, 1234, 0, Container.MP4), HlsCheckpoint.read(checkpoint))
    val text = checkpoint.readText()
    assertTrue(!text.contains("http") && !text.contains("token"))
    checkpoint.writeText("{broken")
    assertEquals(null, HlsCheckpoint.read(checkpoint))
  }
}
