package com.vidorax.media.library

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.NotFoundException
import com.vidorax.media.StorageException
import com.vidorax.media.StoragePermissionException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import kotlin.coroutines.resume

/**
 * Save cover image (#371): a library item's thumbnail saved as a JPEG in `Pictures/VidoraX`, so it appears in the
 * Gallery. The private thumbnail is only read. Android 10+: MediaStore, no permission. Android 7–9: the public
 * Pictures folder and a media scan, which needs WRITE_EXTERNAL_STORAGE (declared with maxSdkVersion 28 in the app
 * manifest) — rejected with ERR_STORAGE_PERMISSION when it is not granted. Resolves with the new item's URI.
 */
internal class ThumbnailExport(
  private val context: Context,
  private val library: LibraryStore,
) {
  suspend fun save(id: String): String {
    val item = library.get(id) ?: throw NotFoundException("Unknown library item $id")
    return withContext(Dispatchers.IO) {
      val thumbnail = item.thumbnail?.takeIf { it.isFile && it.length() > 0 }
        ?: throw NotFoundException("This video has no thumbnail")
      val bitmap = BitmapFactory.decodeFile(thumbnail.path) ?: throw StorageException("The thumbnail could not be read")
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) publish(bitmap, item.title) else writeLegacy(bitmap, item.title)
      } finally {
        bitmap.recycle()
      }
    }
  }

  /**
   * P10 Screenshot (#675): a frame of the video playing — expo-video's frame at the video's own size, handed over by
   * reference — saved the same way as a thumbnail: a JPEG in `Pictures/VidoraX`, the same permission rule, resolves with
   * the new item's URI. The bitmap belongs to the caller (expo-video) and is not recycled here.
   */
  suspend fun saveFrame(frame: Bitmap, title: String): String {
    if (frame.isRecycled || frame.width <= 0 || frame.height <= 0) throw InvalidRequestException("No frame to save")
    return withContext(Dispatchers.IO) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) publish(frame, title) else writeLegacy(frame, title)
    }
  }

  /**
   * P12 Create GIF (#676): a finished GIF file copied into `Pictures/VidoraX` as `image/gif` — the same folder and
   * permission rule as a thumbnail (MediaStore on Android 10+; the public folder and a media scan on 7–9, which needs
   * the storage permission). [gif] is only read. Resolves with the new item's URI.
   */
  suspend fun saveGif(gif: File, title: String): String {
    if (!gif.isFile || gif.length() == 0L) throw StorageException("There is no GIF to save")
    return withContext(Dispatchers.IO) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) publishFile(gif, title) else writeLegacyFile(gif, title)
    }
  }

  /** P12: false on Android 9 and older without the storage permission, where saving to the Gallery is refused. */
  fun canSaveToGallery(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun publishFile(file: File, title: String): String {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, galleryFileName(title, GIF_EXTENSION))
      put(MediaStore.MediaColumns.TITLE, Titles.clamp(title))
      put(MediaStore.MediaColumns.MIME_TYPE, GIF_MIME)
      put(MediaStore.MediaColumns.RELATIVE_PATH, "$PICTURES_FOLDER/")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val uri = resolver.insert(collection, values) ?: throw IOException("MediaStore did not create an image")
    try {
      resolver.openOutputStream(uri, "w")?.use { out -> file.inputStream().use { it.copyTo(out) } }
        ?: throw IOException("MediaStore did not open the new image")
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      runCatching { resolver.delete(uri, null, null) }
      throw e
    }
    return uri.toString()
  }

  private suspend fun writeLegacyFile(file: File, title: String): String {
    if (!canSaveToGallery()) {
      throw StoragePermissionException("Saving to the gallery needs the storage permission on Android 9 and older")
    }
    @Suppress("DEPRECATION")
    val folder = File(Environment.getExternalStorageDirectory(), PICTURES_FOLDER)
    if (!folder.isDirectory && !folder.mkdirs()) throw IOException("Could not create $folder")
    val target = generateSequence(1) { it + 1 }
      .map { copy -> File(folder, galleryFileName(title, GIF_EXTENSION, copy)) }
      .first { !it.exists() }
    try {
      file.copyTo(target, overwrite = false)
    } catch (e: Exception) {
      target.delete()
      throw e
    }
    return suspendCancellableCoroutine { continuation ->
      MediaScannerConnection.scanFile(context, arrayOf(target.path), arrayOf(GIF_MIME)) { _, uri ->
        continuation.resume(uri?.toString() ?: target.toURI().toString())
      }
    }
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun publish(bitmap: Bitmap, title: String): String {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, galleryFileName(title, JPEG_EXTENSION))
      put(MediaStore.MediaColumns.TITLE, Titles.clamp(title))
      put(MediaStore.MediaColumns.MIME_TYPE, JPEG_MIME)
      put(MediaStore.MediaColumns.RELATIVE_PATH, "$PICTURES_FOLDER/")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    val uri = resolver.insert(collection, values) ?: throw IOException("MediaStore did not create an image")
    try {
      val written = resolver.openOutputStream(uri, "w")?.use { bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
        ?: throw IOException("MediaStore did not open the new image")
      if (!written) throw IOException("The thumbnail could not be encoded")
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      runCatching { resolver.delete(uri, null, null) }
      throw e
    }
    return uri.toString()
  }

  private suspend fun writeLegacy(bitmap: Bitmap, title: String): String {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
      throw StoragePermissionException("Saving to the gallery needs the storage permission on Android 9 and older")
    }
    @Suppress("DEPRECATION")
    val folder = File(Environment.getExternalStorageDirectory(), PICTURES_FOLDER)
    if (!folder.isDirectory && !folder.mkdirs()) throw IOException("Could not create $folder")
    val target = generateSequence(1) { it + 1 }
      .map { copy -> File(folder, galleryFileName(title, JPEG_EXTENSION, copy)) }
      .first { !it.exists() }
    try {
      val written = target.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
      if (!written) throw IOException("The thumbnail could not be encoded")
    } catch (e: Exception) {
      target.delete()
      throw e
    }
    return suspendCancellableCoroutine { continuation ->
      MediaScannerConnection.scanFile(context, arrayOf(target.path), arrayOf(JPEG_MIME)) { _, uri ->
        continuation.resume(uri?.toString() ?: target.toURI().toString())
      }
    }
  }

  private companion object {
    const val PICTURES_FOLDER = "Pictures/VidoraX"
    const val JPEG_EXTENSION = "jpg"
    const val JPEG_MIME = "image/jpeg"
    const val JPEG_QUALITY = 92

    // P12 Create GIF.
    const val GIF_EXTENSION = GifExport.GIF_EXTENSION
    const val GIF_MIME = GifExport.GIF_MIME
  }
}
