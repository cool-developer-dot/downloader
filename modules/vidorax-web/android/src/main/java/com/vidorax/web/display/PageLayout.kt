package com.vidorax.web.display

import android.os.Build
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature

/**
 * B16 — a tab's page layout settings that react-native-webview has no prop for:
 *
 * - **Text reflow (#169)**: `WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING` (Chromium's text autosizing: paragraphs in wide
 *   columns get bigger text so they read without zooming); off = `NORMAL`, WebView's default.
 * - **Default zoom per site (#165)**: `WebView.setInitialScale(percent)`; 0 = WebView's own choice (its default).
 *   Takes effect from the next page load.
 * - **Force dark on Android 13+ (#163)**: with the app targeting API 33+, react-native-webview's `forceDarkOn`
 *   (`FORCE_DARK`) does nothing there; `setAlgorithmicDarkeningAllowed` is the replacement. WebView applies it only to
 *   pages without a dark theme of their own, and only while the app's theme is dark (a platform rule).
 */
object PageLayout {
  /** Lowest / highest initial scale accepted (percent); anything else means "WebView's default" (0). */
  const val MIN_SCALE = 25
  const val MAX_SCALE = 500

  fun normalizeScale(percent: Int): Int = if (percent in MIN_SCALE..MAX_SCALE) percent else 0

  fun layoutAlgorithm(textAutosizing: Boolean): WebSettings.LayoutAlgorithm =
    if (textAutosizing) WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING else WebSettings.LayoutAlgorithm.NORMAL

  /** Whether this WebView can darken pages algorithmically (Android 13+ with a WebView that supports it). */
  fun canDarkenAlgorithmically(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      runCatching { WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING) }.getOrDefault(false)

  /** Applies the three settings to [webView] (main thread). Returns whether darkening could be set. */
  fun apply(webView: WebView, textAutosizing: Boolean, initialScale: Int, algorithmicDarkening: Boolean): Boolean {
    val settings = webView.settings
    val algorithm = layoutAlgorithm(textAutosizing)
    if (settings.layoutAlgorithm != algorithm) settings.layoutAlgorithm = algorithm
    webView.setInitialScale(normalizeScale(initialScale))
    if (!canDarkenAlgorithmically()) return false
    return runCatching {
      WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, algorithmicDarkening)
      true
    }.getOrDefault(false)
  }
}
