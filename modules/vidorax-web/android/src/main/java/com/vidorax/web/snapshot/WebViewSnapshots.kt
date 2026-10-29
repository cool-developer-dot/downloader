package com.vidorax.web.snapshot

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.view.View
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * B1 #14 Tab preview. A tab's WebView is drawn into a small bitmap (main thread) and saved as a JPEG in
 * `<cacheDir>/tab-previews/` (off the main thread). Contract: `snapshotWebView` in modules/vidorax-web/src/VidoraWeb.types.ts.
 */
object WebViewSnapshots {
  const val DIRECTORY = "tab-previews"
  const val MIN_WIDTH = 64
  const val MAX_WIDTH = 1080
  const val JPEG_QUALITY = 72

  private val SAFE_KEY = Regex("^[A-Za-z0-9_-]{1,64}$")

  data class Size(val width: Int, val height: Int, val scale: Float)

  /** A key JS may name a file with: no path separators, dots or anything else. */
  fun isSafeKey(key: String): Boolean = SAFE_KEY.matches(key)

  /**
   * The bitmap size for a view of `viewWidth` × `viewHeight`: at most `maxWidth` (clamped to 64–1080) wide, never
   * wider than the view, aspect ratio kept. Null when the view has no size.
   */
  fun targetSize(viewWidth: Int, viewHeight: Int, maxWidth: Int): Size? {
    if (viewWidth <= 0 || viewHeight <= 0) return null
    val limit = maxWidth.coerceIn(MIN_WIDTH, MAX_WIDTH)
    val width = min(viewWidth, limit)
    val scale = width.toFloat() / viewWidth
    val height = max(1, (viewHeight * scale).roundToInt())
    return Size(width, height, scale)
  }

  /** Draws what `view` shows now (its scroll position included). Main thread only. */
  fun capture(view: View, maxWidth: Int): Bitmap? {
    val size = targetSize(view.width, view.height, maxWidth) ?: return null
    val bitmap = try {
      Bitmap.createBitmap(size.width, size.height, Bitmap.Config.ARGB_8888)
    } catch (_: OutOfMemoryError) {
      return null
    }
    val canvas = Canvas(bitmap)
    canvas.drawColor(Color.WHITE)
    canvas.scale(size.scale, size.scale)
    // View.draw paints at the content's own coordinates; a parent would undo the scroll offset, so do it here.
    canvas.translate(-view.scrollX.toFloat(), -view.scrollY.toFloat())
    view.draw(canvas)
    return bitmap
  }

  /** Writes `bitmap` as JPEG to `target` through a temporary file, so a reader never sees half a file. */
  fun writeJpeg(bitmap: Bitmap, target: File, quality: Int = JPEG_QUALITY): Boolean {
    val dir = target.parentFile ?: return false
    if (!dir.isDirectory && !dir.mkdirs()) return false
    val temp = File(dir, "${target.name}.tmp")
    val ok = try {
      FileOutputStream(temp).use { out -> bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(1, 100), out) }
    } catch (_: Exception) {
      false
    }
    if (!ok || !temp.renameTo(target)) {
      temp.delete()
      return false
    }
    return true
  }

  fun fileFor(cacheDir: File, key: String): File = File(File(cacheDir, DIRECTORY), "$key.jpg")
}
