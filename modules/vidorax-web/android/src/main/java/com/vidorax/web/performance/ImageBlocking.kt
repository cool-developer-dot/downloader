package com.vidorax.web.performance

import android.webkit.WebView

/**
 * B18 #183 / #193 / #184 — pictures off for a tab: `WebSettings.setBlockNetworkImage`. Pictures from the network aren't
 * fetched (data: and cached ones may still show); turning it back off makes WebView fetch the page's pictures. The app
 * decides per page (site exceptions, Wi-Fi only, Data saver) and calls this when a page starts loading or a setting
 * changes.
 */
object ImageBlocking {
  /** Returns whether the setting changed. Main thread. */
  fun apply(webView: WebView, block: Boolean): Boolean {
    val settings = webView.settings
    if (settings.blockNetworkImage == block) return false
    settings.blockNetworkImage = block
    return true
  }
}
