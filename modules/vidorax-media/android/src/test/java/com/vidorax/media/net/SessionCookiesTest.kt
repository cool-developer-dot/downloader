package com.vidorax.media.net

import com.vidorax.media.model.RequestContext
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * Phase 11C — session-bound media only answers to the session it was issued to. A download that says it needs
 * cookies must actually carry them; one that does not must never leak the user's session.
 */
class SessionCookiesTest {
  private lateinit var server: MockWebServer

  @Before fun start() {
    server = MockWebServer()
    server.start()
  }

  @After fun stop() {
    server.shutdown()
  }

  private fun clientWith(source: CookieSource): HttpClient =
    HttpClient(
      OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .followRedirects(true)
        .addNetworkInterceptor(SessionCookieInterceptor(source))
        .build(),
      UrlPolicy.ALLOW_ALL,
    )

  private fun context(useCookies: Boolean) =
    RequestContext(
      userAgent = "VidoraX/1",
      referer = "https://www.tiktok.com/foryou",
      origin = null,
      headers = emptyMap(),
      useCookies = useCookies,
    )

  @Test fun aSessionBoundDownloadCarriesTheBrowsingSessionCookies() {
    server.enqueue(MockResponse().setBody("x"))
    val client = clientWith { "tt_chain_token=abc; sessionid=def" }

    client.execute(MediaRequest(url = server.url("/clip.mp4").toString(), context = context(true))).close()

    val sent: RecordedRequest = server.takeRequest()
    assertEquals("tt_chain_token=abc; sessionid=def", sent.getHeader("Cookie"))
    assertNull("the internal marker never leaves the app", sent.getHeader(SessionCookieInterceptor.MARKER))
  }

  @Test fun aPublicDownloadNeverSendsTheUsersSession() {
    server.enqueue(MockResponse().setBody("x"))
    var asked = 0
    val client = clientWith {
      asked += 1
      "sessionid=secret"
    }

    client.execute(MediaRequest(url = server.url("/clip.mp4").toString(), context = context(false))).close()

    val sent = server.takeRequest()
    assertNull(sent.getHeader("Cookie"))
    assertEquals("the cookie jar is not even read for a public download", 0, asked)
  }

  @Test fun anEmptyJarSendsNoCookieHeaderAtAll() {
    server.enqueue(MockResponse().setBody("x"))
    val client = clientWith { null }

    client.execute(MediaRequest(url = server.url("/clip.mp4").toString(), context = context(true))).close()

    assertNull(server.takeRequest().getHeader("Cookie"))
  }

  @Test fun eachRedirectHopGetsTheCookiesForItsOwnHost() {
    server.enqueue(
      MockResponse()
        .setResponseCode(302)
        .setHeader("Location", server.url("/cdn/clip.mp4").toString()),
    )
    server.enqueue(MockResponse().setBody("x"))
    val seen = mutableListOf<String>()
    val client = clientWith { url ->
      seen += url
      if (url.contains("/cdn/")) "cdn=2" else "origin=1"
    }

    client.execute(MediaRequest(url = server.url("/clip.mp4").toString(), context = context(true))).close()

    assertEquals("origin=1", server.takeRequest().getHeader("Cookie"))
    assertEquals("cdn=2", server.takeRequest().getHeader("Cookie"))
    assertEquals("the jar is read once per hop, not once per download", 2, seen.size)
  }

  @Test fun theCookieIsReadAtSendTimeSoARetryPicksUpARefreshedSession() {
    server.enqueue(MockResponse().setResponseCode(403))
    server.enqueue(MockResponse().setBody("x"))
    var value = "stale=1"
    val client = clientWith { value }
    val url = server.url("/clip.mp4").toString()

    client.execute(MediaRequest(url = url, context = context(true))).close()
    value = "fresh=2"
    client.execute(MediaRequest(url = url, context = context(true))).close()

    assertEquals("stale=1", server.takeRequest().getHeader("Cookie"))
    assertEquals("fresh=2", server.takeRequest().getHeader("Cookie"))
  }
}
