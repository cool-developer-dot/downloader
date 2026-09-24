package com.vidorax.media.net

import com.vidorax.media.model.RequestContext
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class HttpClientTest {
  private lateinit var server: MockWebServer
  private val http = HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL)

  @Before fun setUp() { server = MockWebServer().apply { start() } }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun context(headers: Map<String, String> = emptyMap()) = RequestContext(
    userAgent = "VidoraX-UA",
    referer = "https://page.example/watch",
    origin = "https://page.example",
    headers = headers,
    useCookies = false,
  )

  @Test
  fun appliesContextRangeAndIdentityEncodingAndNeverSendsCookie() {
    server.enqueue(MockResponse().setResponseCode(206).setBody("partial"))

    http.execute(
      MediaRequest(
        url = server.url("/v.mp4").toString(),
        context = context(mapOf("X-Extra" to "1", "Cookie" to "sid=SECRET")),
        rangeStart = 100,
        ifRange = "\"etag-1\"",
      ),
    ).use { it.readPrefix(16) }

    val recorded = server.takeRequest()
    assertEquals("bytes=100-", recorded.getHeader("Range"))
    assertEquals("\"etag-1\"", recorded.getHeader("If-Range"))
    assertEquals("identity", recorded.getHeader("Accept-Encoding"))
    assertEquals("VidoraX-UA", recorded.getHeader("User-Agent"))
    assertEquals("https://page.example/watch", recorded.getHeader("Referer"))
    assertEquals("1", recorded.getHeader("X-Extra"))
    assertNull("Cookie must never be sent from context headers", recorded.getHeader("Cookie"))
  }

  @Test
  fun omitsRangeHeaderWhenNoOffset() {
    server.enqueue(MockResponse().setResponseCode(200).setBody("full"))
    http.execute(MediaRequest(server.url("/v.mp4").toString(), context())).use { it.readPrefix(4) }
    assertNull(server.takeRequest().getHeader("Range"))
  }

  @Test
  fun parses206RangeMetadata() {
    server.enqueue(
      MockResponse()
        .setResponseCode(206)
        .setHeader("Content-Type", "video/mp4; charset=binary")
        .setHeader("Content-Range", "bytes 0-6/1000")
        .setBody("abcdefg"),
    )
    http.execute(MediaRequest(server.url("/v.mp4").toString(), context(), rangeStart = 0)).use {
      assertEquals(206, it.status)
      assertEquals("video/mp4", it.contentType)
      assertEquals(ContentRange(0, 6, 1000), it.contentRange)
      assertTrue(it.supportsRanges)
    }
  }

  @Test
  fun supportsRangesReflectsAcceptRangesOn200() {
    server.enqueue(MockResponse().setResponseCode(200).setHeader("Accept-Ranges", "bytes").setBody("x"))
    http.execute(MediaRequest(server.url("/a").toString(), context())).use { assertTrue(it.supportsRanges) }

    server.enqueue(MockResponse().setResponseCode(200).setHeader("Accept-Ranges", "none").setBody("x"))
    http.execute(MediaRequest(server.url("/b").toString(), context())).use { assertFalse(it.supportsRanges) }
  }

  @Test
  fun readPrefixIsBounded() {
    val body = Buffer().write(ByteArray(1000) { 'a'.code.toByte() })
    server.enqueue(MockResponse().setResponseCode(200).setBody(body))
    http.execute(MediaRequest(server.url("/big").toString(), context())).use {
      assertEquals(100, it.readPrefix(100).size)
    }
  }

  @Test
  fun connectionFailureIsTransientNetworkException() {
    val url = server.url("/gone").toString()
    server.shutdown() // nothing is listening now
    assertThrows(MediaNetworkException::class.java) {
      http.execute(MediaRequest(url, context())).use { it.readPrefix(1) }
    }
  }

  @Test
  fun boundedRangeSendsTheInclusiveEnd() {
    server.enqueue(MockResponse().setResponseCode(206).setBody("x"))
    http.execute(MediaRequest(server.url("/seg.ts").toString(), context(), rangeStart = 100, rangeEnd = 199)).close()
    assertEquals("bytes=100-199", server.takeRequest().getHeader("Range"))
  }

  @Test
  fun followsRedirectsKeepingTheContextAndReportsTheFinalUrl() {
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/cdn/v.mp4?sig=1"))
    server.enqueue(MockResponse().setResponseCode(200).setBody("x"))
    http.execute(MediaRequest(server.url("/v.mp4").toString(), context(), rangeStart = 0)).use {
      assertEquals(200, it.status)
      assertTrue(it.finalUrl.endsWith("/cdn/v.mp4?sig=1"))
      assertEquals(1, it.redirects)
    }
    server.takeRequest()
    val hop = server.takeRequest()
    assertEquals("the second hop keeps the range", "bytes=0-", hop.getHeader("Range"))
    assertEquals("https://page.example/watch", hop.getHeader("Referer"))
    assertEquals("VidoraX-UA", hop.getHeader("User-Agent"))
  }

  @Test
  fun aRedirectIntoThePrivateNetworkIsRefusedBeforeAnyConnection() {
    // Production policy, except that the test server itself (on loopback) stands in for a public host.
    val guarded = HttpClient.create(urlPolicy = UrlPolicy { it.port == server.port || UrlPolicy.PUBLIC_ONLY.allows(it) })
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "http://192.168.1.1/admin"))
    val refused = assertThrows(MediaRefusedException::class.java) {
      guarded.execute(MediaRequest(server.url("/v.mp4").toString(), context())).close()
    }
    assertEquals(com.vidorax.media.model.ProbeFailure.POLICY_BLOCKED, refused.reason)
    assertFalse("never retried as a network error", MediaNetworkException::class.java.isInstance(refused))
    assertEquals(1, server.requestCount)
  }

  @Test
  fun aNonPublicFirstUrlIsRefusedWithoutARequest() {
    val guarded = HttpClient.create()
    assertThrows(MediaRefusedException::class.java) {
      guarded.execute(MediaRequest(server.url("/v.mp4").toString(), context())).close()
    }
    assertEquals(0, server.requestCount)
  }

  @Test
  fun aRedirectLoopIsAPermanentRefusalNotATransientError() {
    repeat(HttpClient.MAX_REDIRECTS + 2) {
      server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/loop"))
    }
    val refused = assertThrows(MediaRefusedException::class.java) {
      http.execute(MediaRequest(server.url("/loop").toString(), context())).close()
    }
    assertEquals(com.vidorax.media.model.ProbeFailure.NOT_MEDIA, refused.reason)
    assertEquals(HttpClient.MAX_REDIRECTS + 1, server.requestCount)
  }

  @Test
  fun cookiesTheServerSetsDuringTheDownloadAreSentBackToIt() {
    val client = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)
    server.enqueue(
      MockResponse().setResponseCode(302).setHeader("Set-Cookie", "hdntl=tok1; Path=/").setHeader("Location", "/seg1.ts"),
    )
    server.enqueue(MockResponse().setResponseCode(200).setBody("x"))
    server.enqueue(MockResponse().setResponseCode(200).setBody("y"))

    client.execute(MediaRequest(server.url("/master.m3u8").toString(), context())).close()
    client.execute(MediaRequest(server.url("/seg2.ts").toString(), context())).close()

    assertNull(server.takeRequest().getHeader("Cookie"))
    assertEquals("the redirect's cookie reaches the next hop", "hdntl=tok1", server.takeRequest().getHeader("Cookie"))
    assertEquals("and later requests of the same download", "hdntl=tok1", server.takeRequest().getHeader("Cookie"))
  }

  @Test
  fun serverCookiesMergeWithTheBrowsingSessionAndWinOnTheSameName() {
    val client = HttpClient.create(cookies = { "sid=browser; tok=old" }, urlPolicy = UrlPolicy.ALLOW_ALL)
    server.enqueue(MockResponse().setResponseCode(200).setHeader("Set-Cookie", "tok=new; Path=/").setBody("x"))
    server.enqueue(MockResponse().setResponseCode(200).setBody("y"))
    val session = context().copy(useCookies = true)

    client.execute(MediaRequest(server.url("/a").toString(), session)).close()
    client.execute(MediaRequest(server.url("/b").toString(), session)).close()

    assertEquals("sid=browser; tok=old", server.takeRequest().getHeader("Cookie"))
    assertEquals("sid=browser; tok=new", server.takeRequest().getHeader("Cookie"))
  }

  @Test
  fun anAuthorizationHeaderFromTheContextIsNeverSent() {
    server.enqueue(MockResponse().setResponseCode(200).setBody("x"))
    http.execute(MediaRequest(server.url("/v.mp4").toString(), context(mapOf("Authorization" to "Bearer SECRET")))).close()
    assertNull(server.takeRequest().getHeader("Authorization"))
  }

  @Test
  fun transientStatusesAreRecognised() {
    assertTrue(MediaHttpException.of(503, "https://cdn.example/v").isTransient)
    assertTrue(MediaHttpException.of(429, "https://cdn.example/v").isTransient)
    assertTrue(MediaHttpException.of(408, "https://cdn.example/v").isTransient)
    assertFalse(MediaHttpException.of(403, "https://cdn.example/v").isTransient)
    assertFalse(MediaHttpException.of(404, "https://cdn.example/v").isTransient)
  }

  @Test
  fun httpExceptionMessageCarriesNoQuerySecret() {
    val message = MediaHttpException.of(403, "https://cdn.example/v.mp4?token=SECRET").message ?: ""
    assertFalse(message.contains("SECRET"))
    assertTrue(message.contains("403"))
  }
}
