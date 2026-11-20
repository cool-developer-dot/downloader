package com.vidorax.web.offline

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.MainThread
import com.vidorax.web.profiles.WebProfiles
import java.io.File

/**
 * #486 Site grabber: saves a page VidoraX already fetched (its HTML, read without cookies) as a web archive, the same
 * `.mht` Saved Pages keeps. The HTML is laid out in an off-screen WebView of the active browser profile with
 * JavaScript off and no navigation, so only its own pictures and styles load; then `saveWebArchive` writes it. One
 * page at a time; the WebView is destroyed afterwards.
 */
internal object HtmlArchiver {
  private const val SETTLE_MS = 1_500L
  private const val WIDTH = 1080
  private const val HEIGHT = 1920
  const val MAX_HTML_CHARS = 4_000_000

  @SuppressLint("SetJavaScriptEnabled")
  @MainThread
  fun archive(context: Context, html: String, baseUrl: String, target: File, timeoutMs: Long, done: (Long) -> Unit) {
    val handler = Handler(Looper.getMainLooper())
    val view = try {
      WebView(context.applicationContext).also { WebProfiles.apply(it) }
    } catch (_: RuntimeException) {
      done(0L)
      return
    }
    var finished = false
    var saving = false
    fun finish(size: Long) {
      if (finished) return
      finished = true
      handler.removeCallbacksAndMessages(null)
      runCatching {
        view.stopLoading()
        view.destroy()
      }
      done(size)
    }
    fun save() {
      if (finished || saving) return
      saving = true
      target.parentFile?.mkdirs()
      try {
        view.saveWebArchive(target.path, false) { saved ->
          val file = saved?.let { File(it) }
          finish(if (file != null && file.isFile) file.length() else 0L)
        }
      } catch (_: RuntimeException) {
        finish(0L)
      }
    }
    view.settings.apply {
      javaScriptEnabled = false
      allowFileAccess = false
      allowContentAccess = false
      loadsImagesAutomatically = true
      mediaPlaybackRequiresUserGesture = true
    }
    view.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

      override fun onPageFinished(view: WebView, url: String?) {
        // Pictures and styles finish loading a little after the document.
        handler.postDelayed({ save() }, SETTLE_MS)
      }
    }
    // Laid out like a phone screen so lazy pictures near the top load too.
    view.measure(View.MeasureSpec.makeMeasureSpec(WIDTH, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(HEIGHT, View.MeasureSpec.EXACTLY))
    view.layout(0, 0, WIDTH, HEIGHT)
    // A page whose pictures never finish is saved as far as it got.
    handler.postDelayed({ save() }, timeoutMs)
    handler.postDelayed({ finish(0L) }, timeoutMs + 10_000L)
    try {
      view.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", baseUrl)
    } catch (_: RuntimeException) {
      finish(0L)
    }
  }
}
