package com.vidorax.web.network

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebResourceRequest
import android.webkit.WebView
import com.reactnativecommunity.webview.RNCWebViewWrapper
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

private const val BATCH_INTERVAL_MS = 250L
private const val DEDUPE_WINDOW_MS = 2_000L
private const val MAX_PENDING = 256
private const val MAX_BATCH_SIZE = 64
private const val MAX_SUSPENDED_VIEWS = 8

// viewTag for requests without a WebView (service workers) or whose WebView is already unmounted.
private const val NO_VIEW_TAG = -1

/**
 * Reports media requests as batched `onNetworkMedia` observations while JS listens and observation is enabled.
 *
 * [observe] runs on WebView network threads that hold the request until it returns, so it only classifies and
 * enqueues, without locks. Dedupe, view tag lookup and emission happen on the main thread every 250 ms.
 * URLs and headers are never logged.
 */
internal class NetworkMediaObserver(private val emit: (List<Map<String, Any?>>) -> Unit) {
  private class Observation(
    val view: WebView?,
    val url: String,
    val method: String,
    val isMainFrame: Boolean,
    val hasRange: Boolean,
    val rangeStart: Long?,
    val accept: String?,
    val referer: String?,
    val hint: NetworkMediaHint,
    val observedAt: Long,
  )

  @Volatile private var hasListeners = false
  @Volatile private var isEnabled = true

  private val isActive: Boolean
    get() = hasListeners && isEnabled

  private val pending = ConcurrentLinkedQueue<Observation>()
  private val pendingCount = AtomicInteger()
  private val flushScheduled = AtomicBoolean()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val flushTask = Runnable(::flush)

  // Main thread only.
  private val recentKeys = RecentKeys(DEDUPE_WINDOW_MS)

  // Main thread only: parked tabs, whose requests are dropped instead of emitted.
  private val suspendedViews = SuspendedViews(MAX_SUSPENDED_VIEWS)

  fun setHasListeners(value: Boolean) {
    hasListeners = value
  }

  fun setEnabled(value: Boolean) {
    isEnabled = value
  }

  /** Main thread. */
  fun setViewSuspended(viewTag: Int, suspended: Boolean) {
    suspendedViews.set(viewTag, suspended)
  }

  fun observe(view: WebView?, request: WebResourceRequest) {
    if (!isActive) return

    var accept: String? = null
    var range: String? = null
    var referer: String? = null
    for ((name, value) in request.requestHeaders.orEmpty()) {
      when {
        name.equals("Accept", ignoreCase = true) -> accept = value
        name.equals("Range", ignoreCase = true) -> range = value
        name.equals("Referer", ignoreCase = true) -> referer = value
      }
    }
    val url = request.url.toString()
    val method = request.method
    val isMainFrame = request.isForMainFrame
    val hint = NetworkMediaClassifier.classify(url, method, isMainFrame, accept, range != null) ?: return

    if (pendingCount.incrementAndGet() > MAX_PENDING) {
      pendingCount.decrementAndGet()
      return
    }
    val rangeStart = NetworkMediaClassifier.rangeStart(range)
    pending.add(
      Observation(view, url, method, isMainFrame, range != null, rangeStart, accept, referer, hint, System.currentTimeMillis()),
    )
    scheduleFlush()
  }

  private fun scheduleFlush() {
    if (flushScheduled.compareAndSet(false, true)) {
      mainHandler.postDelayed(flushTask, BATCH_INTERVAL_MS)
    }
  }

  private fun flush() {
    flushScheduled.set(false)
    val now = SystemClock.elapsedRealtime()
    val batch = ArrayList<Map<String, Any?>>()
    var drained = 0
    while (batch.size < MAX_BATCH_SIZE && drained < MAX_PENDING) {
      val observation = pending.poll() ?: break
      pendingCount.decrementAndGet()
      drained++
      if (!isActive) continue

      val viewTag = observation.view?.let { RNCWebViewWrapper.getReactTagFromWebView(it) } ?: NO_VIEW_TAG
      if (viewTag in suspendedViews) continue
      if (recentKeys.add("$viewTag ${NetworkMediaClassifier.dedupeKey(observation.url)}", now)) {
        batch.add(observation.toEvent(viewTag))
      }
    }
    if (batch.isNotEmpty()) emit(batch)
    if (pending.isNotEmpty()) scheduleFlush()
  }

  private fun Observation.toEvent(viewTag: Int): Map<String, Any?> = mapOf(
    "viewTag" to viewTag,
    "url" to url,
    "method" to method,
    "isMainFrame" to isMainFrame,
    "hasRange" to hasRange,
    "rangeStart" to rangeStart,
    "accept" to accept,
    "referer" to referer,
    "hint" to hint.value,
    "observedAt" to observedAt,
  )
}
