package com.vidorax.web.network

import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import com.reactnativecommunity.webview.RNCWebViewHooks
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Sends service worker requests, which belong to no WebView, through the same hook as WebView requests. The client is
 * process-wide, so it is installed once, when the first browser WebView exists (the WebView provider is loaded then).
 */
internal object ServiceWorkerRequests {
  private val installed = AtomicBoolean()

  fun install() {
    if (!installed.compareAndSet(false, true)) return
    ServiceWorkerController.getInstance().setServiceWorkerClient(
      object : ServiceWorkerClient() {
        override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? {
          RNCWebViewHooks.observeRequest(null, request)
          return null
        }
      },
    )
  }
}
