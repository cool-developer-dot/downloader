package com.vidorax.web.fonts

import android.net.Uri
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.Locale

/**
 * B16 #272 — the bundled Noto Nastaliq Urdu font for web pages, on a phone without its own Nastaliq. Pages load it from
 * one fixed address, [FONT_URL] (the page script's `FontFace` lists it after the phone's own `local()` names, so the
 * phone's font always wins). Answered from `shouldInterceptRequest` through the interceptRequest hook.
 *
 * Only that one file is ever served: [WebViewAssetLoader] with a path handler that knows exactly one name and opens
 * exactly one asset ([ASSET_PATH], through [openFont]) — never `AssetsPathHandler`, which would hand out every app
 * asset, the JS bundle included. Every other address on [HOST] (any path, any scheme) gets an empty 404 so nothing
 * on that host goes to the network; other hosts are not touched (null).
 *
 * Runs on WebView network threads: no state but the opener.
 */
internal class BundledFonts(private val openFont: () -> InputStream?) {
  private val loader = WebViewAssetLoader.Builder()
    .setDomain(HOST)
    .addPathHandler(PATH_PREFIX) { path -> if (path == FONT_FILE) fontResponse() else null }
    .build()

  /** The response for [url], or null when it isn't on [HOST]. */
  fun intercept(url: Uri, method: String?): WebResourceResponse? {
    if (url.host?.lowercase(Locale.ROOT) != HOST) return null
    if (method == null || !method.equals("GET", ignoreCase = true)) return notFound()
    return loader.shouldInterceptRequest(url) ?: notFound()
  }

  private fun fontResponse(): WebResourceResponse? {
    val stream = try {
      openFont()
    } catch (e: Exception) {
      null
    } ?: return null
    return WebResourceResponse(
      "font/ttf",
      null,
      200,
      "OK",
      // Pages load it cross-origin (FontFace from https://<site>), which fonts require CORS for.
      mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "max-age=31536000"),
      stream,
    )
  }

  companion object {
    /** WebViewAssetLoader's default domain, reserved for this use. */
    const val HOST = WebViewAssetLoader.DEFAULT_DOMAIN
    const val PATH_PREFIX = "/vidorax-fonts/"
    const val FONT_FILE = "NotoNastaliqUrdu-Regular.ttf"

    /** The one address served; page-display-script.ts NASTALIQ_BUNDLED_SOURCE uses the same. */
    const val FONT_URL = "https://$HOST$PATH_PREFIX$FONT_FILE"

    /** The one asset opened (modules/vidorax-web/android/src/main/assets). */
    const val ASSET_PATH = "vidorax-fonts/$FONT_FILE"

    fun notFound(): WebResourceResponse =
      WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
  }
}
