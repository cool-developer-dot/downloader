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
  }
}
