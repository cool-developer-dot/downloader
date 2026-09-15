package com.vidorax.media.library

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.os.Build
import java.io.File
import java.io.IOException
import kotlin.math.roundToInt

/** WebP thumbnails in `filesDir/thumbs/<id>.webp`. Blocking: call from an IO thread. */
class Thumbnails(private val paths: StoragePaths) {
  @Suppress("DEPRECATION")
  private val format =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP

  /** Writes the thumbnail of [id] and returns it, or null when [file] has no decodable frame (audio, corrupt). */
  fun create(id: String, file: File, metadata: MediaMetadata): File? {
    val frame = decodeFrame(file, metadata) ?: return null
    val target = paths.thumbnailFile(id)
    // Written aside and renamed, so a reader never sees a half-written image.
    val temp = File(target.path + ".tmp")
    return try {
      target.parentFile?.mkdirs()
      val written = temp.outputStream().use { frame.compress(format, QUALITY, it) }
      target.takeIf { written && temp.renameTo(it) }
    } catch (e: IOException) {
      null
    } finally {
      frame.recycle()
      temp.delete()
    }
  }

  private fun decodeFrame(file: File, metadata: MediaMetadata): Bitmap? {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(file.path)
      val timeUs = thumbnailFrameTimeMs(metadata.durationMs) * 1_000
      val size = thumbnailSize(metadata.width, metadata.height)
      val frame = if (size != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        // Decodes at the small size directly instead of allocating a full-resolution bitmap first.
        retriever.getScaledFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, size.first, size.second)
      } else {
        retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
      }
      (frame ?: retriever.frameAtTime)?.let(::fitWidth)
    } catch (e: RuntimeException) {
      null
    } finally {
      retriever.release()
    }
  }

  private fun fitWidth(frame: Bitmap): Bitmap {
    val size = thumbnailSize(frame.width, frame.height) ?: return frame
    if (size.first == frame.width) return frame
    return Bitmap.createScaledBitmap(frame, size.first, size.second, true).also { frame.recycle() }
  }

  private companion object {
    const val QUALITY = 80
  }
}

internal const val THUMBNAIL_WIDTH = 480

/** 10% into the media to skip black intros, at least 1 s in, and inside media shorter than that. */
internal fun thumbnailFrameTimeMs(durationMs: Long?): Long {
  if (durationMs == null || durationMs <= 0) return 1_000
  val time = maxOf(durationMs / 10, 1_000)
  return if (time < durationMs) time else durationMs / 2
}

/** [THUMBNAIL_WIDTH] wide with the aspect ratio kept; smaller frames are not enlarged. */
internal fun thumbnailSize(width: Int?, height: Int?): Pair<Int, Int>? {
  if (width == null || height == null || width <= 0 || height <= 0) return null
  val targetWidth = minOf(width, THUMBNAIL_WIDTH)
  return targetWidth to maxOf(1, (height.toDouble() * targetWidth / width).roundToInt())
}
