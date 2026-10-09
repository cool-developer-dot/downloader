package com.vidorax.media.analyze

import android.content.Context
import android.webkit.CookieManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vidorax.media.net.UrlPolicy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The page fetcher against the device's real WebView cookie jar and stock User-Agent: what a pasted link's page sets
 * is in the jar the tab (and the download engine's session cookies) read next, and the fetch introduces itself as
 * the tab would. On-device MockWebServer; the policy allows its loopback address.
 */
@RunWith(AndroidJUnit4::class)
class PageFetcherAndroidTest {
  private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext
  private lateinit var server: MockWebServer

  @Before
  fun setUp() {
    InstrumentationRegistry.getInstrumentation().runOnMainSync { CookieManager.getInstance().setAcceptCookie(true) }
    clearCookies()
    server = MockWebServer().apply { start() }
  }

  @After
  fun tearDown() {
    runCatching { server.shutdown() }
    clearCookies()
  }

  private fun clearCookies() {
    val done = CountDownLatch(1)
    InstrumentationRegistry.getInstrumentation().runOnMainSync {
      CookieManager.getInstance().removeAllCookies { done.countDown() }
    }
    done.await(5, TimeUnit.SECONDS)
  }

  private fun fetcher() = PageFetcher(
    OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS).build(),
    policy = UrlPolicy.ALLOW_ALL,
    defaultUserAgent = { BrowserIdentity.userAgent(context) },
    acceptLanguage = { BrowserIdentity.acceptLanguage() },
  )

  @Test
  fun cookiesThePageSetsLandInTheWebViewJarAndAreSentOnTheNextVisit() {
    server.enqueue(
      MockResponse().setHeader("Content-Type", "text/html")
        .setHeader("Set-Cookie", "tt_chain_token=T1; Path=/; Max-Age=3600; HttpOnly")
        .setBody("<html><head><meta property=\"og:video\" content=\"https://cdn.example/v.mp4\"></head></html>"),
    )
    val page = server.url("/@user/video/6718335390845095173").toString()

    val first = fetcher().fetch(PageFetchRequest(url = page, commitCookies = true, timeoutMs = 5_000))

    assertTrue(first is PageFetchResult.Document)
    val jar = CookieManager.getInstance().getCookie(page)
    assertNotNull("the committed cookie is in the WebView jar", jar)
    assertTrue(jar!!.contains("tt_chain_token=T1"))

    // The tab's own navigation (or the next fetch) presents the same session.
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("<html></html>"))
    fetcher().fetch(PageFetchRequest(url = page, useSessionCookies = true, timeoutMs = 5_000))
    server.takeRequest()
    assertEquals("tt_chain_token=T1", server.takeRequest().getHeader("Cookie"))
  }

  @Test
  fun theFetchIntroducesItselfAsTheStockWebView() {
    server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("<html></html>"))
    fetcher().fetch(PageFetchRequest(url = server.url("/p").toString(), timeoutMs = 5_000))
    val recorded = server.takeRequest()
    val ua = recorded.getHeader("User-Agent")
    assertNotNull(ua)
    assertTrue("stock WebView UA, got $ua", ua!!.contains("wv") || ua.contains("Mobile"))
    assertEquals("navigate", recorded.getHeader("Sec-Fetch-Mode"))
  }
}
