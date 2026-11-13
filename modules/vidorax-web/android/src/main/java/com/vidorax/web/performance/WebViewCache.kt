package com.vidorax.web.performance

import android.content.Context
import android.webkit.WebView
import androidx.annotation.MainThread
import com.vidorax.web.profiles.WebProfileNames
import com.vidorax.web.profiles.WebProfiles
import java.io.File

/**
 * B18 #192 — the WebView's disk cache: its size (everything under `<cacheDir>/WebView`, every browser profile) and
 * clearing it. Clearing goes through `WebView.clearCache(true)` — Chromium's own way, safe while pages are open — once
 * for the default profile and once for each B20 browser profile (each has its own cache). Cookies, site data and
 * history are not touched.
 */
object WebViewCache {
  const val DIRECTORY = "WebView"

  fun root(context: Context): File = File(context.cacheDir, DIRECTORY)

  /** Bytes of the files under [dir] (links are not followed). Off the main thread. */
  fun sizeOf(dir: File): Long {
    if (!dir.exists()) return 0L
    var total = 0L
    dir.walkTopDown()
      .onEnter { entry -> !java.nio.file.Files.isSymbolicLink(entry.toPath()) }
      .forEach { entry -> if (entry.isFile) total += entry.length() }
    return total
  }

  fun size(context: Context): Long = sizeOf(root(context))

  /** The profiles whose caches are cleared: the default one, then every VidoraX profile. */
  @MainThread
  fun profiles(): List<String> =
    listOf(WebProfileNames.DEFAULT) + runCatching { WebProfiles.names() }.getOrDefault(emptyList()).filter { !WebProfileNames.isDefault(it) }

  /** Clears the cache of each profile with a WebView made for it ([newWebView]: tests). Main thread. */
  @MainThread
  fun clear(context: Context, newWebView: (Context) -> WebView = { WebView(it) }): Int {
    var cleared = 0
    for (name in profiles()) {
      val webView = runCatching { newWebView(context) }.getOrNull() ?: continue
      try {
        WebProfiles.applyNamed(webView, name)
        webView.clearCache(true)
        cleared += 1
      } catch (_: RuntimeException) {
        // A profile that can't be used now keeps its cache; the others are still cleared.
      } finally {
        webView.destroy()
      }
    }
    return cleared
  }
}
