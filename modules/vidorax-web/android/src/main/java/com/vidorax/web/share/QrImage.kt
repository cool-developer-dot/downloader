package com.vidorax.web.share

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream

/**
 * B22 #249 — the page's QR code as a PNG, drawn from the module matrix JS computed (rows of '1' / '0'), with a white
 * quiet zone. Shared from the app's cache through [WebFileProvider], or saved to Pictures/VidoraX through MediaStore —
 * only on Android 10+, where that needs no permission (JS offers Share only below).
 */
internal object QrImage {
  const val QUIET = 4
  private const val MAX_MODULES = 177 // QR version 40
  const val DIR = "qr"

  /** Null for anything that isn't a square of '0' / '1' between 21 and 177 modules. */
  fun render(rows: List<String>, scale: Int): Bitmap? {
    val n = rows.size
    if (n < 21 || n > MAX_MODULES || rows.any { it.length != n || it.any { c -> c != '0' && c != '1' } }) return null
    val s = scale.coerceIn(2, 16)
    val size = (n + QUIET * 2) * s
    val pixels = IntArray(size * size) { Color.WHITE }
    for (y in 0 until n) {
      for (x in 0 until n) {
        if (rows[y][x] != '1') continue
        for (dy in 0 until s) {
          val row = ((y + QUIET) * s + dy) * size
          for (dx in 0 until s) pixels[row + (x + QUIET) * s + dx] = Color.BLACK
        }
      }
    }
    return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
  }

  /** Writes the PNG into `<cacheDir>/qr/` (older ones deleted) and returns it. */
  fun writeToCache(context: Context, bitmap: Bitmap): File {
    val dir = File(context.cacheDir, DIR).apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, "vidorax-qr-${System.currentTimeMillis()}.png")
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    return file
  }

  fun canSaveToGallery(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

  /** Android 10+: Pictures/VidoraX through MediaStore (no permission). False below, or when it fails. */
  fun saveToGallery(context: Context, bitmap: Bitmap, name: String): Boolean {
    if (!canSaveToGallery()) return false
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Images.Media.DISPLAY_NAME, name)
      put(MediaStore.Images.Media.MIME_TYPE, "image/png")
      put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/VidoraX")
      put(MediaStore.Images.Media.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
    return try {
      resolver.openOutputStream(uri)?.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } ?: return false
      resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
      true
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      false
    }
  }
}
