package com.vidorax.media.analyze

import com.vidorax.media.net.CookieSource
import com.vidorax.media.net.UrlPolicy
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import okio.GzipSink
import okio.buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PageFetcherTest {
  private lateinit var server: MockWebServer
  private val stored = mutableListOf<Pair<String, String>>()
  private var flushed = 0
  private val sink = object : CookieSink {
    override fun store(url: String, setCookieHeader: String) {
      stored += url to setCookieHeader
    }

    override fun flush() {
      flushed += 1
    }
  }

  @Before fun setUp() { server = MockWebServer().apply { start() } }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun fetcher(
    policy: UrlPolicy = UrlPolicy.ALLOW_ALL,
    session: CookieSource = CookieSource { null },
  ) = PageFetcher(
    OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS).build(),
    policy = policy,
    cookies = session,
    sink = sink,
    defaultUserAgent = { "StockWebView/1.0 Mobile" },
    acceptLanguage = { "ur-PK,ur;q=0.9,en;q=0.8" },
  )

  private fun request(path: String, configure: PageFetchRequest.() -> PageFetchRequest = { this }) =
    PageFetchRequest(url = server.url(path).toString(), timeoutMs = 4_000).configure()

  private val html = "<!doctype html><html><head><meta property=\"og:video\" content=\"https://cdn.example/v.mp4\"></head></html>"

  @Test
  fun fetchesAPageAsTheTabsNavigation() {
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html; charset=utf-8").setBody(html))

    val result = fetcher().fetch(request("/reel/abc/"))

    result as PageFetchResult.Document
    assertEquals(html, result.body)
    assertEquals(200, result.status)
    assertEquals("text/html", result.contentType)
    assertFalse(result.truncated)
    assertEquals(0, result.redirects)
    val recorded = server.takeRequest()
    assertEquals("GET", recorded.method)
    assertEquals("StockWebView/1.0 Mobile", recorded.getHeader("User-Agent"))
    assertEquals("navigate", recorded.getHeader("Sec-Fetch-Mode"))
    assertEquals("document", recorded.getHeader("Sec-Fetch-Dest"))
    assertEquals("ur-PK,ur;q=0.9,en;q=0.8", recorded.getHeader("Accept-Language"))
    assertTrue(recorded.getHeader("Accept")!!.startsWith("text/html"))
    assertNull("no cookies to send", recorded.getHeader("Cookie"))
  }

  @Test
  fun explicitUserAgentWinsOverTheStockOne() {
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody(html))
    fetcher().fetch(request("/p") { copy(userAgent = "Desktop/2.0") })
    assertEquals("Desktop/2.0", server.takeRequest().getHeader("User-Agent"))
  }

  @Test
  fun followsRedirectsAndReportsTheFinalUrl() {
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/step2"))
    server.enqueue(MockResponse().setResponseCode(301).setHeader("Location", server.url("/final?x=1").toString()))
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody(html))

    val result = fetcher().fetch(request("/short"))

    result as PageFetchResult.Document
    assertEquals(server.url("/final?x=1").toString(), result.finalUrl)
    assertEquals(2, result.redirects)
    assertEquals(3, server.requestCount)
  }

  @Test
  fun aRedirectLoopIsReportedNotFollowedForever() {
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/b"))
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/a"))

    val result = fetcher().fetch(request("/a"))

    assertEquals(PageFetchFailure.REDIRECT_LOOP, (result as PageFetchResult.Failure).code)
    assertEquals(2, server.requestCount)
  }

  @Test
  fun tooManyRedirectsStopAtTheBound() {
    repeat(PageFetcher.MAX_REDIRECTS + 1) { i ->
      server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/hop${i + 1}"))
    }

    val result = fetcher().fetch(request("/hop0"))

    assertEquals(PageFetchFailure.TOO_MANY_REDIRECTS, (result as PageFetchResult.Failure).code)
    assertEquals(PageFetcher.MAX_REDIRECTS + 1, server.requestCount)
  }

  @Test
  fun aRedirectIntoAForbiddenAddressIsRefusedBeforeConnecting() {
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/internal/admin"))
    val policy = UrlPolicy { !it.encodedPath.startsWith("/internal") }

    val result = fetcher(policy = policy).fetch(request("/public"))

    assertEquals(PageFetchFailure.UNSAFE_URL, (result as PageFetchResult.Failure).code)
    assertEquals("the forbidden hop is never requested", 1, server.requestCount)
  }

  @Test
  fun thePublicOnlyPolicyRefusesLoopbackOutright() {
    val result = PageFetcher(OkHttpClient(), sink = sink).fetch(request("/x"))
    assertEquals(PageFetchFailure.UNSAFE_URL, (result as PageFetchResult.Failure).code)
    assertEquals(0, server.requestCount)
  }

  @Test
  fun youTubeIsRefusedByPolicyWithoutAnyRequest() {
    val result = fetcher().fetch(PageFetchRequest(url = "https://m.youtube.com/watch?v=abc"))
    assertEquals(PageFetchFailure.POLICY_BLOCKED, (result as PageFetchResult.Failure).code)
  }

  @Test
  fun anUnparseableUrlIsInvalid() {
    val result = fetcher().fetch(PageFetchRequest(url = "ftp://example.com/v.mp4"))
    assertEquals(PageFetchFailure.INVALID_URL, (result as PageFetchResult.Failure).code)
  }

  @Test
  fun aSlowServerTimesOutWithinTheDeadline() {
    server.enqueue(MockResponse().setHeadersDelay(3, TimeUnit.SECONDS).setBody(html))

    val started = System.currentTimeMillis()
    val result = fetcher().fetch(request("/slow") { copy(timeoutMs = 1_000) })

    assertEquals(PageFetchFailure.TIMEOUT, (result as PageFetchResult.Failure).code)
    assertTrue("bounded by the deadline", System.currentTimeMillis() - started < 2_500)
  }

  @Test
  fun serverErrorsKeepTheirStatus() {
    server.enqueue(MockResponse().setResponseCode(503).setBody("busy"))
    val result = fetcher().fetch(request("/p")) as PageFetchResult.Failure
    assertEquals(PageFetchFailure.HTTP_ERROR, result.code)
    assertEquals(503, result.status)

    server.enqueue(MockResponse().setResponseCode(404).setBody("gone"))
    assertEquals(404, (fetcher().fetch(request("/q")) as PageFetchResult.Failure).status)
  }

  @Test
  fun aPastedMediaFileIsRecognisedWithoutReadingIt() {
    val mp4 = Buffer().write(byteArrayOf(0, 0, 0, 0x18) + "ftypisom".toByteArray() + ByteArray(200_000))
    server.enqueue(MockResponse().setHeader("Content-Type", "application/octet-stream").setBody(mp4))

    val result = fetcher().fetch(request("/file"))

    result as PageFetchResult.Media
    assertEquals("application/octet-stream", result.contentType)
    assertEquals(200_012L, result.contentLength)
  }

  @Test
  fun manifestsAndVideoTypesAreMedia() {
    server.enqueue(MockResponse().setHeader("Content-Type", "text/plain").setBody("#EXTM3U\n#EXT-X-VERSION:3\n"))
    assertTrue(fetcher().fetch(request("/a")) is PageFetchResult.Media)

    val mpd = "<?xml version=\"1.0\"?><MPD xmlns=\"urn:mpeg:dash:schema:mpd:2011\" type=\"static\"></MPD>"
    server.enqueue(MockResponse().setHeader("Content-Type", "application/xml").setBody(mpd))
    assertTrue(fetcher().fetch(request("/b")) is PageFetchResult.Media)

    server.enqueue(MockResponse().setHeader("Content-Type", "video/webm").setBody("x".repeat(64)))
    assertTrue(fetcher().fetch(request("/c")) is PageFetchResult.Media)
  }

  @Test
  fun nonPageNonMediaResponsesAreUnsupported() {
    server.enqueue(MockResponse().setHeader("Content-Type", "image/png").setBody("\u0089PNG...."))
    val result = fetcher().fetch(request("/img"))
    assertEquals(PageFetchFailure.UNSUPPORTED_CONTENT, (result as PageFetchResult.Failure).code)
  }

  @Test
  fun anUntypedHtmlBodyIsStillAPage() {
    server.enqueue(MockResponse().removeHeader("Content-Type").setBody("<html><body>hi</body></html>"))
    assertTrue(fetcher().fetch(request("/untyped")) is PageFetchResult.Document)
  }

  @Test
  fun theBodyIsBoundedAndMarkedTruncated() {
    val big = "<html>" + "a".repeat(100_000)
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody(big))

    val result = fetcher().fetch(request("/big") { copy(maxBytes = 20_000) }) as PageFetchResult.Document

    assertTrue(result.truncated)
    assertEquals(20_000, result.body.length)
  }

  @Test
  fun gzipPagesAreInflated() {
    val compressed = Buffer()
    GzipSink(compressed).buffer().use { it.writeUtf8(html) }
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setHeader("Content-Encoding", "gzip").setBody(compressed))

    val result = fetcher().fetch(request("/gz")) as PageFetchResult.Document

    assertEquals(html, result.body)
    assertEquals("gzip", server.takeRequest().getHeader("Accept-Encoding"))
  }

  @Test
  fun theDeclaredCharsetIsUsed() {
    server.enqueue(
      MockResponse().setHeader("Content-Type", "text/html; charset=ISO-8859-1")
        .setBody(Buffer().write("<p>café</p>".toByteArray(Charsets.ISO_8859_1))),
    )
    assertEquals("<p>café</p>", (fetcher().fetch(request("/latin1")) as PageFetchResult.Document).body)
  }

  @Test
  fun cookiesSetDuringTheFetchAreReplayedToLaterHopsAndSessionCookiesAreSent() {
    server.enqueue(
      MockResponse().setResponseCode(302).setHeader("Location", "/page").setHeader("Set-Cookie", "hop=1; Path=/"),
    )
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody(html))

    fetcher(session = CookieSource { "sid=abc" }).fetch(request("/start"))

    assertEquals("sid=abc", server.takeRequest().getHeader("Cookie"))
    assertEquals("sid=abc; hop=1", server.takeRequest().getHeader("Cookie"))
  }

  @Test
  fun withoutTheSessionOnlyTheFetchsOwnCookiesAreSent() {
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/page").setHeader("Set-Cookie", "hop=1"))
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody(html))

    fetcher(session = CookieSource { "sid=abc" }).fetch(request("/start") { copy(useSessionCookies = false) })

    assertNull(server.takeRequest().getHeader("Cookie"))
    assertEquals("hop=1", server.takeRequest().getHeader("Cookie"))
  }

  @Test
  fun setCookiesAreCommittedToTheBrowserJarOnlyAfterASuccessfulFetchWhenAsked() {
    server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/page").setHeader("Set-Cookie", "a=1"))
    server.enqueue(
      MockResponse().setHeader("Content-Type", "text/html").setHeader("Set-Cookie", "tt_chain_token=T; Path=/; HttpOnly")
        .setBody(html),
    )

    fetcher().fetch(request("/start") { copy(commitCookies = true) })

    assertEquals(listOf("a=1", "tt_chain_token=T; Path=/; HttpOnly"), stored.map { it.second })
    assertEquals(server.url("/start").toString(), stored[0].first)
    assertEquals(server.url("/page").toString(), stored[1].first)
    assertEquals(1, flushed)
  }

  @Test
  fun nothingIsCommittedWhenNotAskedOrWhenTheFetchFails() {
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setHeader("Set-Cookie", "a=1").setBody(html))
    fetcher().fetch(request("/p"))
    assertTrue(stored.isEmpty())

    server.enqueue(MockResponse().setResponseCode(500).setHeader("Set-Cookie", "b=1"))
    fetcher().fetch(request("/q") { copy(commitCookies = true) })
    assertTrue(stored.isEmpty())
    assertEquals(0, flushed)
  }

  @Test
  fun acceptLanguageFollowsTheDeviceLocales() {
    assertEquals("ur-PK,ur;q=0.9,en;q=0.8", BrowserIdentity.acceptLanguage(listOf("ur-PK")))
    assertEquals("en-US,en;q=0.9", BrowserIdentity.acceptLanguage(listOf("en-US")))
    assertEquals("en", BrowserIdentity.acceptLanguage(emptyList()))
  }

  @Test
  fun contentClassifierRecognisesContainersByTheirBytes() {
    val webm = byteArrayOf(0x1A, 0x45, 0xDF.toByte(), 0xA3.toByte()) + ByteArray(20)
    assertEquals(ContentClass.MEDIA, ContentClassifier.classify(null, webm))
    assertEquals(ContentClass.MEDIA, ContentClassifier.classify("text/plain", "#EXTM3U\n".toByteArray()))
    assertEquals(ContentClass.DOCUMENT, ContentClassifier.classify("application/json", "{\"a\":1}".toByteArray()))
    assertEquals(
      "XHTML that merely starts with an XML declaration is a page",
      ContentClass.DOCUMENT,
      ContentClassifier.classify("application/xhtml+xml", "<?xml version=\"1.0\"?><html></html>".toByteArray()),
    )
    assertEquals(ContentClass.OTHER, ContentClassifier.classify("application/zip", "PK\u0003\u0004".toByteArray()))
  }
}
