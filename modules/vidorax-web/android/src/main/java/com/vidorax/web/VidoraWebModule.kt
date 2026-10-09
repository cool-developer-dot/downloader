package com.vidorax.web

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import com.facebook.react.bridge.ReactContext
import com.reactnativecommunity.webview.RNCWebView
import com.reactnativecommunity.webview.RNCWebViewHooks
import com.reactnativecommunity.webview.RNCWebViewModule
import com.reactnativecommunity.webview.RNCWebViewWrapper
import com.vidorax.web.network.NetworkMediaClassifier
import com.vidorax.web.network.NetworkMediaObserver
import com.vidorax.web.network.ServiceWorkerRequests
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicReference

private const val ON_NETWORK_MEDIA = "onNetworkMedia"
private const val ON_WEB_DOWNLOAD = "onWebDownload"
private const val ON_SHARED_TEXT = "onSharedText"

// react-native-webview's own download defaults (RNCWebViewManagerImpl).
private const val DOWNLOADING_MESSAGE = "Downloading"
private val INVALID_FILE_NAME_CHARS = Regex("[\\\\/%\"]")

/** Contract: modules/vidorax-web/src/VidoraWeb.types.ts. */
class VidoraWebModule : Module() {
  private val networkObserver = NetworkMediaObserver { observations ->
    sendEvent(ON_NETWORK_MEDIA, mapOf("observations" to observations))
  }

  @Volatile private var hasWebDownloadListeners = false
  @Volatile private var hasSharedTextListeners = false

  // A link shared while JS was not listening, handed out by consumeSharedText.
  private val unclaimedSharedText = AtomicReference<String?>(null)

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val webViewHooks = object : RNCWebViewHooks.Listener {
    override fun onWebViewCreated(webView: RNCWebView) {
      ServiceWorkerRequests.install()
    }

    override fun observeRequest(view: WebView?, request: WebResourceRequest) {
      networkObserver.observe(view, request)
    }

    override fun onDownloadStart(
      webView: RNCWebView,
      url: String,
      userAgent: String?,
      contentDisposition: String?,
      mimeType: String?,
      contentLength: Long,
    ): Boolean {
      if (!hasWebDownloadListeners || !isHttpUrl(url)) {
        return false
      }
      // Only videos go to the detection pipeline; every other download goes to DownloadManager as before.
      val hint = NetworkMediaClassifier.classifyDownload(url, mimeType, contentDisposition) ?: return false
      sendEvent(
        ON_WEB_DOWNLOAD,
        mapOf(
          "viewTag" to RNCWebViewWrapper.getReactTagFromWebView(webView),
          "url" to url,
          "userAgent" to (userAgent ?: webView.settings.userAgentString),
          "contentDisposition" to contentDisposition?.takeIf { it.isNotBlank() },
          "mimeType" to mimeType?.takeIf { it.isNotBlank() },
          "contentLength" to contentLength.takeIf { it > 0 },
          "hint" to hint.value,
        ),
      )
      return true
    }
  }

  override fun definition() = ModuleDefinition {
    Name("VidoraWeb")

    Events(ON_NETWORK_MEDIA, ON_WEB_DOWNLOAD, ON_SHARED_TEXT)

    OnCreate {
      RNCWebViewHooks.setListener(webViewHooks)
    }

    OnDestroy {
      RNCWebViewHooks.removeListener(webViewHooks)
      networkObserver.setHasListeners(false)
    }

    OnStartObserving(ON_NETWORK_MEDIA) { networkObserver.setHasListeners(true) }
    OnStopObserving(ON_NETWORK_MEDIA) { networkObserver.setHasListeners(false) }
    OnStartObserving(ON_WEB_DOWNLOAD) { hasWebDownloadListeners = true }
    OnStopObserving(ON_WEB_DOWNLOAD) { hasWebDownloadListeners = false }
    OnStartObserving(ON_SHARED_TEXT) { hasSharedTextListeners = true }
    OnStopObserving(ON_SHARED_TEXT) { hasSharedTextListeners = false }

    Function("setNetworkObservationEnabled") { enabled: Boolean ->
      networkObserver.setEnabled(enabled)
    }

    AsyncFunction("setWebViewActive") { viewTag: Int, active: Boolean ->
      setWebViewActive(viewTag, active)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("flushCookies") {
      CookieManager.getInstance().flush()
    }

    AsyncFunction("launchIntentUri") { uri: String ->
      launchIntentUri(uri)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startSystemDownload") { url: String, userAgent: String?, contentDisposition: String?, mimeType: String? ->
      startSystemDownload(url, userAgent, contentDisposition, mimeType)
    }.runOnQueue(Queues.MAIN)

    // Settings → Theme, told to Android so the launch screen follows it (see AppNightMode).
    Function("setAppNightMode") { mode: String ->
      AppNightMode.apply(context, mode)
    }

    Function("getDefaultUserAgent") {
      WebSettings.getDefaultUserAgent(context)
    }

    Function("consumeSharedText") {
      unclaimedSharedText.getAndSet(null) ?: takeSharedText(appContext.currentActivity?.intent)
    }

    Function("isDefaultBrowser") {
      DefaultBrowser.isHeld(context)
    }

    Function("canRequestDefaultBrowser") {
      DefaultBrowser.canRequest(context)
    }

    AsyncFunction("requestDefaultBrowser") {
      DefaultBrowser.request(appContext.currentActivity, context)
    }.runOnQueue(Queues.MAIN)

    OnNewIntent { intent ->
      val text = takeSharedText(intent) ?: return@OnNewIntent
      if (hasSharedTextListeners) {
        sendEvent(ON_SHARED_TEXT, mapOf("text" to text))
      } else {
        unclaimedSharedText.set(text)
      }
    }
  }

  /**
   * A parked tab's WebView stays attached (so its history and scroll survive) but must stop working. `onPause` hides
   * its page from Chromium: `document.hidden` turns true, rAF and compositor frames stop, timers are throttled and
   * media is suspended; `onResume` reverses that. Not `pauseTimers`, which is process-wide. Its media requests are
   * also dropped natively, so a parked page never costs a bridge event. Returns false when the view is gone.
   */
  private fun setWebViewActive(viewTag: Int, active: Boolean): Boolean {
    val wrapper = try {
      appContext.findView<RNCWebViewWrapper>(viewTag)
    } catch (_: RuntimeException) {
      null
    }
    networkObserver.setViewSuspended(viewTag, !active && wrapper != null)
    val webView = wrapper?.webView ?: return false
    if (active) webView.onResume() else webView.onPause()
    return true
  }

  /**
   * Gives a download claimed by [webViewHooks] back to Android's DownloadManager, exactly as react-native-webview's
   * own DownloadListener would have started it (cookies, User-Agent, public Downloads folder, the storage permission
   * prompt below Android 10). Used when JS finds that a claimed download is not a video after all.
   */
  private fun startSystemDownload(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?): Boolean {
    if (!isHttpUrl(url)) return false
    val module = (appContext.reactContext as? ReactContext)?.getNativeModule(RNCWebViewModule::class.java) ?: return false
    val request = try {
      DownloadManager.Request(Uri.parse(url))
    } catch (_: IllegalArgumentException) {
      return false
    }
    val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType).replace(INVALID_FILE_NAME_CHARS, "_")
    CookieManager.getInstance().getCookie(url)?.let { request.addRequestHeader("Cookie", it) }
    request.addRequestHeader("User-Agent", userAgent ?: WebSettings.getDefaultUserAgent(context))
    request.setTitle(fileName)
    request.setDescription("$DOWNLOADING_MESSAGE $fileName")
    request.allowScanningByMediaScanner()
    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
    module.setDownloadRequest(request)
    if (module.grantFileDownloaderPermissions(DOWNLOADING_MESSAGE, null)) {
      module.downloadFile(DOWNLOADING_MESSAGE)
    }
    return true
  }

  private fun launchIntentUri(uri: String): Boolean {
    val intent = IntentUris.toSafeIntent(uri) ?: return false
    val activity = appContext.currentActivity
    return try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  private fun isHttpUrl(url: String) =
    url.startsWith("https://", ignoreCase = true) || url.startsWith("http://", ignoreCase = true)
}
