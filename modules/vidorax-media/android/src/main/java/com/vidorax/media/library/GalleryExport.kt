package com.vidorax.media.library

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.BaseColumns
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import com.vidorax.media.StorageException
import com.vidorax.media.StoragePermissionException
import com.vidorax.media.model.LibraryChange
import com.vidorax.media.model.LibraryChangeReason
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.SiteId
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume

/**
 * Publishes copies of library items to shared storage in `Movies/VidoraX/<Site>` (audio-only items in
 * `Music/VidoraX/<Site>`). The private file remains the library's copy. Gallery copies are never deleted here: the
 * only item this class ever removes is the pending one it has just inserted.
 */
class GalleryExport internal constructor(
  private val context: Context,
  private val library: LibraryStore,
) {
  // One export at a time, so a repeated tap reuses the first copy instead of racing it into a duplicate.
  private val mutex = Mutex()

  /** Saves every item and records its copy. Rejects with ERR_NOT_FOUND for an unknown id or a missing file. */
  suspend fun save(ids: List<String>) {
    val saved = mutableListOf<String>()
    try {
      for (item in library.requireFiles(ids)) {
        val uri = save(item) ?: continue
        library.setGalleryUri(item.id, uri, announce = false)
        saved += item.id
      }
    } finally {
      library.announce(LibraryChange(LibraryChangeReason.UPDATED, saved))
    }
  }

  /**
   * Publishes one item and returns the `content://` URI of its copy, or null when the Android 7-9 media scanner did
   * not index it. A copy saved earlier that still exists is reused. The caller records the URI.
   */
  suspend fun save(item: LibraryItem): String? = mutex.withLock {
    try {
      withContext(Dispatchers.IO) {
        val existing = item.galleryUri?.takeIf(::exists)
        when {
          existing != null -> existing
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> publish(item)
          else -> copyToPublicFolder(item)
        }
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: CodedException) {
      throw e
    } catch (e: Exception) {
      throw StorageException("Could not save ${item.id} to the gallery", e)
    }
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun publish(item: LibraryItem): String {
    val resolver = context.contentResolver
    val audioOnly = item.isAudioOnly
    val collection = if (audioOnly) {
      MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    } else {
      MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    }
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, galleryFileName(item.title, item.file.extension))
      put(MediaStore.MediaColumns.MIME_TYPE, item.mimeType)
      put(MediaStore.MediaColumns.RELATIVE_PATH, galleryFolder(audioOnly, item.site) + "/")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = resolver.insert(collection, values) ?: throw IOException("MediaStore did not create an item")
    try {
      val copied = resolver.openOutputStream(uri, "w")?.use { output ->
        item.file.inputStream().use { it.copyTo(output, COPY_BUFFER_BYTES) }
      } ?: throw IOException("MediaStore did not open the new item")
      requireComplete(copied, item.file)
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      runCatching { resolver.delete(uri, null, null) }
      throw e
    }
    return uri.toString()
  }

  private suspend fun copyToPublicFolder(item: LibraryItem): String? {
    val permission = ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE)
    if (permission != PackageManager.PERMISSION_GRANTED) {
      throw StoragePermissionException("Saving to the gallery needs the storage permission on Android 9 and older")
    }
    @Suppress("DEPRECATION")
    val folder = File(Environment.getExternalStorageDirectory(), galleryFolder(item.isAudioOnly, item.site))
    if (!folder.isDirectory && !folder.mkdirs()) throw IOException("Could not create $folder")
    val target = generateSequence(1) { it + 1 }
      .map { copy -> File(folder, galleryFileName(item.title, item.file.extension, copy)) }
      .first { !it.exists() }
    try {
      val copied = item.file.inputStream().use { input ->
        target.outputStream().use { input.copyTo(it, COPY_BUFFER_BYTES) }
      }
      requireComplete(copied, item.file)
    } catch (e: Exception) {
      target.delete()
      throw e
    }
    return scan(target, item.mimeType)
  }

  private suspend fun scan(file: File, mimeType: String): String? = suspendCancellableCoroutine { continuation ->
    MediaScannerConnection.scanFile(context, arrayOf(file.path), arrayOf(mimeType)) { _, uri ->
      continuation.resume(uri?.toString())
    }
  }

  private fun exists(uri: String): Boolean = try {
    context.contentResolver.query(Uri.parse(uri), arrayOf(BaseColumns._ID), null, null, null)
      ?.use { it.moveToFirst() } == true
  } catch (e: RuntimeException) {
    // Not readable any more (reinstall, revoked permission): save a fresh copy.
    false
  }

  private fun requireComplete(copied: Long, source: File) {
    if (copied != source.length()) throw IOException("Copied $copied of ${source.length()} bytes")
  }

  private val LibraryItem.isAudioOnly: Boolean get() = mimeType.startsWith("audio/")

  private companion object {
    const val COPY_BUFFER_BYTES = 1 shl 16
  }
}

/** Folder under shared storage, e.g. `Movies/VidoraX/Instagram` (the values of Environment.DIRECTORY_MOVIES/MUSIC). */
internal fun galleryFolder(audioOnly: Boolean, site: SiteId): String =
  "${if (audioOnly) "Music" else "Movies"}/VidoraX/${site.folderName}"

/** `<Safe Title>.<ext>`, or `<Safe Title> (<copy>).<ext>` when [copy] is above 1. */
internal fun galleryFileName(title: String, extension: String, copy: Int = 1): String {
  val suffix = if (copy > 1) " ($copy)" else ""
  return "${FileNames.safeTitle(title)}$suffix.${FileNames.safeExtension(extension)}"
}
