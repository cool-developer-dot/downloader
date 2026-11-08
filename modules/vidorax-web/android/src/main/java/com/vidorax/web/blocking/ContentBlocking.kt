package com.vidorax.web.blocking

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import com.vidorax.web.network.NetworkMediaClassifier
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * B14 #121 / #114 — ad and tracker blocking through the interceptRequest hook (Faran's rules: network threads, fast,
 * thread-safe, no JS, no WebView calls; everything it reads is held here and set from JS ahead of time).
 *
 * - [setRules] (JS, on every change of the switches or the allowed sites, and on a profile switch) replaces one
 *   immutable snapshot. The bundled lists are read from the app's assets on a background thread the first time a
 *   switch needs them, and dropped again when both switches are off; until a list has loaded nothing is blocked.
 * - Each tab WebView has a page state: its site (from its main-frame request, and from JS when a page starts loading)
 *   and how many requests were blocked on the page, reset by the next main-frame request. The lock-icon panel reads it.
 * - A blocked request gets an empty 200 response (no network request is made).
 */
internal class ContentBlocking(
  private val openAsset: (String) -> InputStream?,
  private val loader: Executor = Executors.newSingleThreadExecutor(),
) {
  private class PageState(@Volatile var host: String?) {
    val blocked = AtomicInteger()
  }

  private val rules = AtomicReference(ContentBlocker.Rules.OFF)
  @Volatile private var adList: BlockList? = null
  @Volatile private var trackerList: BlockList? = null
  private val pages: MutableMap<WebView, PageState> = Collections.synchronizedMap(WeakHashMap())

  val currentRules: ContentBlocker.Rules get() = rules.get()

  /** Any thread. Takes effect for the next request; the lists follow on the loader thread. */
  fun setRules(next: ContentBlocker.Rules) {
    rules.set(next)
    loader.execute { syncLists() }
  }

  /** Whether each needed list has loaded (tests, diagnostics). */
  fun listsReady(): Boolean {
    val current = rules.get()
    return (!current.ads || adList != null) && (!current.trackers || trackerList != null)
  }

  /** Rules in a list, 0 when not loaded. */
  fun listSize(ads: Boolean): Int = (if (ads) adList else trackerList)?.size ?: 0

  /** Network threads (the hook). Null = load normally. */
  fun intercept(view: WebView, request: WebResourceRequest): WebResourceResponse? {
    val url = request.url?.toString() ?: return null
    var accept: String? = null
    var hasRange = false
    for ((name, value) in request.requestHeaders.orEmpty()) {
      when {
        name.equals("Accept", ignoreCase = true) -> accept = value
        name.equals("Range", ignoreCase = true) -> hasRange = true
      }
    }
    if (request.isForMainFrame) {
      // A tapped video link (a main-frame request for a media file) becomes a download, not a page: the page stays.
      if (NetworkMediaClassifier.classify(url, request.method ?: "GET", true, accept, hasRange) == null) {
        pages[view] = PageState(RequestTarget.parse(url)?.host)
      }
      return null
    }
    val current = rules.get()
    if (!current.enabled) return null
    val page = pages[view]
    val verdict = ContentBlocker.decide(
      url, request.method, false, accept, hasRange, page?.host, current, adList, trackerList,
    )
    if (verdict == ContentBlocker.Verdict.ALLOW) return null
    page?.blocked?.incrementAndGet()
    return emptyResponse()
  }

  /** Main thread, when JS sees a page start loading (covers redirects and back / forward the hook may not see). */
  fun setPage(view: WebView, url: String) {
    val host = RequestTarget.parse(url)?.host
    synchronized(pages) {
      val state = pages[view]
      if (state == null) pages[view] = PageState(host) else state.host = host
    }
  }

  /** Requests blocked on the WebView's current page. */
  fun blockedCount(view: WebView): Int = pages[view]?.blocked?.get() ?: 0

  private fun syncLists() {
    val current = rules.get()
    adList = if (current.ads) adList ?: load(ADS_ASSET) else null
    trackerList = if (current.trackers) trackerList ?: load(TRACKERS_ASSET) else null
  }

  private fun load(asset: String): BlockList =
    try {
      openAsset(asset)?.bufferedReader()?.useLines { BlockList.parse(it) } ?: BlockList.EMPTY
    } catch (e: Exception) {
      BlockList.EMPTY
    }

  companion object {
    const val ADS_ASSET = "vidorax-blocklists/ads.txt"
    const val TRACKERS_ASSET = "vidorax-blocklists/trackers.txt"

    fun emptyResponse(): WebResourceResponse =
      WebResourceResponse("text/plain", "utf-8", 200, "OK", emptyMap(), ByteArrayInputStream(ByteArray(0)))
  }
}
