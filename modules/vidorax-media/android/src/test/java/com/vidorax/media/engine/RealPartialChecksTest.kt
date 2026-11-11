package com.vidorax.media.engine

import com.vidorax.media.model.RequestContext
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.plan.HlsSegmentRef
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** H20 Repair: the real requests — a ranged, If-Range tail and a segment — against a server. */
class RealPartialChecksTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var server: MockWebServer
  private val checks = RealPartialChecks(HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL))
  private val context = RequestContext(null, null, null, emptyMap(), useCookies = false)
  private val file = ByteArray(10_000) { (it % 97).toByte() }

  @Before fun setUp() { server = MockWebServer().apply { start() } }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun partial(start: Int, end: Int, total: Int = file.size, etag: String = "\"v1\"") = MockResponse()
    .setResponseCode(206)
    .setHeader("ETag", etag)
    .setHeader("Content-Range", "bytes $start-$end/$total")
    .setBody(Buffer().write(file.copyOfRange(start, end + 1)))

  @Test fun theTailIsAskedWithRangeAndIfRangeAndCompared() = runBlocking {
    server.enqueue(partial(4_000, 4_999))
    val answer = checks.tail(server.url("/v.mp4").toString(), context, 4_000, 1_000, "\"v1\"", file.copyOfRange(4_000, 5_000))
    val request = server.takeRequest()
    assertEquals("bytes=4000-4999", request.getHeader("Range"))
    assertEquals("\"v1\"", request.getHeader("If-Range"))
    assertEquals(PartialRepair.TailAnswer(206, 4_000, 10_000, "\"v1\"", bytesMatch = true), answer)
    assertEquals(PartialRepair.Verdict.VALID, PartialRepair.decideWhole(5_000, 4_000, "\"v1\"", answer))
  }

  @Test fun otherBytesAtThePlaceAreAMismatch() = runBlocking {
    server.enqueue(partial(4_000, 4_999))
    val local = ByteArray(1_000) { 1 }
    val answer = checks.tail(server.url("/v.mp4").toString(), context, 4_000, 1_000, "\"v1\"", local)
    assertEquals(false, answer.bytesMatch)
    assertEquals(PartialRepair.Verdict.CORRUPT, PartialRepair.decideWhole(5_000, 4_000, "\"v1\"", answer))
  }

  @Test fun aWholeNewFileIsNotReadOnlyItsAnswerCounts() = runBlocking {
    server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v2\"").setBody(Buffer().write(file)))
    val answer = checks.tail(server.url("/v.mp4").toString(), context, 4_000, 1_000, "\"v1\"", ByteArray(1_000))
    assertEquals(200, answer.status)
    assertNull(answer.bytesMatch)
    assertEquals(PartialRepair.Verdict.CHANGED, PartialRepair.decideWhole(5_000, 4_000, "\"v1\"", answer))
  }

  @Test fun noServerIsUnreachable() = runBlocking {
    server.shutdown()
    val answer = checks.tail("http://127.0.0.1:${server.port}/v.mp4", context, 0, 10, null, ByteArray(10))
    assertNull(answer.status)
  }

  @Test fun aSegmentIsFetchedWholeOrAsItsByteRange() = runBlocking {
    server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(file.copyOfRange(0, 3_000))))
    val whole = tmp.newFile("whole")
    assertEquals(3_000L, checks.segment(HlsSegmentRef(server.url("/s0.ts").toString()), context, whole, 1_000_000))
    assertArrayEquals(file.copyOfRange(0, 3_000), whole.readBytes())

    server.enqueue(partial(2_000, 2_499))
    val ranged = tmp.newFile("ranged")
    val ref = HlsSegmentRef(server.url("/all.ts").toString(), byteRangeOffset = 2_000, byteRangeLength = 500)
    assertEquals(500L, checks.segment(ref, context, ranged, 1_000_000))
    server.takeRequest()
    assertEquals("bytes=2000-2499", server.takeRequest().getHeader("Range"))

    server.enqueue(MockResponse().setResponseCode(404))
    assertNull(checks.segment(HlsSegmentRef(server.url("/gone.ts").toString()), context, tmp.newFile("gone"), 1_000_000))

    server.enqueue(MockResponse().setResponseCode(200).setBody(Buffer().write(file)))
    assertNull("too large to compare", checks.segment(HlsSegmentRef(server.url("/big.ts").toString()), context, tmp.newFile("big"), 100))
  }
}
