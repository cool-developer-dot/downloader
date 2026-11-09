package com.vidorax.web.blocking

import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import java.util.concurrent.Executor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class ContentBlockingTest {
  private val lists = mapOf(
    ContentBlocking.ADS_ASSET to "adserver.example\n",
    ContentBlocking.TRACKERS_ASSET to "tracker.example\n",
  )
  private val opened = mutableListOf<String>()
  // Runs list loading inline so the test sees it at once.
  private val inline = Executor { it.run() }
  private val blocking = ContentBlocking({ name -> opened += name; lists[name]?.byteInputStream() }, inline)

  private fun request(url: String, mainFrame: Boolean = false, headers: Map<String, String> = emptyMap()) =
    object : WebResourceRequest {
      override fun getUrl(): Uri = Uri.parse(url)
      override fun isForMainFrame() = mainFrame
      override fun isRedirect() = false
      override fun hasGesture() = false
      override fun getMethod() = "GET"
      override fun getRequestHeaders() = headers
    }

  @Test
  fun blocksWithAnEmptyResponseAndCountsPerPage() {
    val view = WebView(RuntimeEnvironment.getApplication())
    blocking.setRules(ContentBlocker.Rules(ads = true, trackers = true, allowedSites = emptySet()))
    assertTrue(blocking.listsReady())

    assertNull("the page itself loads", blocking.intercept(view, request("https://news.example.org/a", mainFrame = true)))
    val blocked = blocking.intercept(view, request("https://adserver.example/ad.js"))
    assertNotNull(blocked)
    assertEquals(200, blocked!!.statusCode)
    assertEquals(0, blocked.data.readBytes().size)
    assertNotNull(blocking.intercept(view, request("https://tracker.example/c")))
    assertNull(blocking.intercept(view, request("https://news.example.org/style.css")))
    assertNull("video", blocking.intercept(view, request("https://adserver.example/clip.mp4")))
    assertNull("manifest", blocking.intercept(view, request("https://adserver.example/x.m3u8")))
    assertNull("range", blocking.intercept(view, request("https://adserver.example/s", headers = mapOf("range" to "bytes=0-"))))
    assertEquals(2, blocking.blockedCount(view))

    // The next page starts at zero.
    blocking.intercept(view, request("https://other.example.net/", mainFrame = true))
    assertEquals(0, blocking.blockedCount(view))
  }

  @Test
  fun aTappedVideoLinkKeepsThePage() {
    val view = WebView(RuntimeEnvironment.getApplication())
    blocking.setRules(ContentBlocker.Rules(ads = true, trackers = false, allowedSites = setOf("example.org")))
    blocking.intercept(view, request("https://www.example.org/watch", mainFrame = true))
    // The page allows ads; a main-frame request for a video file (a download) must not replace it.
    blocking.intercept(view, request("https://cdn.video.example/clip.mp4", mainFrame = true))
    assertNull(blocking.intercept(view, request("https://adserver.example/ad.js")))
    // A real next page does.
    blocking.intercept(view, request("https://other.example.com/", mainFrame = true))
    assertNotNull(blocking.intercept(view, request("https://adserver.example/ad.js")))
  }

  @Test
  fun theAllowedSiteComesFromThePageAndJsCanCorrectIt() {
    val view = WebView(RuntimeEnvironment.getApplication())
    blocking.setRules(ContentBlocker.Rules(ads = true, trackers = false, allowedSites = setOf("example.org")))
    blocking.intercept(view, request("https://www.example.org/", mainFrame = true))
    assertNull(blocking.intercept(view, request("https://adserver.example/ad.js")))
    // A back / forward the hook didn't see: JS names the page.
    blocking.setPage(view, "https://elsewhere.example.com/p")
    assertNotNull(blocking.intercept(view, request("https://adserver.example/ad.js")))
  }

  @Test
  fun listsLoadOnlyWhenNeededAndAreDroppedWhenOff() {
    val view = WebView(RuntimeEnvironment.getApplication())
    assertNull(blocking.intercept(view, request("https://adserver.example/ad.js")))
    assertTrue("nothing read while off", opened.isEmpty())
    blocking.setRules(ContentBlocker.Rules(ads = true, trackers = false, allowedSites = emptySet()))
    assertEquals(listOf(ContentBlocking.ADS_ASSET), opened)
    assertEquals(1, blocking.listSize(ads = true))
    assertEquals(0, blocking.listSize(ads = false))
    blocking.setRules(ContentBlocker.Rules.OFF)
    assertEquals(0, blocking.listSize(ads = true))
  }

  @Test
  fun whileOffAResourceRequestCostsNothing() {
    val view = WebView(RuntimeEnvironment.getApplication())
    val untouchable = object : WebResourceRequest {
      override fun getUrl(): Uri = Uri.parse("https://adserver.example/ad.js")
      override fun isForMainFrame() = false
      override fun isRedirect() = false
      override fun hasGesture() = false
      override fun getMethod() = "GET"
      override fun getRequestHeaders(): Map<String, String> = throw AssertionError("headers read while blocking is off")
    }
    assertNull(blocking.intercept(view, untouchable))
    assertTrue(opened.isEmpty())
  }

  @Test
  fun nothingIsBlockedUntilTheListHasLoaded() {
    val queued = mutableListOf<Runnable>()
    val slow = ContentBlocking({ name -> lists[name]?.byteInputStream() }, Executor { queued += it })
    val view = WebView(RuntimeEnvironment.getApplication())
    slow.setRules(ContentBlocker.Rules(ads = true, trackers = false, allowedSites = emptySet()))
    assertNull(slow.intercept(view, request("https://adserver.example/ad.js")))
    queued.forEach { it.run() }
    assertNotNull(slow.intercept(view, request("https://adserver.example/ad.js")))
  }

  @Test
  fun aMissingListBlocksNothingAndDoesNotCrash() {
    val broken = ContentBlocking({ throw java.io.IOException("gone") }, inline)
    val view = WebView(RuntimeEnvironment.getApplication())
    broken.setRules(ContentBlocker.Rules(ads = true, trackers = true, allowedSites = emptySet()))
    assertNull(broken.intercept(view, request("https://adserver.example/ad.js")))
  }
}
