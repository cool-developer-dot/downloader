package com.anonymous.vidorax.mediadetection

import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.view.View
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Passive Android WebView network observer.
 *
 * Called from WebViewClient.shouldInterceptRequest (and optionally
 * ServiceWorkerClient) on a background thread.
 * NEVER returns a replacement response — browsing continues unchanged.
 * NEVER logs cookie / auth header values, full URLs, or signed query.
 */
object MediaNetworkBridge {
  private const val EVENT = "VidoraMediaNetworkCandidate"
  private const val TRACE_EVENT = "VidoraMediaNetworkTrace"
  private const val DEDUPE_MS = 1500L
  private const val MAX_EVENTS_PER_WINDOW = 40
  private const val MAX_TRACES_PER_WINDOW = 24
  private const val WINDOW_MS = 2000L

  private val enabled = AtomicBoolean(false)
  private val serviceWorkerInstalled = AtomicBoolean(false)
  private var reactContextRef: WeakReference<ReactApplicationContext>? = null
  private val recent = ConcurrentHashMap<String, Long>()
  private val worker: ExecutorService = Executors.newSingleThreadExecutor { r ->
    Thread(r, "vidora-media-net").apply { isDaemon = true }
  }
  private val mainHandler = Handler(Looper.getMainLooper())

  @Volatile private var windowStart = 0L
  @Volatile private var windowCount = 0
  @Volatile private var traceWindowStart = 0L
  @Volatile private var traceWindowCount = 0

  private val MEDIA_PATH =
    Regex(
      "\\.(mp4|webm|mov|m4v|mkv|avi|mpeg|mpg|m3u8|mpd|mp3|m4a|aac|ogg|ogv|opus|wav|flac|3gp|3g2|flv|wmv|m2ts)(?:[?#]|$)",
      RegexOption.IGNORE_CASE,
    )
  private val SKIP_PATH =
    Regex(
      "\\.(js|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|map|json|html?|xml)(?:[?#]|$)",
      RegexOption.IGNORE_CASE,
    )
  private val MEDIA_FAMILY_PATH =
    Regex(
      "(?:^|/)(?:hls|m3u8|manifest|playlist|stream(?:ing)?|vod|videoplayback|dashplaylist|video)(?:[/._-]|$)",
      RegexOption.IGNORE_CASE,
    )
  private val VIDEO_OBJECT_PATH =
    Regex("(?:^|/)v/t\\d{2,}(?:[/._-]|$)", RegexOption.IGNORE_CASE)
  private val API_PATH =
    Regex(
      "(?:^|/)(?:api|graphql|metadata|beacon|analytics|tracking|telemetry|stats)(?:[/._-]|$)",
      RegexOption.IGNORE_CASE,
    )
  private val MAIN_FRAME_HTML_PATH =
    Regex(
      "/(?:video|watch|embed|media)/[A-Za-z0-9_-]+/?$",
      RegexOption.IGNORE_CASE,
    )
  private val PLAYER_DOCUMENT_PATH =
    Regex(
      "/player/[A-Za-z0-9_.-]+/?(?:index\\.html?)?$",
      RegexOption.IGNORE_CASE,
    )
  private val SEGMENT_PATH =
    Regex(
      "(?:^|/)(?:seg(?:ment)?s?|chunk|frag(?:ment)?)(?:[_./-]|$)|\\.(?:ts|m4s)(?:[?#]|$)",
      RegexOption.IGNORE_CASE,
    )
  private val INIT_SEGMENT_PATH =
    Regex(
      "(?:^|/)(?:init|isinit)(?:[_./-]|$)|(?:^|/)init[-_.]?\\d*\\.(?:mp4|m4s)(?:[?#]|$)",
      RegexOption.IGNORE_CASE,
    )
  private val MEDIA_ACCEPT =
    Regex("video/|audio/|mpegurl|dash\\+xml", RegexOption.IGNORE_CASE)

  fun attach(context: ReactApplicationContext) {
    reactContextRef = WeakReference(context)
    enabled.set(true)
    installServiceWorkerObserver()
  }

  fun detach(context: ReactApplicationContext) {
    val current = reactContextRef?.get()
    if (current == null || current === context) {
      reactContextRef = null
      setEnabled(false)
      recent.clear()
    }
  }

  fun setEnabled(value: Boolean) {
    enabled.set(value)
    if (!value) {
      recent.clear()
      windowCount = 0
    }
  }

  /**
   * Observe a WebView resource request. Must remain non-blocking and never
   * return a WebResourceResponse (caller always continues with null).
   */
  @JvmStatic
  fun observeRequest(view: WebView?, request: WebResourceRequest?) {
    observeRequestFrom(view, request, "webview")
  }

  @JvmStatic
  @Synchronized
  fun observeRequestFrom(view: WebView?, request: WebResourceRequest?, source: String) {
    if (request == null) {
      return
    }

    val url = try {
      request.url?.toString()
    } catch (_: Throwable) {
      null
    } ?: return

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      emitRejected(source, request, url, "NON_HTTP", interesting = false)
      return
    }

    val headers = try {
      request.requestHeaders
    } catch (_: Throwable) {
      null
    }
    val requestReferer = headers?.entries?.firstOrNull { it.key.equals("Referer", ignoreCase = true) }?.value?.take(8192)

    val accept = headers?.entries
      ?.firstOrNull { it.key.equals("Accept", ignoreCase = true) }
      ?.value
    val hasCookie = headers?.keys?.any { it.equals("Cookie", ignoreCase = true) } == true
    val hasRange = headers?.keys?.any { it.equals("Range", ignoreCase = true) } == true
    val isMain = try {
      request.isForMainFrame
    } catch (_: Throwable) {
      false
    }
    val method = try {
      request.method
    } catch (_: Throwable) {
      "GET"
    } ?: "GET"
    val host = try {
      request.url?.host?.lowercase() ?: ""
    } catch (_: Throwable) {
      ""
    }
    val path = try {
      request.url?.encodedPath?.lowercase() ?: ""
    } catch (_: Throwable) {
      ""
    }

    val pathLooksMedia = MEDIA_PATH.containsMatchIn(url)
    val acceptLooksMedia = accept != null && MEDIA_ACCEPT.containsMatchIn(accept)
    val familyPath = MEDIA_FAMILY_PATH.containsMatchIn(path) || VIDEO_OBJECT_PATH.containsMatchIn(path)
    val skipPath = SKIP_PATH.containsMatchIn(url)
    val tiktokLooksMedia = tiktokLooksMedia(host, path, hasRange, pathLooksMedia)
    val instagramLooksMedia = instagramLooksMedia(host, path)
    val queryLooksMedia = queryLooksMedia(url)
    val interesting =
      !isMain ||
        hasRange ||
        pathLooksMedia ||
        acceptLooksMedia ||
        familyPath ||
        tiktokLooksMedia ||
        instagramLooksMedia ||
        queryLooksMedia ||
        source == "service-worker"

    if (interesting && !skipPath) {
      emitSeen(source, method, isMain, hasRange, accept, host, path, url)
      emitTrace(
        stage = "RESOURCE_PREFILTER_CLASSIFIED",
        reason = null,
        source = source,
        method = method,
        isMain = isMain,
        hasRange = hasRange,
        accept = accept,
        host = host,
        path = path,
        fingerprint = resourceFingerprint(url),
      )
    }

    if (!enabled.get()) {
      emitRejected(source, request, url, "OBSERVER_DISABLED", interesting = interesting && !skipPath)
      return
    }

    if (skipPath) {
      return
    }
    if (
      (SEGMENT_PATH.containsMatchIn(url) || INIT_SEGMENT_PATH.containsMatchIn(url)) &&
      !url.contains(".m3u8", ignoreCase = true) &&
      !url.contains(".mpd", ignoreCase = true)
    ) {
      emitRejected(source, request, url, "SEGMENT", interesting = true)
      return
    }

    val apiPath = API_PATH.containsMatchIn(path)
    val playerDocument = PLAYER_DOCUMENT_PATH.containsMatchIn(path) && !pathLooksMedia
    val mainFrameHtml =
      isMain &&
        MAIN_FRAME_HTML_PATH.containsMatchIn(path) &&
        !pathLooksMedia &&
        !acceptLooksMedia &&
        !hasRange

    if (apiPath) {
      emitRejected(source, request, url, "API_PATH", interesting = interesting)
      return
    }
    if (playerDocument) {
      emitRejected(source, request, url, "PLAYER_DOCUMENT", interesting = true)
      return
    }
    if (mainFrameHtml) {
      emitRejected(source, request, url, "MAIN_FRAME_HTML", interesting = true)
      return
    }

    val iframeMediaHint = !isMain && (hasRange || familyPath || acceptLooksMedia || queryLooksMedia)
    val rangeFamilyMedia = hasRange && familyPath

    if (!pathLooksMedia && !acceptLooksMedia && !tiktokLooksMedia && !instagramLooksMedia && !iframeMediaHint && !rangeFamilyMedia && !queryLooksMedia) {
      emitRejected(source, request, url, "NO_MEDIA_EVIDENCE", interesting = interesting)
      return
    }

    val now = System.currentTimeMillis()
    val scopedKey = "${view?.id ?: -1}|$url"
    val prev = recent[scopedKey]
    if (prev != null && now - prev < DEDUPE_MS) {
      return
    }
    recent[scopedKey] = now

    if (recent.size > 400) {
      val cutoff = now - 60_000L
      val iterator = recent.entries.iterator()
      while (iterator.hasNext()) {
        val entry = iterator.next()
        if (entry.value < cutoff) {
          iterator.remove()
        }
      }
      while (recent.size > 400) {
        val oldest = recent.entries.minByOrNull { it.value }?.key ?: break
        recent.remove(oldest)
      }
    }

    if (now - windowStart > WINDOW_MS) {
      windowStart = now
      windowCount = 0
    }
    if (windowCount >= MAX_EVENTS_PER_WINDOW) {
      emitRejected(source, request, url, "RATE_LIMITED", interesting = true)
      return
    }
    windowCount += 1

    // WebView URL is UI-thread-only; RN binds tab/epoch from the physical view id.
    val pageUrl: String? = null
    val webViewId = view?.id ?: -1

    // Request metadata only — never fabricate response Content-Type.
    // TikTok MIME hint is preserved as existing playback-path evidence, not a response header.
    val mimeHint = when {
      tiktokLooksMedia -> "video/mp4"
      instagramLooksMedia && !acceptLooksMedia -> "video/mp4"
      acceptLooksMedia && accept != null -> firstMediaAcceptToken(accept)
      queryLooksMedia -> queryMimeHint(url)
      else -> null
    }

    val fingerprint = resourceFingerprint(url)

    mainHandler.post {
      val parentViewId = (view?.parent as? View)?.id ?: -1
      emitCandidate(
        url = canonicalizeObservedUrl(url),
        method = method,
        mimeHint = mimeHint,
        isForMainFrame = isMain,
        hasRange = hasRange,
        hasCookieHeader = hasCookie,
        pageUrl = pageUrl,
        resourceFingerprint = fingerprint,
        observationSource = source,
        webViewId = webViewId,
        parentViewId = parentViewId,
        observedAt = now,
        requestReferer = requestReferer,
      )
      emitTrace(
        stage = "NATIVE_EMITTED",
        reason = null,
        source = source,
        method = method,
        isMain = isMain,
        hasRange = hasRange,
        accept = accept,
        host = host,
        path = path,
        fingerprint = fingerprint,
      )
    }
  }

  private fun installServiceWorkerObserver() {
    if (!serviceWorkerInstalled.compareAndSet(false, true)) {
      return
    }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      serviceWorkerInstalled.set(false)
      return
    }
    try {
      ServiceWorkerController.getInstance().setServiceWorkerClient(
        object : ServiceWorkerClient() {
          override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? {
            observeRequestFrom(null, request, "service-worker")
            return null
          }
        },
      )
    } catch (_: Throwable) {
      serviceWorkerInstalled.set(false)
    }
  }

  private fun tiktokLooksMedia(
    host: String,
    path: String,
    hasRange: Boolean,
    pathLooksMedia: Boolean,
  ): Boolean {
    val tiktokCdnHost =
      host.contains("tiktokcdn") ||
        host.contains("tiktokv.com") ||
        host.contains("muscdn.com") ||
        host.contains("byteoversea.com")
    val tiktokPlaybackPath =
      path.contains("/tos") || path.contains("/video/") || path.contains("/aweme/") || path.contains("/obj/")
    val tiktokSitePlayback =
      (host == "tiktok.com" || host.endsWith(".tiktok.com")) && path.contains("/video/tos")
    return !host.contains("ibyteimg") &&
      ((tiktokCdnHost && (tiktokPlaybackPath || hasRange || pathLooksMedia)) ||
        tiktokSitePlayback)
  }

  private fun instagramLooksMedia(host: String, path: String): Boolean {
    val igHost =
      host.contains("cdninstagram") ||
        host.contains("fbcdn.net") ||
        host.contains("scontent")
    if (!igHost) return false
    if (Regex("\\.(jpg|jpeg|png|webp|gif|js|css|json|html|m4s|ts)(?:[?#]|$)", RegexOption.IGNORE_CASE).containsMatchIn(path)) {
      return false
    }
    return path.contains("/v/t") ||
      Regex("\\.(mp4|m4v|webm|mov)(?:$|[/?])", RegexOption.IGNORE_CASE).containsMatchIn(path)
  }

  private fun queryLooksMedia(url: String): Boolean {
    val lower = url.lowercase()
    if (lower.contains("mime=video") || lower.contains("mime=audio")) return true
    if (lower.contains("mime=application%2fvnd.apple") || lower.contains("mime=application/vnd.apple")) {
      return true
    }
    if (lower.contains("format=mp4") || lower.contains("ext=mp4") || lower.contains("file=mp4")) {
      return true
    }
    return lower.contains("itag=") &&
      (lower.contains("mime=") || lower.contains("clen=") || lower.contains("dur="))
  }

  private fun queryMimeHint(url: String): String? {
    val lower = url.lowercase()
    if (lower.contains("mime=video%2fwebm") || lower.contains("mime=video/webm")) return "video/webm"
    if (lower.contains("mime=video")) return "video/mp4"
    if (lower.contains("mime=audio")) return "audio/mp4"
    if (lower.contains("mpegurl")) return "application/vnd.apple.mpegurl"
    return null
  }

  private fun canonicalizeObservedUrl(url: String): String {
    return try {
      val uri = Uri.parse(url)
      val path = uri.path ?: ""
      if (!path.contains("videoplayback", ignoreCase = true)) {
        return url
      }
      val drop = setOf("range", "rn", "rbuf", "alr", "ump", "keepalive")
      val builder = uri.buildUpon().clearQuery()
      var changed = false
      for (name in uri.queryParameterNames) {
        if (drop.contains(name.lowercase())) {
          changed = true
          continue
        }
        for (value in uri.getQueryParameters(name)) {
          builder.appendQueryParameter(name, value)
        }
      }
      if (changed) builder.build().toString() else url
    } catch (_: Throwable) {
      url
    }
  }

  private fun firstMediaAcceptToken(accept: String): String? {
    val token = accept.split(',').firstOrNull()?.trim()?.take(128) ?: return null
    return if (MEDIA_ACCEPT.containsMatchIn(token)) token else null
  }

  private fun hostClassOf(host: String): String {
    val h = host.lowercase().removePrefix("www.")
    if (h.isEmpty()) return "unknown"
    if (h.contains("cdn") || h.contains("akamai") || h.contains("cloudfront") || h.contains("fastly")) {
      return "cdn-generic"
    }
    if (h.startsWith("geo.") || h.startsWith("player.") || h.startsWith("embed.")) {
      return "player-host"
    }
    return "site-host"
  }

  private fun pathClassOf(path: String): String {
    val lower = path.lowercase()
    if (lower.contains(".m3u8")) return "hls-ext"
    if (lower.endsWith(".mpd") || lower.contains(".mpd")) return "dash-ext"
    if (Regex("\\.(mp4|webm|mov|m4v)(?:$|/)", RegexOption.IGNORE_CASE).containsMatchIn(lower)) return "progressive-ext"
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html"
    if (MEDIA_FAMILY_PATH.containsMatchIn(lower)) return "media-family"
    if (SEGMENT_PATH.containsMatchIn(lower) || INIT_SEGMENT_PATH.containsMatchIn(lower)) return "segment"
    if (API_PATH.containsMatchIn(lower)) return "api"
    if (!lower.contains('.')) return "extensionless"
    val last = lower.substringAfterLast('/')
    return if (!last.contains('.')) "extensionless" else "other"
  }

  private fun acceptClassOf(accept: String?): String {
    if (accept.isNullOrBlank()) return "none"
    val lower = accept.lowercase()
    if (lower.contains("video/")) return "video"
    if (lower.contains("mpegurl")) return "mpegurl"
    if (lower.contains("dash+xml")) return "dash"
    if (lower.contains("audio/")) return "audio"
    if (lower.contains("image/")) return "image"
    if (lower.contains("text/html")) return "html"
    if (lower.contains("json")) return "json"
    if (lower.contains("*/*")) return "wildcard"
    return "other"
  }

  private fun resourceTypeHint(
    pathClass: String,
    acceptClass: String,
    hasRange: Boolean,
    isMain: Boolean,
  ): String {
    if (pathClass == "hls-ext" || acceptClass == "mpegurl") return "hls"
    if (pathClass == "dash-ext" || acceptClass == "dash") return "dash"
    if (pathClass == "progressive-ext" || acceptClass == "video") return "progressive"
    if (pathClass == "segment") return "segment"
    if (hasRange && !isMain) return "range-child-frame"
    if (pathClass == "media-family") return "media-family"
    return "unknown"
  }

  internal fun resourceFingerprint(url: String): String {
    val uri = try {
      Uri.parse(url)
    } catch (_: Throwable) {
      null
    }
    val host = (uri?.host ?: "").lowercase()
    val path = (uri?.encodedPath ?: uri?.path ?: "").lowercase()
    val key = host + path
    var hash = uncheckedFnvOffset()
    for (ch in key) {
      hash = hash xor ch.code
      hash *= 0x01000193
    }
    return Integer.toHexString(hash).padStart(8, '0')
  }

  private fun uncheckedFnvOffset(): Int {
    return 0x811c9dc5.toInt()
  }

  private fun tracesEnabled(): Boolean {
    val context = reactContextRef?.get() ?: return false
    return try {
      (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    } catch (_: Throwable) {
      false
    }
  }

  private fun allowTrace(): Boolean {
    if (!tracesEnabled()) {
      return false
    }
    val now = System.currentTimeMillis()
    if (now - traceWindowStart > WINDOW_MS) {
      traceWindowStart = now
      traceWindowCount = 0
    }
    if (traceWindowCount >= MAX_TRACES_PER_WINDOW) {
      return false
    }
    traceWindowCount += 1
    return true
  }

  private fun emitSeen(
    source: String,
    method: String,
    isMain: Boolean,
    hasRange: Boolean,
    accept: String?,
    host: String,
    path: String,
    url: String,
  ) {
    emitTrace(
      stage = "RESOURCE_SEEN",
      reason = null,
      source = source,
      method = method,
      isMain = isMain,
      hasRange = hasRange,
      accept = accept,
      host = host,
      path = path,
      fingerprint = resourceFingerprint(url),
    )
  }

  private fun emitRejected(
    source: String,
    request: WebResourceRequest,
    url: String,
    reason: String,
    interesting: Boolean,
  ) {
    if (!interesting) {
      return
    }
    val headers = try {
      request.requestHeaders
    } catch (_: Throwable) {
      null
    }
    val accept = headers?.entries
      ?.firstOrNull { it.key.equals("Accept", ignoreCase = true) }
      ?.value
    val hasRange = headers?.keys?.any { it.equals("Range", ignoreCase = true) } == true
    val isMain = try {
      request.isForMainFrame
    } catch (_: Throwable) {
      false
    }
    val method = try {
      request.method
    } catch (_: Throwable) {
      "GET"
    } ?: "GET"
    val host = try {
      request.url?.host?.lowercase() ?: ""
    } catch (_: Throwable) {
      ""
    }
    val path = try {
      request.url?.encodedPath?.lowercase() ?: ""
    } catch (_: Throwable) {
      ""
    }
    emitTrace(
      stage = "RESOURCE_REJECTED",
      reason = reason,
      source = source,
      method = method,
      isMain = isMain,
      hasRange = hasRange,
      accept = accept,
      host = host,
      path = path,
      fingerprint = resourceFingerprint(url),
    )
  }

  private fun emitTrace(
    stage: String,
    reason: String?,
    source: String,
    method: String,
    isMain: Boolean,
    hasRange: Boolean,
    accept: String?,
    host: String,
    path: String,
    fingerprint: String,
  ) {
    if (!allowTrace()) {
      return
    }
    val pathClass = pathClassOf(path)
    val acceptClass = acceptClassOf(accept)
    val map: WritableMap = Arguments.createMap().apply {
      putString("stage", stage)
      putString("event", if (stage == "RESOURCE_SEEN") "RESOURCE_SEEN" else stage)
      if (reason != null) {
        putString("reason", reason)
      } else {
        putNull("reason")
      }
      putString("observationSource", source)
      putString("method", method.take(16))
      putBoolean("isForMainFrame", isMain)
      putBoolean("hasRange", hasRange)
      putString("acceptClass", acceptClass)
      putString("hostClass", hostClassOf(host))
      putString("pathClass", pathClass)
      putString("resourceTypeHint", resourceTypeHint(pathClass, acceptClass, hasRange, isMain))
      putString("resourceFingerprint", fingerprint)
    }
    val context = reactContextRef?.get() ?: return
    if (!context.hasActiveCatalystInstance()) {
      return
    }
    mainHandler.post {
      try {
        context
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          ?.emit(TRACE_EVENT, map)
      } catch (_: Throwable) {
        // Never crash WebView / app from detection bridge.
      }
    }
  }

  private fun emitCandidate(
    url: String,
    method: String,
    mimeHint: String?,
    isForMainFrame: Boolean,
    hasRange: Boolean,
    hasCookieHeader: Boolean,
    pageUrl: String?,
    resourceFingerprint: String,
    observationSource: String,
    webViewId: Int,
    parentViewId: Int,
    observedAt: Long,
    requestReferer: String?,
  ) {
    val context = reactContextRef?.get() ?: return
    if (!context.hasActiveCatalystInstance()) {
      return
    }

    val map: WritableMap = Arguments.createMap().apply {
      putString("url", url)
      putString("method", method)
      if (mimeHint != null) {
        putString("mimeHint", mimeHint)
      } else {
        putNull("mimeHint")
      }
      putBoolean("isForMainFrame", isForMainFrame)
      putBoolean("hasRange", hasRange)
      putBoolean("hasCookieHeader", hasCookieHeader)
      if (pageUrl != null) {
        putString("pageUrl", pageUrl)
      } else {
        putNull("pageUrl")
      }
      putString("resourceFingerprint", resourceFingerprint)
      putString("observationSource", observationSource)
      putInt("webViewId", webViewId)
      putInt("parentViewId", parentViewId)
      putDouble("observedAt", observedAt.toDouble())
      if (requestReferer != null) putString("requestReferer", requestReferer) else putNull("requestReferer")
    }

    mainHandler.post {
      try {
        context
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          ?.emit(EVENT, map)
      } catch (_: Throwable) {
        // Never crash WebView / app from detection bridge.
      }
    }
  }
}
