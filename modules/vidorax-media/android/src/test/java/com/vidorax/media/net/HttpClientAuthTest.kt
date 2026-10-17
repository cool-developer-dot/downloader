package com.vidorax.media.net

import com.vidorax.media.model.BasicCredentials
import com.vidorax.media.model.RequestContext
import java.util.Collections
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * #299 in the HTTP client: `Authorization: Basic` only over https, only to the download's pinned origin, and never on
 * a redirect chain once it left that origin — not even when it comes back. A fake "network" (an interceptor that
 * answers itself) lets https URLs be tested without TLS.
 */
class HttpClientAuthTest {
  private val seen = Collections.synchronizedList(mutableListOf<Request>())

  /** Answers per URL: a redirect target, or 200. */
  private val redirects = HashMap<String, String>()

  private val client = HttpClient(
    OkHttpClient.Builder()
      .addInterceptor(
        Interceptor { chain ->
          val request = chain.request()
          seen += request
          val target = redirects[request.url.toString()]
          val builder = Response.Builder().request(request).protocol(Protocol.HTTP_1_1).message("fake")
          if (target != null) {
            builder.code(302).header("Location", target).body("".toResponseBody())
          } else {
            builder.code(200).body("ok".toResponseBody())
          }
          builder.build()
        },
      )
      .build(),
    UrlPolicy.ALLOW_ALL,
  )

  private val alice = BasicCredentials("alice", "pw")

  @Before fun setUp() = DownloadCredentials.resetForTests()

  @After fun tearDown() = DownloadCredentials.resetForTests()

  private fun context(authKey: String? = "dl") =
    RequestContext(null, null, null, mapOf("Authorization" to "Bearer from-js"), useCookies = false, authKey = authKey)

  private fun fetch(url: String, authKey: String? = "dl"): List<String?> {
    seen.clear()
    client.execute(MediaRequest(url = url, context = context(authKey))).close()
    return seen.map { it.header("Authorization") }
  }

  @Test fun theDownloadsOwnOriginGetsItsSignIn() {
    DownloadCredentials.put("dl", "https://media.example.com/v.mp4", alice)
    val sent = fetch("https://media.example.com/v.mp4")
    assertEquals(1, sent.size)
    assertEquals(okhttp3.Credentials.basic("alice", "pw", Charsets.UTF_8), sent.single())
  }

  @Test fun aRequestWithoutCredentialsCarriesNoAuthorizationAtAll() {
    // Not even the one a page's headers tried to bring along.
    assertNull(fetch("https://media.example.com/v.mp4").single())
    assertNull(fetch("https://media.example.com/v.mp4", authKey = null).single())
  }

  @Test fun httpIsNeverSentTheCredentials() {
    DownloadCredentials.put("dl", "https://media.example.com/v.mp4", alice)
    assertNull(fetch("http://media.example.com/v.mp4").single())
  }

  @Test fun anotherOriginIsNeverSentTheCredentials() {
    DownloadCredentials.put("dl", "https://media.example.com/v.mp4", alice)
    assertNull(fetch("https://cdn.example.com/v.mp4").single())
    assertNull(fetch("https://media.example.com:8443/v.mp4").single())
  }

  @Test fun aSameOriginRedirectKeepsThem() {
    DownloadCredentials.put("dl", "https://media.example.com/v.mp4", alice)
    redirects["https://media.example.com/v.mp4"] = "/files/v.mp4"
    val sent = fetch("https://media.example.com/v.mp4")
    assertEquals(2, sent.size)
    assertEquals(listOf(true, true), sent.map { it != null })
  }

  @Test fun aCrossOriginRedirectStripsThemForTheRestOfTheChain() {
    DownloadCredentials.put("dl", "https://media.example.com/v.mp4", alice)
    redirects["https://media.example.com/v.mp4"] = "https://cdn.other.example/v.mp4"
    // …and the other origin sends the request back: still nothing, the chain left the pinned origin once.
    redirects["https://cdn.other.example/v.mp4"] = "https://media.example.com/final.mp4"
    val sent = fetch("https://media.example.com/v.mp4")
    assertEquals(3, sent.size)
    assertEquals(listOf(true, false, false), sent.map { it != null })
  }

  @Test fun aRedirectFromHttpsToHttpOnTheSameHostStripsThem() {
    DownloadCredentials.put("dl", "https://media.example.com/v.mp4", alice)
    redirects["https://media.example.com/v.mp4"] = "http://media.example.com/v.mp4"
    assertEquals(listOf(true, false), fetch("https://media.example.com/v.mp4").map { it != null })
  }

  @Test fun clearedCredentialsAreNotSent() {
    DownloadCredentials.put("dl", "https://media.example.com/v.mp4", alice)
    DownloadCredentials.clear("dl")
    assertNull(fetch("https://media.example.com/v.mp4").single())
  }
}
