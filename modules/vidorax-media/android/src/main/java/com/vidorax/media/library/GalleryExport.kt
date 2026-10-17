package com.vidorax.media.library

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
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
 * `Music/VidoraX/<Site>`), so they appear in the device's Gallery/Photos app. The private file remains the library's
 * copy. Gallery copies are never deleted here: the only items this class ever removes are pending ones it inserted
 * itself and never finished.
 *
 * Idempotent: an item is copied at most once. A copy recorded on the item is reused while it exists, and before
 * publishing, VidoraX's own gallery folder is searched for a copy with exactly the same bytes (same size, then the
 * same SHA-256) — so a process death between publishing and recording, a repeated tap or an automatic export racing
 * a manual one never leaves `video (1).mp4` beside `video.mp4`.
 */
class GalleryExport internal constructor(
  private val context: Context,
  private val library: LibraryStore,
  private val now: () -> Long = System::currentTimeMillis,
) {
  // One export at a time, so a repeated tap reuses the first copy instead of racing it into a duplicate.
  private val mutex = Mutex()

  /** Saves every item and records its copy. Rejects with ERR_NOT_FOUND for an unknown id or a missing file. */
  suspend fun save(ids: List<String>) {
    val saved = mutableListOf<String>()
    try {
      for (item in library.requireFiles(ids)) {
        val uri = save(item) ?: continue
        library.recordGalleryCopy(item.id, uri, item.identityKey, now(), announce = false)
        saved += item.id
      }
    } finally {
      library.announce(LibraryChange(LibraryChangeReason.UPDATED, saved))
    }
  }

  /**
   * The automatic copy of a download that just completed. Never throws: the library item stays whatever happens to
   * the copy (a failure is recorded on the item as `failed`, a process death leaves it `pending` for [resumePending]).
   */
  suspend fun publishCompleted(id: String) {
    try {
      val item = library.get(id) ?: return
      if (!item.file.isFile) {
        library.setGalleryState(id, null)
        return
      }
      val uri = save(item)
      if (uri != null) {
        library.recordGalleryCopy(id, uri, item.identityKey, now())
      } else {
        library.setGalleryState(id, LibraryStore.GALLERY_FAILED)
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      runCatching { library.setGalleryState(id, LibraryStore.GALLERY_FAILED) }
    }
  }

  /**
   * After a restart: removes half-written gallery items a process death left behind (Android 10+ keeps them hidden
   * as pending), then makes the automatic copies that were still owed.
   */
  suspend fun resumePending() {
    mutex.withLock {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        runCatching { withContext(Dispatchers.IO) { deleteOwnPendingItems() } }
      }
    }
    for (id in runCatching { library.pendingGalleryIds() }.getOrDefault(emptyList())) publishCompleted(id)
  }

  /**
   * Publishes one item and returns the `content://` URI of its copy, or null when the Android 7-9 media scanner did
   * not index it. A copy saved earlier that still exists is reused. The caller records the URI.
   */
  suspend fun save(item: LibraryItem): String? = mutex.withLock {
    try {
      withContext(Dispatchers.IO) {
        item.galleryUri?.takeIf(::exists)
          ?: findSameContent(item.file, item.isAudioOnly)
          ?: if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) publish(item) else copyToPublicFolder(item)
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: CodedException) {
      throw e
    } catch (e: Exception) {
      throw StorageException("Could not save ${item.id} to the gallery", e)
    }
  }

  /**
   * A copy in VidoraX's own gallery folders with exactly the bytes of [file]: same size first (a query), then the same
   * SHA-256. [sha256] is computed only when a candidate of that size exists. Null when there is none, or when the
   * folders cannot be read (no permission on Android 9 and older).
   */
  internal fun findSameContent(file: File, audioOnly: Boolean, sha256: () -> String = { ContentHash.sha256(file) }): String? {
    val size = file.length()
    if (size <= 0) return null
    val candidates = runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ownItemsOfSize(audioOnly, size) else publicFilesOfSize(audioOnly, size)
    }.getOrDefault(emptyList())
    if (candidates.isEmpty()) return null
    val ours = sha256()
    for (candidate in candidates) {
      val theirs = runCatching {
        when (candidate) {
          is Candidate.Item -> context.contentResolver.openInputStream(candidate.uri)?.use(ContentHash::sha256)
          is Candidate.PublicFile -> ContentHash.sha256(candidate.file)
        }
      }.getOrNull() ?: continue
      if (theirs != ours) continue
      return when (candidate) {
        is Candidate.Item -> candidate.uri.toString()
        // Android 7-9: the file is ours and in place; the scanner gives (or re-gives) its content URI.
        is Candidate.PublicFile -> runCatching { scanBlocking(candidate.file) }.getOrNull()
      }
    }
    return null
  }

  private sealed interface Candidate {
    class Item(val uri: Uri) : Candidate
    class PublicFile(val file: File) : Candidate
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun ownItemsOfSize(audioOnly: Boolean, size: Long): List<Candidate> {
    val collection = collection(audioOnly)
    val selection = "${MediaStore.MediaColumns.SIZE} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?"
    val args = arrayOf(size.toString(), "${galleryRoot(audioOnly)}/%")
    return context.contentResolver.query(collection, arrayOf(BaseColumns._ID), selection, args, null)?.use { cursor ->
      buildList { while (cursor.moveToNext()) add(Candidate.Item(ContentUris.withAppendedId(collection, cursor.getLong(0)))) }
    }.orEmpty()
  }

  private fun publicFilesOfSize(audioOnly: Boolean, size: Long): List<Candidate> {
    if (!hasLegacyPermission()) return emptyList()
    @Suppress("DEPRECATION")
    val root = File(Environment.getExternalStorageDirectory(), galleryRoot(audioOnly))
    return root.walkTopDown().maxDepth(2).filter { it.isFile && it.length() == size }.map { Candidate.PublicFile(it) }.toList()
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun deleteOwnPendingItems() {
    val resolver = context.contentResolver
    for (audioOnly in listOf(false, true)) {
      val collection = collection(audioOnly)
      val selection = "${MediaStore.MediaColumns.IS_PENDING} = 1 AND ${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ?"
      val args = arrayOf("${galleryRoot(audioOnly)}/%")
      val cursor = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val query = Bundle().apply {
          putString(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
          putStringArray(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args)
          putInt(MediaStore.QUERY_ARG_MATCH_PENDING, MediaStore.MATCH_INCLUDE)
        }
        resolver.query(collection, arrayOf(BaseColumns._ID), query, null)
      } else {
        @Suppress("DEPRECATION")
        resolver.query(MediaStore.setIncludePending(collection), arrayOf(BaseColumns._ID), selection, args, null)
      }
      val orphans = cursor?.use { c -> buildList { while (c.moveToNext()) add(ContentUris.withAppendedId(collection, c.getLong(0))) } }
      orphans.orEmpty().forEach { uri -> runCatching { resolver.delete(uri, null, null) } }
    }
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun publish(item: LibraryItem): String {
    val resolver = context.contentResolver
    val audioOnly = item.isAudioOnly
    val collection = collection(audioOnly)
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, galleryFileName(item.title, item.file.extension))
      put(MediaStore.MediaColumns.TITLE, Titles.clamp(item.title))
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
    if (!hasLegacyPermission()) {
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

  private fun hasLegacyPermission(): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

  private suspend fun scan(file: File, mimeType: String?): String? = suspendCancellableCoroutine { continuation ->
    MediaScannerConnection.scanFile(context, arrayOf(file.path), arrayOf(mimeType)) { _, uri ->
      continuation.resume(uri?.toString())
    }
  }

  private fun scanBlocking(file: File): String? {
    val result = java.util.concurrent.CompletableFuture<String?>()
    MediaScannerConnection.scanFile(context, arrayOf(file.path), null) { _, uri -> result.complete(uri?.toString()) }
    return result.get(SCAN_TIMEOUT_SECONDS, java.util.concurrent.TimeUnit.SECONDS)
  }

  /** True while the gallery item behind [uri] still exists (the user may have deleted it in their gallery app). */
  internal fun exists(uri: String): Boolean = try {
    context.contentResolver.query(Uri.parse(uri), arrayOf(BaseColumns._ID), null, null, null)
      ?.use { it.moveToFirst() } == true
  } catch (e: RuntimeException) {
    // Not readable any more (reinstall, revoked permission): save a fresh copy.
    false
  }

  private fun requireComplete(copied: Long, source: File) {
    if (copied != source.length()) throw IOException("Copied $copied of ${source.length()} bytes")
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun collection(audioOnly: Boolean): Uri =
    if (audioOnly) {
      MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    } else {
      MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    }

  private val LibraryItem.isAudioOnly: Boolean get() = mimeType.startsWith("audio/")

  private companion object {
    const val COPY_BUFFER_BYTES = 1 shl 16
    const val SCAN_TIMEOUT_SECONDS = 10L
  }
}

/** `Movies/VidoraX` or `Music/VidoraX`: every gallery copy VidoraX makes lives below one of these. */
internal fun galleryRoot(audioOnly: Boolean): String = "${if (audioOnly) "Music" else "Movies"}/VidoraX"

/** Folder under shared storage, e.g. `Movies/VidoraX/Instagram` (the values of Environment.DIRECTORY_MOVIES/MUSIC). */
internal fun galleryFolder(audioOnly: Boolean, site: SiteId): String = "${galleryRoot(audioOnly)}/${site.folderName}"

/** `<Safe Title>.<ext>`, or `<Safe Title> (<copy>).<ext>` when [copy] is above 1. */
internal fun galleryFileName(title: String, extension: String, copy: Int = 1): String {
  val suffix = if (copy > 1) " ($copy)" else ""
  return "${FileNames.safeTitle(title)}$suffix.${FileNames.safeExtension(extension)}"
}
