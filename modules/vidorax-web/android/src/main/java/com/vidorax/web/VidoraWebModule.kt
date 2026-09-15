package com.vidorax.web

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import com.reactnativecommunity.webview.RNCWebView
import com.reactnativecommunity.webview.RNCWebViewHooks
import com.reactnativecommunity.webview.RNCWebViewWrapper
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

/** Contract: modules/vidorax-web/src/VidoraWeb.types.ts. */
class VidoraWebModule : Module() {
  private val documentStartScripts = DocumentStartScripts()
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
      documentStartScripts.attach(webView)
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
      sendEvent(
        ON_WEB_DOWNLOAD,
        mapOf(
          "viewTag" to RNCWebViewWrapper.getReactTagFromWebView(webView),
          "url" to url,
          "userAgent" to (userAgent ?: webView.settings.userAgentString),
          "contentDisposition" to contentDisposition?.takeIf { it.isNotBlank() },
          "mimeType" to mimeType?.takeIf { it.isNotBlank() },
          "contentLength" to contentLength.takeIf { it > 0 },
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

    Function("isDocumentStartScriptSupported") {
      documentStartScripts.isSupported
    }

    AsyncFunction("setDetectorScript") { script: String ->
      documentStartScripts.setScript(script)
    }.runOnQueue(Queues.MAIN)

    Function("setNetworkObservationEnabled") { enabled: Boolean ->
      networkObserver.setEnabled(enabled)
    }

    AsyncFunction("flushCookies") {
      CookieManager.getInstance().flush()
    }

    AsyncFunction("launchIntentUri") { uri: String ->
      launchIntentUri(uri)
    }.runOnQueue(Queues.MAIN)

    Function("getDefaultUserAgent") {
      WebSettings.getDefaultUserAgent(context)
    }

    Function("consumeSharedText") {
      unclaimedSharedText.getAndSet(null) ?: takeSharedText(appContext.currentActivity?.intent)
    }

    OnNewIntent { intent ->
      val text = takeSharedText(intent) ?: return@OnNewIntent
      if (hasSharedTextListeners) {
        sendEvent(ON_SHARED_TEXT, mapOf("text" to text))
      } else {
        unclaimedSharedText.set(text)
      }
    }
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
