package com.vidorax.web.pdf

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * B17 #264 — the in-app PDF viewer's renderer: Android's `PdfRenderer` (no library). A document is opened once (every
 * page's size read then, so the list's layout is fixed), and pages are drawn one at a time **when the list asks**
 * (lazy: a 50-page file draws only the pages on screen), as PNG files in `<cache>/pdf-pages/`. One page may be open
 * per renderer, so every call on a document is serialised. Widths are capped (zoom re-renders wider, up to 2,400 px).
 */
internal object PdfDocuments {
  const val PAGES_DIR = "pdf-pages"
  const val MAX_WIDTH = 2400
  const val MAX_HEIGHT = 4000

  private class Doc(val fd: ParcelFileDescriptor, val renderer: PdfRenderer)

  private val docs = HashMap<Int, Doc>()
  private val next = AtomicInteger(1)

  sealed interface Open {
    data class Ok(val id: Int, val pages: List<Pair<Int, Int>>) : Open
    data object Protected : Open
    data object Failed : Open
  }

  fun open(file: File): Open {
    val fd = try {
      ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    } catch (_: Exception) {
      return Open.Failed
    }
    val renderer = try {
      PdfRenderer(fd)
    } catch (_: SecurityException) {
      fd.close()
      return Open.Protected
    } catch (_: Exception) {
      fd.close()
      return Open.Failed
    }
    val sizes = synchronized(renderer) {
      (0 until renderer.pageCount).map { i -> renderer.openPage(i).use { it.width to it.height } }
    }
    val id = next.getAndIncrement()
    synchronized(docs) { docs[id] = Doc(fd, renderer) }
    return Open.Ok(id, sizes)
  }

  /** The bitmap size for a page of [pageW] × [pageH] points drawn [width] px wide (capped). */
  fun renderSize(pageW: Int, pageH: Int, width: Int): Pair<Int, Int> {
    if (pageW <= 0 || pageH <= 0) return 1 to 1
    var w = width.coerceIn(1, MAX_WIDTH)
    var h = (w.toLong() * pageH / pageW).toInt()
    if (h > MAX_HEIGHT) {
      h = MAX_HEIGHT
      w = (h.toLong() * pageW / pageH).toInt().coerceAtLeast(1)
    }
    return w to h.coerceAtLeast(1)
  }

  fun pageFile(cacheDir: File, id: Int, index: Int, width: Int): File = File(File(cacheDir, PAGES_DIR), "$id-$index-$width.png")

  /** Draws page [index] [width] px wide into a PNG (reused when it already exists). Blocking; off the main thread. */
  fun render(cacheDir: File, id: Int, index: Int, width: Int): File? {
    val doc = synchronized(docs) { docs[id] } ?: return null
    val target = pageFile(cacheDir, id, index, width.coerceIn(1, MAX_WIDTH))
    if (target.isFile) return target
    return synchronized(doc.renderer) {
      if (index !in 0 until doc.renderer.pageCount) return@synchronized null
      doc.renderer.openPage(index).use { page ->
        val (w, h) = renderSize(page.width, page.height, width)
        val bitmap = try {
          Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        } catch (_: OutOfMemoryError) {
          return@synchronized null
        }
        bitmap.eraseColor(Color.WHITE)
        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        target.parentFile?.mkdirs()
        target.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        target
      }
    }
  }

  fun close(cacheDir: File, id: Int) {
    val doc = synchronized(docs) { docs.remove(id) } ?: return
    synchronized(doc.renderer) {
      try {
        doc.renderer.close()
        doc.fd.close()
      } catch (_: Exception) {
        // already closed
      }
    }
    File(cacheDir, PAGES_DIR).listFiles()?.filter { it.name.startsWith("$id-") }?.forEach { it.delete() }
  }
}
