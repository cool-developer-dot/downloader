package com.vidorax.media.library

import android.content.Context
import android.util.Log
import com.vidorax.media.model.LibraryChange
import com.vidorax.media.model.LibraryChangeReason
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.SiteId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/**
 * One-time import of downloads completed by v1 (`filesDir/VidoraXDownloads/<id>/<file>`) into the library. The v1 id
 * is kept so playback progress saved under it still matches. Titles come from file names and the site is `web` until
 * JavaScript applies the v1 catalog with `applyLegacyMetadata`.
 */
class LegacyImport internal constructor(
  context: Context,
  private val paths: StoragePaths,
  private val library: LibraryStore,
  private val mediaInfo: MediaInfo,
  private val thumbnails: Thumbnails,
) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
  private val mutex = Mutex()

  /**
   * Imports unless an earlier run completed; a concurrent caller waits for the running import. A folder that fails
   * stays in place and is retried by the next run.
   */
  suspend fun run() {
    mutex.withLock {
      if (preferences.getBoolean(KEY_COMPLETED, false)) return
      val imported = mutableListOf<String>()
      var failed = false
      withContext(Dispatchers.IO) {
        for (folder in paths.legacyDownloadsDir.listFiles().orEmpty()) {
          if (!folder.isDirectory) continue
          try {
            if (importFolder(folder)) imported += folder.name
            removeIfOnlyLeftovers(folder)
          } catch (e: CancellationException) {
            throw e
          } catch (e: Exception) {
            failed = true
            Log.w(TAG, "Could not import v1 download ${folder.name}", e)
          }
        }
        paths.legacyDownloadsDir.delete()
      }
      library.announce(LibraryChange(LibraryChangeReason.IMPORTED, imported))
      if (!failed) preferences.edit().putBoolean(KEY_COMPLETED, true).apply()
    }
  }

  /** True when the folder held a finished, playable download that is now in the library. */
  private suspend fun importFolder(folder: File): Boolean {
    val id = folder.name
    if (library.get(id) != null) return false
    val entries = folder.listFiles().orEmpty().filter { it.isFile }.map { LegacyLayout.Entry(it.name, it.length()) }
    val candidate = LegacyLayout.mediaCandidate(entries) ?: return false
    val source = File(folder, candidate.name)
    val metadata = mediaInfo.read(source)
    val typeByName = MediaTypes.forFileName(source.name)
    val type = typeByName ?: metadata.containerMimeType?.let(MediaTypes::forMimeType)
    if (type == null || !metadata.isPlayable) return false

    val title = LegacyLayout.titleFromFileName(source.name)
    val extension = if (typeByName != null) source.extension else type.extension
    val target = paths.newLibraryFile(SiteId.WEB, title, id, extension)
    val thumbnail = thumbnails.create(id, source, metadata)
    val addedAt = source.lastModified().takeIf { it > 0 } ?: System.currentTimeMillis()
    target.parentFile?.mkdirs()
    if (!source.renameTo(target)) {
      thumbnail?.delete()
      throw IOException("Could not move the file into the library")
    }
    val item = LibraryItem(
      id = id,
      title = title,
      site = SiteId.WEB,
      pageUrl = null,
      sourceUrl = null,
      file = target,
      mimeType = type.mimeType,
      container = type.container,
      videoCodec = metadata.videoCodec,
      audioCodec = metadata.audioCodec,
      hasAudio = metadata.hasAudio,
      width = metadata.width,
      height = metadata.height,
      durationMs = metadata.durationMs,
      sizeBytes = target.length(),
      thumbnail = thumbnail,
      favorite = false,
      galleryUri = null,
      createdAt = addedAt,
      completedAt = addedAt,
    )
    try {
      library.insert(item, announce = false)
    } catch (e: Exception) {
      target.renameTo(source)
      thumbnail?.delete()
      throw e
    }
    return true
  }

  /** Deletes the folder when only unfinished-transfer leftovers remain: nothing in v2 can resume them. */
  private fun removeIfOnlyLeftovers(folder: File) {
    if (folder.listFiles().orEmpty().all { LegacyLayout.isTransferLeftover(it.name, it.isDirectory) }) {
      folder.deleteRecursively()
    }
  }

  private companion object {
    const val TAG = "VidoraMedia"
    const val PREFERENCES = "vidorax_media"
    const val KEY_COMPLETED = "legacy_import_completed"
  }
}
