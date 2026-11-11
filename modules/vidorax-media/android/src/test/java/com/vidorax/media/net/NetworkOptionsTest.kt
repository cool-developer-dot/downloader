package com.vidorax.media.net

import com.vidorax.media.model.RequestContext
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NetworkOptionsTest {
  private lateinit var server: MockWebServer

  @Before fun setUp() { server = MockWebServer().apply { start() } }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun client(options: NetworkOptions) =
    HttpClient(OkHttpClient.Builder().addInterceptor(NetworkOptionsInterceptor { options }).build(), UrlPolicy.ALLOW_ALL)

  private fun fetch(options: NetworkOptions, context: RequestContext) =
    client(options).execute(MediaRequest(server.url("/v.mp4").toString(), context)).use { it.readPrefix(4) }

  private val pageContext = RequestContext(
    userAgent = "Page-UA",
    referer = "https://page.example/watch",
    origin = null,
    headers = emptyMap(),
    useCookies = false,
  )

  @Test
  fun defaultOptionsLeaveTheRequestExactlyAsBefore() {
    server.enqueue(MockResponse().setBody("full"))
    fetch(NetworkOptions.DEFAULT, pageContext)
    val recorded = server.takeRequest()
    assertEquals("Page-UA", recorded.getHeader("User-Agent"))
    assertEquals("https://page.example/watch", recorded.getHeader("Referer"))
    assertEquals("identity", recorded.getHeader("Accept-Encoding"))
    assertTrue(NetworkOptions.DEFAULT.isDefault)
  }

  @Test
  fun customUserAgentReplacesThePagesOne() {
    server.enqueue(MockResponse().setBody("full"))
    fetch(NetworkOptions(userAgent = "Custom/1.0"), pageContext)
    assertEquals("Custom/1.0", server.takeRequest().getHeader("User-Agent"))
  }

  @Test
  fun customHeadersAreAddedButNeverReplaceThePagesHeaders() {
    server.enqueue(MockResponse().setBody("full"))
    fetch(NetworkOptions(headers = listOf("X-Api-Key" to "k1", "Referer" to "https://other.example/")), pageContext)
    val recorded = server.takeRequest()
    assertEquals("k1", recorded.getHeader("X-Api-Key"))
    assertEquals("https://page.example/watch", recorded.getHeader("Referer"))
  }

  @Test
  fun refusedNamesAndUnsafeValuesNeverReachTheRequest() {
    val options = NetworkOptions.fromJs(
      userAgent = "Bad\r\nInjected: 1",
      headers = mapOf(
        "Cookie" to "sid=1",
        "authorization" to "Bearer x",
        "Host" to "evil.example",
        "Range" to "bytes=0-",
        "Proxy-Authorization" to "x",
        "Sec-Fetch-Mode" to "cors",
        "X-Vidorax-Session" to "1",
        "Accept-Encoding" to "gzip",
        "Bad Name" to "x",
        "X-Line" to "a\r\nb",
        "X-Urdu" to "ویڈیو",
        "X-Ok" to "fine",
      ),
      connectTimeoutSeconds = null,
      readTimeoutSeconds = null,
    )
    assertNull(options.userAgent)
    assertEquals(listOf("X-Ok" to "fine"), options.headers)
  }

  @Test
  fun headerCountIsCappedAndDuplicatesIgnoringCaseAreDropped() {
    val many = (1..20).associate { "X-H$it" to "v$it" } + mapOf("x-h1" to "dup")
    val options = NetworkOptions.fromJs(null, many, null, null)
    assertEquals(NetworkOptions.MAX_HEADERS, options.headers.size)
    assertEquals(1, options.headers.count { it.first.equals("x-h1", ignoreCase = true) })
  }

  @Test
  fun timeoutsAreClampedAndUnsentMeansTodaysTimeouts() {
    val clamped = NetworkOptions.fromJs(null, null, 1, 10_000)
    assertEquals(NetworkOptions.MIN_TIMEOUT_SECONDS, clamped.connectTimeoutSeconds)
    assertEquals(NetworkOptions.MAX_TIMEOUT_SECONDS, clamped.readTimeoutSeconds)
    val unsent = NetworkOptions.fromJs(null, null, null, null)
    assertTrue(unsent.isDefault)
  }

  @Test
  fun customTimeoutsStillReachTheServer() {
    server.enqueue(MockResponse().setBody("full"))
    fetch(NetworkOptions(connectTimeoutSeconds = 15, readTimeoutSeconds = 60), pageContext)
    assertEquals("/v.mp4", server.takeRequest().path)
  }

  @Test
  fun headerNameRules() {
    assertTrue(NetworkOptions.isAllowedHeaderName("X-Requested-With"))
    assertFalse(NetworkOptions.isAllowedHeaderName("TE"))
    assertFalse(NetworkOptions.isAllowedHeaderName("transfer-encoding"))
    assertFalse(NetworkOptions.isAllowedHeaderName("Upgrade"))
    assertFalse(NetworkOptions.isAllowedHeaderName("Connection"))
    assertFalse(NetworkOptions.isAllowedHeaderName("If-Range"))
    assertFalse(NetworkOptions.isAllowedHeaderName("Content-Length"))
    assertFalse(NetworkOptions.isAllowedHeaderName(""))
    assertFalse(NetworkOptions.isAllowedHeaderName("X:Y"))
  }
}
