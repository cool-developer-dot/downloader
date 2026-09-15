package com.vidorax.web

import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.WeakHashMap

/**
 * Keeps the detector installed as a document-start script in every browser WebView, so it runs in every frame before
 * the page's own scripts. Main thread only.
 */
internal class DocumentStartScripts {
  private class Installed(val script: String, val handler: ScriptHandler)

  private var script: String? = null

  // Live browser WebViews. The installed script is kept in a view tag instead of a map value, so this map never holds
  // a strong reference that could keep a closed tab's WebView in memory.
  private val webViews = WeakHashMap<WebView, Unit>()

  val isSupported: Boolean
    get() = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

  fun attach(webView: WebView) {
    webViews[webView] = Unit
    install(webView)
  }

  fun setScript(value: String) {
    script = value
    webViews.keys.toList().forEach(::install)
  }

  private fun install(webView: WebView) {
    val current = script ?: return
    val installed = webView.getTag(R.id.vidorax_web_document_start_script) as? Installed
    if (installed?.script == current || !isSupported) {
      return
    }
    installed?.handler?.remove()
    val handler = WebViewCompat.addDocumentStartJavaScript(webView, current, setOf("*"))
    webView.setTag(R.id.vidorax_web_document_start_script, Installed(current, handler))
  }
}
