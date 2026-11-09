package com.vidorax.web.capture

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.annotation.MainThread
import com.vidorax.web.snapshot.WebViewSnapshots
import java.io.File
import kotlin.math.ceil
import kotlin.math.roundToInt

/**
 * B17 #175 — the whole page as one picture, by **stitching scrolled captures**: the page is scrolled one screen at a
 * time, each screen drawn with B1's snapshot drawing, and the scroll put back. Chosen over
 * `WebView.enableSlowWholeDocumentDraw()`, which must be called before any WebView exists and makes every WebView in
 * the app draw its whole document (slower scrolling and more memory for every tab). Limits (documented): the page
 * visibly scrolls during the capture; sticky headers appear in each screen; a page that scrolls an inner element
 * reports only its visible height ("single").
 */
internal object FullPageCapture {
  /** The tallest picture made (after scaling): about 34 MB at 720 px wide. */
  const val MAX_HEIGHT = 12_000
  const val SETTLE_MS = 220L

  sealed interface Plan {
    /** Scroll offsets in view pixels, and the output size. */
    data class Slices(val offsets: List<Int>, val outWidth: Int, val outHeight: Int, val scale: Float) : Plan
    /** The page is no taller than the screen: only what is visible. */
    data object Single : Plan
    data object TooLong : Plan
  }

  /**
   * [contentHeightPx] = CSS content height × the WebView's scale (density × zoom); [viewWidth] / [viewHeight] the
   * WebView's size; the output is scaled down to [maxWidth].
   */
  fun plan(contentHeightPx: Int, viewWidth: Int, viewHeight: Int, maxWidth: Int): Plan {
    if (viewWidth <= 0 || viewHeight <= 0 || contentHeightPx <= 0) return Plan.Single
    if (contentHeightPx <= viewHeight + 2) return Plan.Single
    val scale = minOf(1f, maxWidth.toFloat() / viewWidth)
    val outHeight = (contentHeightPx * scale).roundToInt()
    if (outHeight > MAX_HEIGHT) return Plan.TooLong
    val count = ceil(contentHeightPx.toDouble() / viewHeight).toInt()
    val offsets = (0 until count).map { minOf(it * viewHeight, contentHeightPx - viewHeight) }.distinct()
    return Plan.Slices(offsets, (viewWidth * scale).roundToInt(), outHeight, scale)
  }

  @Suppress("DEPRECATION") // WebView.scale is the content scale (density × zoom); there is no replacement.
  fun contentHeightPx(webView: WebView): Int = (webView.contentHeight * webView.scale).roundToInt()

  data class Result(val status: String, val file: File? = null, val width: Int = 0, val height: Int = 0)

  /** Captures, writes a JPEG to [target] and calls [done] on the main thread; restores the scroll position. */
  @MainThread
  fun capture(webView: WebView, maxWidth: Int, target: File, done: (Result) -> Unit) {
    when (val plan = plan(contentHeightPx(webView), webView.width, webView.height, maxWidth)) {
      Plan.TooLong -> done(Result("tooLong"))
      Plan.Single -> {
        val shot = WebViewSnapshots.capture(webView, maxWidth) ?: return done(Result("failed"))
        val ok = WebViewSnapshots.writeJpeg(shot, target)
        done(if (ok) Result("single", target, shot.width, shot.height) else Result("failed"))
        shot.recycle()
      }
      is Plan.Slices -> stitch(webView, plan, maxWidth, target, done)
    }
  }

  private fun stitch(webView: WebView, plan: Plan.Slices, maxWidth: Int, target: File, done: (Result) -> Unit) {
    val out = try {
      Bitmap.createBitmap(plan.outWidth, plan.outHeight, Bitmap.Config.ARGB_8888)
    } catch (_: OutOfMemoryError) {
      return done(Result("tooLong"))
    }
    val canvas = Canvas(out).apply { drawColor(Color.WHITE) }
    val startX = webView.scrollX
    val startY = webView.scrollY
    val handler = Handler(Looper.getMainLooper())
    fun finish(result: Result) {
      webView.scrollTo(startX, startY)
      out.recycle()
      done(result)
    }
    fun step(index: Int) {
      if (!webView.isAttachedToWindow) return finish(Result("failed"))
      if (index >= plan.offsets.size) {
        val ok = WebViewSnapshots.writeJpeg(out, target)
        return finish(if (ok) Result("ok", target, plan.outWidth, plan.outHeight) else Result("failed"))
      }
      webView.scrollTo(0, plan.offsets[index])
      handler.postDelayed({
        if (!webView.isAttachedToWindow) return@postDelayed finish(Result("failed"))
        val slice = WebViewSnapshots.capture(webView, maxWidth) ?: return@postDelayed finish(Result("failed"))
        canvas.drawBitmap(slice, 0f, plan.offsets[index] * plan.scale, null)
        slice.recycle()
        step(index + 1)
      }, SETTLE_MS)
    }
    step(0)
  }
}
