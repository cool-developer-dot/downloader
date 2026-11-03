package com.vidorax.web.network

import android.annotation.SuppressLint
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.ProfileStore
import com.reactnativecommunity.webview.RNCWebViewHooks
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Sends service worker requests, which belong to no WebView, through the same hook as WebView requests. The client is
 * process-wide, so it is installed once, when the first browser WebView exists (the WebView provider is loaded then).
 * B20: each other browser profile has its own service workers, so its client is installed with its first WebView.
 */
internal object ServiceWorkerRequests {
  private val installed = AtomicBoolean()
  private val installedProfiles = Collections.synchronizedSet(mutableSetOf<String>())

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

  /** Main thread; [profileName] is a valid non-default profile and WebView supports profiles (WebProfiles). */
  @SuppressLint("RequiresFeature")
  fun installFor(profileName: String) {
    if (!installedProfiles.add(profileName)) return
    ProfileStore.getInstance().getOrCreateProfile(profileName).serviceWorkerController.setServiceWorkerClient(
      object : ServiceWorkerClient() {
        override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? {
          RNCWebViewHooks.observeRequest(null, request)
          return null
        }
      },
    )
  }

  /** A deleted profile gets its client again if it is ever created anew. */
  fun forget(profileName: String) {
    installedProfiles.remove(profileName)
  }
}
