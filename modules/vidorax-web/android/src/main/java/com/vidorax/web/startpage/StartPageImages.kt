package com.vidorax.web.startpage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream

/**
 * B21 #245 — the start page's background photo, copied into the app's own storage (`<filesDir>/start-page/`) and
 * scaled so its longer side is at most `maxSize` pixels: the picked original is never kept open or referenced, and a
 * huge camera photo doesn't cost memory on every start page. Turned upright from its EXIF orientation. One file at a
 * time: writing a new one deletes the others (each has a new name, so image caches can't show the old one).
 */
object StartPageImages {
  const val DIRECTORY = "start-page"
  const val DEFAULT_MAX_SIZE = 1920
  private const val MIN_MAX_SIZE = 480
  private const val MAX_MAX_SIZE = 2560
  private const val JPEG_QUALITY = 85
  private const val FILE_PREFIX = "background-"

  data class Saved(val file: File, val width: Int, val height: Int)

  fun clampMaxSize(maxSize: Int): Int = maxSize.coerceIn(MIN_MAX_SIZE, MAX_MAX_SIZE)

  /** The largest power-of-two step that still leaves the longer side at least `maxSize` (BitmapFactory's inSampleSize). */
  fun sampleSize(width: Int, height: Int, maxSize: Int): Int {
    if (width <= 0 || height <= 0 || maxSize <= 0) return 1
    val longer = maxOf(width, height)
    var sample = 1
    while (longer / (sample * 2) >= maxSize) sample *= 2
    return sample
  }

  /** The size that fits `maxSize` on the longer side, aspect kept, never larger than the source. */
  fun fitWithin(width: Int, height: Int, maxSize: Int): Pair<Int, Int> {
    if (width <= 0 || height <= 0) return 0 to 0
    val longer = maxOf(width, height)
    if (longer <= maxSize) return width to height
    val scale = maxSize.toDouble() / longer
    return maxOf(1, Math.round(width * scale).toInt()) to maxOf(1, Math.round(height * scale).toInt())
  }

  /** Degrees to turn a photo upright for its EXIF orientation (mirrored orientations are treated as their rotation). */
  fun rotationFor(orientation: Int): Int = when (orientation) {
    ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_TRANSPOSE -> 90
    ExifInterface.ORIENTATION_ROTATE_180, ExifInterface.ORIENTATION_FLIP_VERTICAL -> 180
    ExifInterface.ORIENTATION_ROTATE_270, ExifInterface.ORIENTATION_TRANSVERSE -> 270
    else -> 0
  }

  fun fileName(nowMs: Long): String = "$FILE_PREFIX$nowMs.jpg"

  /**
   * Reads the picked image (`open` gives a fresh stream each call), writes the scaled, upright JPEG into `directory`
   * and deletes the older backgrounds there. Null when it isn't a readable image or can't be written.
   * `readOrientation` gives the EXIF orientation (tests pass their own).
   */
  fun copyScaled(
    open: () -> InputStream?,
    directory: File,
    maxSize: Int,
    nowMs: Long,
    readOrientation: (() -> InputStream?) -> Int = ::exifOrientation,
  ): Saved? {
    val limit = clampMaxSize(maxSize)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    readQuietly(open) { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    val options = BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, limit) }
    val decoded = readQuietly(open) { BitmapFactory.decodeStream(it, null, options) } ?: return null
    val rotation = rotationFor(readOrientation(open))

    val upright = transform(decoded, rotation, limit)
    if (upright !== decoded) decoded.recycle()
    try {
      if (!directory.isDirectory && !directory.mkdirs()) return null
      val name = fileName(nowMs)
      val target = File(directory, name)
      val temp = File(directory, "$name.tmp")
      val written = try {
        FileOutputStream(temp).use { upright.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
      } catch (_: IOException) {
        false
      }
      if (!written || !temp.renameTo(target)) {
        temp.delete()
        return null
      }
      directory.listFiles()?.forEach { if (it.name != name) it.delete() }
      return Saved(target, upright.width, upright.height)
    } finally {
      upright.recycle()
    }
  }

  /** Removes the background photo (Browser settings → Start page → back to the theme). */
  fun clear(directory: File): Boolean {
    if (!directory.exists()) return true
    return directory.listFiles()?.all { it.delete() } ?: true
  }

  /** The EXIF orientation of the image (`ExifInterface(InputStream)`, API 24+); 0 when it has none. */
  fun exifOrientation(open: () -> InputStream?): Int =
    readQuietly(open) { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, 0) } ?: 0

  private fun transform(source: Bitmap, rotation: Int, maxSize: Int): Bitmap {
    val turned = rotation == 90 || rotation == 270
    val (w, h) = if (turned) source.height to source.width else source.width to source.height
    val (targetW, targetH) = fitWithin(w, h, maxSize)
    if (rotation == 0 && targetW == source.width && targetH == source.height) return source
    val matrix = Matrix()
    if (rotation != 0) matrix.postRotate(rotation.toFloat())
    matrix.postScale(targetW.toFloat() / w, targetH.toFloat() / h)
    return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
  }

  private fun <T> readQuietly(open: () -> InputStream?, read: (InputStream) -> T): T? =
    try {
      open()?.use(read)
    } catch (_: IOException) {
      null
    } catch (_: SecurityException) {
      null
    } catch (_: OutOfMemoryError) {
      null
    }
}
