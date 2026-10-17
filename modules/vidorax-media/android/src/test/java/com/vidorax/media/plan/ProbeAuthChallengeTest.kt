package com.vidorax.media.plan

import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** #299: the probe reports a Basic challenge on a 401 — the verdict itself is unchanged (HTTP_403, status 401). */
@RunWith(RobolectricTestRunner::class)
class ProbeAuthChallengeTest {
  private lateinit var server: MockWebServer
  private val probe = Probe(HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL))
  private val context = RequestContext(null, null, null, emptyMap(), useCookies = false)

  @Before fun setUp() { server = MockWebServer().apply { start() } }

  @After fun tearDown() { runCatching { server.shutdown() } }

  private fun unauthorized(challenge: String?) = MockResponse().setResponseCode(401).apply {
    if (challenge != null) setHeader("WWW-Authenticate", challenge)
  }

  @Test fun aFileThatAsksForBasicSignInSaysSo() = runBlocking {
    server.enqueue(unauthorized("Basic realm=\"Home NAS\""))
    val result = probe.probe(ProbeRequest(server.url("/v.mp4").toString(), null, null, context)) as ProbeResult.Failure
    assertEquals(ProbeFailure.HTTP_403, result.reason)
    assertEquals(401, result.httpStatus)
    assertEquals("Home NAS", result.authChallenge?.realm)
    assertEquals("http://${server.hostName}:${server.port}", result.authChallenge?.origin)
    assertEquals("no extra request for a file", 1, server.requestCount)
  }

  @Test fun anotherSchemeOrA403IsNoChallenge() = runBlocking {
    server.enqueue(unauthorized("Bearer realm=\"api\""))
    val bearer = probe.probe(ProbeRequest(server.url("/a.mp4").toString(), null, null, context)) as ProbeResult.Failure
    assertNull(bearer.authChallenge)
    assertEquals("a file is never asked twice", 1, server.requestCount)

    server.enqueue(MockResponse().setResponseCode(403))
    val forbidden = probe.probe(ProbeRequest(server.url("/b.mp4").toString(), null, null, context)) as ProbeResult.Failure
    assertEquals(403, forbidden.httpStatus)
    assertNull(forbidden.authChallenge)
  }

  @Test fun aPlaylistRefusedWith401IsAskedOnceMoreForItsChallenge() = runBlocking {
    // The HLS planner's own fetch reports no header; one plain request reads it.
    server.enqueue(unauthorized("Basic realm=\"streams\""))
    server.enqueue(unauthorized("Basic realm=\"streams\""))
    val result = probe.probe(ProbeRequest(server.url("/live/index.m3u8").toString(), SourceKind.HLS, null, context))
      as ProbeResult.Failure
    assertEquals(401, result.httpStatus)
    assertEquals("streams", result.authChallenge?.realm)
    assertEquals(2, server.requestCount)
  }

  @Test fun everyOtherProbeMakesNoExtraRequest() = runBlocking {
    server.enqueue(MockResponse().setResponseCode(404))
    val result = probe.probe(ProbeRequest(server.url("/gone.mp4").toString(), null, null, context)) as ProbeResult.Failure
    assertNull(result.authChallenge)
    assertEquals(1, server.requestCount)
  }
}
