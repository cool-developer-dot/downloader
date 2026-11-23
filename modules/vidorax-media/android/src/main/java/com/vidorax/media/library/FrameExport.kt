package com.vidorax.media.library

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.subtitles.SubtitleExport
import java.io.File
import java.io.IOException

/**
 * P10 Screenshot (#675), Share: the frame the user just saved (expo-video's full-size frame, still held by JavaScript)
 * written once more as a JPEG to one private file, `files/library/.frame-exports/<title>.jpg`, and handed to the share
 * sheet through the module's FileProvider — the same way subtitle files are shared ([SubtitleExport.share]). The Gallery
 * copy is not shared: on Android 9 and older its URI can be a `file://` one, which Android refuses to share. Only the
 * latest share copy is kept; the bitmap belongs to the caller and is never recycled here.
 */
internal object FrameExport {
  private const val FOLDER = ".frame-exports"
  private const val JPEG_EXTENSION = "jpg"
  const val JPEG_MIME = "image/jpeg"
  const val JPEG_QUALITY = 92

  fun writeShareCopy(paths: StoragePaths, frame: Bitmap, title: String): File {
    if (frame.isRecycled || frame.width <= 0 || frame.height <= 0) throw InvalidRequestException("No frame to share")
    val folder = File(paths.libraryDir, FOLDER)
    folder.listFiles()?.forEach { it.delete() }
    if (!folder.isDirectory && !folder.mkdirs()) throw IOException("Could not create $folder")
    val file = File(folder, galleryFileName(Titles.clamp(title), JPEG_EXTENSION))
    try {
      val written = file.outputStream().use { frame.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
      if (!written) throw IOException("The frame could not be encoded")
    } catch (e: Exception) {
      file.delete()
      throw e
    }
    return file
  }

  /** Call on the main thread. */
  fun share(context: Context, activity: Activity?, file: File) {
    SubtitleExport.share(context, activity, file, JPEG_MIME)
  }
}
