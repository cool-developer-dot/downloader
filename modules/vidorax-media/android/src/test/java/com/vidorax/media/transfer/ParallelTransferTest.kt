package com.vidorax.media.transfer

import com.vidorax.media.model.RequestContext
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.UrlPolicy
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
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
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * The multi-connection path of [ProgressiveTransfer] ([RangedDownload]) against a MockWebServer with real Range
 * semantics: parts, dynamic segmentation, per-part resume across a process death, and every fallback to one
 * connection.
 */
class ParallelTransferTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var server: MockWebServer
  private val requests = CopyOnWriteArrayList<RecordedRequest>()
  private val context = RequestContext("VidoraX-Test-UA", "https://page.example/", null, emptyMap(), useCookies = false)
  private val http = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)

  /** What the fake origin serves and how it behaves. */
  private inner class Origin(var bytes: ByteArray, var etag: String? = "\"v1\"") {
    var lastModified: String? = null
    /** Answer every Range with the whole file (a server without range support). */
    var ignoreRanges = false
    /** Answer a bounded Range (`bytes=a-b`) with the whole file while an open one (`bytes=a-`) works. */
    var boundedAnswer200 = false
    /** Refuse any request carrying a Range with this status. */
    var rangeRefusal: Int? = null
    /** Refuse the first N bounded-range requests with 403 (a server limiting connections). */
    val refuseBounded = AtomicInteger(0)
    /** Body throttling per requested range start (bytes per 10 ms), null = full speed. */
    var throttle: (start: Long) -> Int? = { null }
    /** Fail once, mid-body, for the range starting here. */
    val dropOnceAt = HashSet<Long>()
    /** Delay before the headers of a bounded range (a server slow to answer: an uncached CDN object). */
    var boundedHeadersDelayMs: Long = 0
    /** Send the ETag without its quotes, and honour If-Range only in the quoted form (upload.wikimedia.org does). */
    var unquotedEtag = false

    fun respond(request: RecordedRequest): MockResponse {
      requests += request
      val range = request.getHeader("Range")?.removePrefix("bytes=")
      val ifRange = request.getHeader("If-Range")
      fun whole() = MockResponse().setResponseCode(200).withValidators().setBody(Buffer().write(bytes))
      if (range == null) return whole()
      rangeRefusal?.let { return MockResponse().setResponseCode(it) }
      if (ignoreRanges) return whole()
      val expected = if (unquotedEtag) "\"$etag\"" else (etag ?: lastModified)
      if (ifRange != null && ifRange != expected) return whole()
      val start = range.substringBefore('-').toLong()
      val endText = range.substringAfter('-')
      if (endText.isNotEmpty()) {
        if (refuseBounded.getAndUpdate { if (it > 0) it - 1 else 0 } > 0) return MockResponse().setResponseCode(403)
        if (boundedAnswer200) return whole()
      }
      if (start >= bytes.size) return MockResponse().setResponseCode(416).setHeader("Content-Range", "bytes */${bytes.size}")
      val end = if (endText.isEmpty()) bytes.size - 1L else minOf(endText.toLong(), bytes.size - 1L)
      val body = bytes.copyOfRange(start.toInt(), end.toInt() + 1)
      val response = MockResponse().setResponseCode(206).withValidators()
        .setHeader("Content-Range", "bytes $start-$end/${bytes.size}")
      if (synchronized(dropOnceAt) { dropOnceAt.remove(start) }) {
        // Half the body, then the connection is gone.
        return response.setHeader("Content-Length", body.size).setBody(Buffer().write(body.copyOfRange(0, body.size / 2)))
          .setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AT_END)
      }
      response.setBody(Buffer().write(body))
      throttle(start)?.let { response.throttleBody(it.toLong(), 10, TimeUnit.MILLISECONDS) }
      if (endText.isNotEmpty() && boundedHeadersDelayMs > 0) response.setHeadersDelay(boundedHeadersDelayMs, TimeUnit.MILLISECONDS)
      return response
    }

    private fun MockResponse.withValidators(): MockResponse = apply {
      etag?.let { setHeader("ETag", it) }
      lastModified?.let { setHeader("Last-Modified", it) }
    }
  }

  private lateinit var origin: Origin

  @Before fun setUp() {
    origin = Origin(source(MB17))
    server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse = origin.respond(request)
    }
    server.start()
  }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun source(size: Int) = ByteArray(size) { ((it * 31) xor (it ushr 9)).toByte() }

  private fun part() = File(tmp.root, "download.part")

  private fun spec(connections: Int, partFile: File = part()) =
    TransferSpec(url = server.url("/video.mp4").toString(), context = context, partFile = partFile, connections = connections)

  private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  private fun ranges() = requests.mapNotNull { it.getHeader("Range") }

  private val noDelay: suspend (Long) -> Unit = {}

  @Test fun aServerThatProvesRangesIsDownloadedOverTheChosenNumberOfConnections() = runBlocking {
    val progress = CopyOnWriteArrayList<Long>()
    val outcome = ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3)) { bytes, _ -> progress += bytes }

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    assertEquals(MB17.toLong(), outcome.bytesWritten)
    assertEquals(MB17.toLong(), outcome.totalBytes)
    // The first request proves ranges; the other two parts are their own bounded ranges (a free connection may
    // split a part later, so only the first three requests are the plan).
    val third = (MB17 + 2) / 3
    val planned = requests.take(3).map { it.getHeader("Range")!! }.sortedBy { it.substringAfter('=').substringBefore('-').toLong() }
    assertEquals(listOf("bytes=0-", "bytes=$third-${2 * third - 1}", "bytes=${2 * third}-${MB17 - 1}"), planned)
    assertTrue("progress is the combined bytes of all parts", progress.last() == MB17.toLong())
    assertFalse("no parts checkpoint once complete", PartsCheckpoint.fileFor(part()).exists())
    assertEquals(MB17.toLong(), TrackDone.length(part()))
    // Every part was asked with the resource's validator, so a changed file could never be spliced in.
    assertTrue(requests.filter { it.getHeader("Range")!!.count { c -> c == '-' } == 1 && !it.getHeader("Range")!!.endsWith("-") }
      .all { it.getHeader("If-Range") == "\"v1\"" })
  }

  @Test fun oneConnectionIsExactlyTodaysSingleStream() = runBlocking {
    ProgressiveTransfer(http).transfer(spec(1))

    assertArrayEquals(origin.bytes, part().readBytes())
    assertEquals(1, requests.size)
    assertNull("a fresh one-connection download sends no Range", requests[0].getHeader("Range"))
  }

  @Test fun aServerWithoutRangesGetsOneConnection() = runBlocking {
    origin.ignoreRanges = true
    ProgressiveTransfer(http).transfer(spec(4))

    assertArrayEquals(origin.bytes, part().readBytes())
    assertEquals("the 200 to bytes=0- is the download itself", 1, requests.size)
  }

  @Test fun aSmallFileStaysOnOneConnection() = runBlocking {
    origin.bytes = source(3 * 1024 * 1024)
    ProgressiveTransfer(http).transfer(spec(4))

    assertArrayEquals(origin.bytes, part().readBytes())
    assertEquals(listOf("bytes=0-"), ranges())
  }

  @Test fun noStrongValidatorMeansOneConnection() = runBlocking {
    origin.etag = "W/\"weak\""
    ProgressiveTransfer(http).transfer(spec(3))

    assertArrayEquals(origin.bytes, part().readBytes())
    assertEquals(1, requests.size)
  }

  @Test fun lastModifiedIsAValidatorToo() = runBlocking {
    origin.etag = null
    origin.lastModified = "Wed, 21 Oct 2026 07:28:00 GMT"
    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(2))

    assertArrayEquals(origin.bytes, part().readBytes())
    val bounded = requests.filter { it.getHeader("Range")!!.substringAfter('-').isNotEmpty() }
    assertTrue(bounded.isNotEmpty())
    assertTrue(bounded.all { it.getHeader("If-Range") == "Wed, 21 Oct 2026 07:28:00 GMT" })
  }

  @Test fun aSignedLinkThatRefusesAnyRangeGetsThePlainRequest() = runBlocking {
    origin.rangeRefusal = 403
    ProgressiveTransfer(http).transfer(spec(3))

    assertArrayEquals(origin.bytes, part().readBytes())
    assertEquals(2, requests.size)
    assertEquals("bytes=0-", requests[0].getHeader("Range"))
    assertNull(requests[1].getHeader("Range"))
  }

  @Test fun aTwoHundredToABoundedRangeContinuesOnOneConnection() = runBlocking {
    origin.boundedAnswer200 = true
    origin.throttle = { start -> if (start == 0L) 64 * 1024 else null }
    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    assertFalse(PartsCheckpoint.fileFor(part()).exists())
  }

  @Test fun extraConnectionsRefusedWith403CarryOnWithOne() = runBlocking {
    origin.refuseBounded.set(2)
    origin.throttle = { start -> if (start == 0L) 256 * 1024 else null }
    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    val refused = 2
    assertTrue("both refused parts were fetched later, one at a time", requests.size >= 1 + refused + 2)
  }

  @Test fun theOnlyConnectionRefusedIsTheDownloadsRefusal() {
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        requests += request
        return MockResponse().setResponseCode(403)
      }
    }
    val error = assertThrows(MediaHttpException::class.java) { runBlocking { ProgressiveTransfer(http).transfer(spec(3)) } }
    assertEquals(403, error.statusCode)
  }

  @Test fun aPartThatDropsIsRetriedOnItsOwn() = runBlocking {
    val third = ((MB17 + 2) / 3).toLong()
    origin.dropOnceAt += third
    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    val secondPart = ranges().map { it.substringAfter('=').substringBefore('-').toLong() }.filter { it in third until 2 * third }
    assertTrue("the dropped part asked again from where it stopped: $secondPart", secondPart.size >= 2 && secondPart.any { it > third })
  }

  @Test fun aFreeConnectionTakesOverHalfOfTheSlowestPart() = runBlocking {
    // The first part crawls; the other two finish fast and split what is left of it.
    origin.throttle = { start -> if (start == 0L) 32 * 1024 else null }
    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    val third = ((MB17 + 2) / 3).toLong()
    val starts = ranges().map { it.substringAfter('=').substringBefore('-').toLong() }
    assertTrue("a range starting inside the first part: $starts", starts.any { it in 1 until third })
  }

  @Test fun aServerThatSendsItsEtagUnquotedStillGetsEveryPartAsARange() = runBlocking {
    origin.etag = "19a40f3ee5e67e2b487b246f207375d3"
    origin.unquotedEtag = true
    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    assertTrue("no part answered with the whole file", requests.none { it.getHeader("Range") != null && it.getHeader("Range") != "bytes=0-" && it.getHeader("If-Range") != "\"19a40f3ee5e67e2b487b246f207375d3\"" })
    assertEquals("no fallback to a fresh one-connection download", 0, requests.count { it.getHeader("Range") == null })
  }

  @Test fun aServerSlowToAnswerGetsNoLateSplitThatWouldOnlyAddAWait() = runBlocking {
    // Every extra request waits 4 s for its headers; the first part streams at under 1 MB/s. When the other parts are
    // done (~4 s), what is left of the first part takes far less than twice that wait: a split would only slow it down.
    origin.boundedHeadersDelayMs = 4_000
    origin.throttle = { start -> if (start == 0L) 10 * 1024 else null }
    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    val third = ((MB17 + 2) / 3).toLong()
    val starts = ranges().map { it.substringAfter('=').substringBefore('-').toLong() }
    assertTrue("no range starting inside the first part: $starts", starts.none { it in 1 until third })
  }

  @Test fun aKilledDownloadResumesEveryPartFromItsCheckpoint() = runBlocking {
    origin.throttle = { 16 * 1024 }
    val job = launch(Dispatchers.IO) { ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3)) }
    withTimeout(20_000) {
      while ((PartsCheckpoint.read(part())?.parts?.count { it.done > 0 } ?: 0) < 3) delay(50)
    }
    job.cancelAndJoin()

    val saved = checkNotNull(PartsCheckpoint.read(part()))
    assertEquals(MB17.toLong(), saved.total)
    assertEquals("\"v1\"", saved.validator)
    assertTrue(saved.parts.all { it.done in 1 until it.length })
    assertEquals("the .part is the whole file, pre-sized", MB17.toLong(), part().length())
    assertEquals(saved.bytesDone, PartProgress.bytesOnDisk(part()))

    // A new process: only the files on disk.
    requests.clear()
    origin.throttle = { null }
    ProgressiveTransfer(HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL), retryDelay = noDelay).transfer(spec(3))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    val resumedStarts = ranges().map { it.substringAfter('=').substringBefore('-').toLong() }.toSet()
    for (p in saved.parts) assertTrue("part ${p.start} resumed at ${p.start + p.done}: $resumedStarts", (p.start + p.done) in resumedStarts)
    assertTrue("nothing already on disk was fetched again", resumedStarts.none { it == 0L })
  }

  @Test fun aChangedResourceStartsOverFromZero() = runBlocking {
    origin.throttle = { 16 * 1024 }
    val job = launch(Dispatchers.IO) { ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3)) }
    withTimeout(20_000) { while ((PartsCheckpoint.read(part())?.bytesDone ?: 0) < 512 * 1024) delay(50) }
    job.cancelAndJoin()

    origin.bytes = source(MB17).also { it[0] = 99; it[it.size - 1] = 42 }
    origin.etag = "\"v2\""
    origin.throttle = { null }
    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    assertFalse(PartsCheckpoint.fileFor(part()).exists())
  }

  @Test fun aFullDiskIsAStorageErrorNotANetworkOne() {
    val failing: (File) -> PartWriter = { file ->
      val real = PartWriter.FILE(file)
      object : PartWriter by real {
        private val written = java.util.concurrent.atomic.AtomicLong()
        override fun write(position: Long, bytes: ByteArray, offset: Int, length: Int) {
          if (written.addAndGet(length.toLong()) > 2 * 1024 * 1024) {
            throw StorageWriteException(IOException("write failed: ENOSPC (No space left on device)"))
          }
          real.write(position, bytes, offset, length)
        }
      }
    }
    val error = assertThrows(StorageWriteException::class.java) {
      runBlocking { ProgressiveTransfer(http, writerFor = failing, retryDelay = noDelay).transfer(spec(3)) }
    }
    assertTrue(error.message!!.contains("ENOSPC"))
    assertTrue("what was written stays for a retry", PartsCheckpoint.read(part())!!.bytesDone > 0)
  }

  @Test fun aSinglePartialFromAnOlderVersionIsContinuedInParallel() = runBlocking {
    // A one-connection `.part` (e.g. paused on the test1 build): 1 MiB on disk, its validator beside it.
    part().writeBytes(origin.bytes.copyOfRange(0, 1024 * 1024))
    ResumeValidator.write(part(), "\"v1\"")

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    assertEquals("bytes=1048576-", requests[0].getHeader("Range"))
    assertEquals("\"v1\"", requests[0].getHeader("If-Range"))
    assertTrue("the old bytes were never fetched again", ranges().none { it.substringAfter('=').substringBefore('-').toLong() < 1024 * 1024 })
  }

  @Test fun fewerConnectionsAfterAPauseStillResumeEveryPart() = runBlocking {
    origin.throttle = { 16 * 1024 }
    val job = launch(Dispatchers.IO) { ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(4)) }
    withTimeout(20_000) { while ((PartsCheckpoint.read(part())?.parts?.count { it.done > 0 } ?: 0) < 4) delay(50) }
    job.cancelAndJoin()
    origin.throttle = { null }

    // The user lowered "Connections per file" to 1 meanwhile: the same parts, one at a time, nothing lost.
    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(1))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
  }

  @Test fun aCheckpointThatNoLongerDescribesTheFileKeepsOnlyItsProvenPrefix() = runBlocking {
    // A crash after the checkpoint was written but before the file was sized: 2 MiB on disk.
    part().writeBytes(origin.bytes.copyOfRange(0, 2 * 1024 * 1024))
    ResumeValidator.write(part(), "\"v1\"")
    PartsCheckpoint.write(part(), PartsCheckpoint(MB17.toLong(), "\"v1\"", RangedDownload.plan(2L * 1024 * 1024, MB17.toLong(), 3)))

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(3))

    assertEquals(sha256(origin.bytes), sha256(part().readBytes()))
    assertEquals("bytes=2097152-", requests[0].getHeader("Range"))
  }

  @Test fun planCoversTheFileExactlyOnce() {
    val parts = RangedDownload.plan(from = 1000, total = 100_003, connections = 3)
    assertEquals(PartsCheckpoint.Part(0, 999, 1000), parts[0])
    var next = 1000L
    for (p in parts.drop(1)) {
      assertEquals(next, p.start)
      assertEquals(0L, p.done)
      next = p.end + 1
    }
    assertEquals(100_003L, next)
    assertEquals(4, parts.size)
  }

  @Test fun theContiguousPrefixStopsAtTheFirstGap() {
    val cp = PartsCheckpoint(
      100,
      "\"v\"",
      listOf(PartsCheckpoint.Part(0, 39, 40), PartsCheckpoint.Part(40, 69, 10), PartsCheckpoint.Part(70, 99, 30)),
    )
    assertEquals(50L, cp.contiguousPrefix)
    assertEquals(80L, cp.bytesDone)
  }

  private companion object {
    const val MB17 = 17 * 1024 * 1024 + 123
  }
}
