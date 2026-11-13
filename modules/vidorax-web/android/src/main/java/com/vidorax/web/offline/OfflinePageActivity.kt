package com.vidorax.web.offline

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.File

/**
 * B17 #178 — a saved page, read-only: its own WebView with **JavaScript off, network loads blocked, content access
 * off**, file access only so it can open this one archive (canonicalised, inside `offline-pages/`), and every link or
 * navigation refused. Not exported. It closes when the app leaves the screen, so coming back goes through App Lock in
 * the main activity. (The app's browser WebViews keep `webview-configuration.ts`'s rules: no file access.)
 */
class OfflinePageActivity : Activity() {
  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val file = intent.getStringExtra(EXTRA_PATH)?.let { File(it) }
    if (file == null || !file.isFile || !OfflinePages.isInside(filesDir, file)) {
      closed()
      finish()
      return
    }
    title = intent.getStringExtra(EXTRA_TITLE)?.take(120)
    val view = WebView(this)
    view.settings.apply {
      javaScriptEnabled = false
      blockNetworkLoads = true
      allowContentAccess = false
      allowFileAccess = true
      @Suppress("DEPRECATION")
      allowFileAccessFromFileURLs = false
      @Suppress("DEPRECATION")
      allowUniversalAccessFromFileURLs = false
      builtInZoomControls = true
      displayZoomControls = false
    }
    view.webViewClient = ReadOnlyClient()
    setContentView(view)
    view.loadUrl(file.toURI().toString())
  }

  override fun onStop() {
    super.onStop()
    if (!isChangingConfigurations) {
      // Reported here, not when the app comes back: App Lock's "expected screen" ends as soon as the viewer goes.
      closed()
      finish()
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    if (!isChangingConfigurations) closed()
  }

  private fun closed() = Companion.closed()

  /** Nothing navigates away from the archive (links, redirects, form posts). */
  private class ReadOnlyClient : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
  }

  companion object {
    /** Called once when the viewer stops or goes (openOfflinePage resolves). */
    @Volatile
    var onClosed: (() -> Unit)? = null

    fun closed() {
      val callback = onClosed
      onClosed = null
      callback?.invoke()
    }

    const val EXTRA_PATH = "com.vidorax.web.offline.PATH"
    const val EXTRA_TITLE = "com.vidorax.web.offline.TITLE"

    fun intent(context: Context, file: File, title: String): Intent =
      Intent(context, OfflinePageActivity::class.java).putExtra(EXTRA_PATH, file.path).putExtra(EXTRA_TITLE, title)
  }
}
