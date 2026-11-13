package com.vidorax.media.net

import com.vidorax.media.engine.RequestContextJson
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
import java.util.concurrent.TimeUnit

/**
 * B11 — a download started in an incognito tab carries that session's cookies, never the active profile's
 * (ActiveWebCookies); every other download is exactly as before.
 */
class IncognitoCookiesTest {
  private lateinit var server: MockWebServer

  /** Two jars: the active profile's and the incognito session's. */
  private val source = object : CookieSource {
    override fun cookiesFor(url: String): String = "normal=1"

    override fun cookiesFor(url: String, profile: String?): String? = when (profile) {
      null -> cookiesFor(url)
      "vidorax-incoga1" -> "incognito=1"
      else -> null
    }
  }

  @Before fun start() {
    server = MockWebServer()
    server.start()
  }

  @After fun stop() {
    server.shutdown()
  }

  private fun send(source: CookieSource, context: RequestContext): String? {
    val client = HttpClient(
      OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .addNetworkInterceptor(SessionCookieInterceptor(source))
        .build(),
      UrlPolicy.ALLOW_ALL,
    )
    server.enqueue(MockResponse().setBody("x"))
    client.execute(MediaRequest(url = server.url("/clip.mp4").toString(), context = context)).close()
    val sent = server.takeRequest()
    assertNull("the marker never leaves the app", sent.getHeader(SessionCookieInterceptor.MARKER))
    return sent.getHeader("Cookie")
  }

  private fun context(profile: String?) =
    RequestContext("VidoraX/1", null, null, emptyMap(), useCookies = true, cookieProfile = profile)

  @Test fun anIncognitoDownloadUsesTheIncognitoJar() {
    assertEquals("incognito=1", send(source, context("vidorax-incoga1")))
  }

  @Test fun aNormalDownloadIsUnchanged() {
    assertEquals("normal=1", send(source, context(null)))
  }

  @Test fun anEndedOrUnknownSessionSendsNothingNeverTheActiveJar() {
    assertNull(send(source, context("vidorax-incogold")))
    // A source that knows no incognito jars (the default method) sends nothing either.
    assertNull(send(CookieSource { "normal=1" }, context("vidorax-incoga1")))
  }

  @Test fun theSessionNameIsKeptWithTheDownloadButNeverACookieAndOnlyIncognitoNames() {
    val stored = RequestContextJson.encode(context("vidorax-incoga1"))
    assertTrue(stored.contains("vidorax-incoga1"))
    assertFalse(stored.contains("incognito=1"))
    assertEquals("vidorax-incoga1", RequestContextJson.decode(stored).cookieProfile)
    assertNull(RequestContextJson.decode("""{"useCookies":true,"cookieProfile":"vidorax-abc"}""").cookieProfile)
    assertNull(RequestContextJson.decode("""{"useCookies":true}""").cookieProfile)
  }

  @Test fun onlyTheLiveSessionHasAJar() {
    assertFalse(IncognitoWebCookies.use("vidorax-abc") { null })
    assertTrue(IncognitoWebCookies.use(null))
    assertNull(IncognitoWebCookies.jarFor("vidorax-incoga1"))
  }
}
