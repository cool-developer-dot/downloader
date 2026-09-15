package com.vidorax.media.library

import android.os.StatFs
import com.vidorax.media.model.StorageStats
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/** Space taken by the library, thumbnails and download work folders, and what is left on the app's volume. */
class StorageUsage internal constructor(
  private val paths: StoragePaths,
  private val library: LibraryStore,
) {
  suspend fun read(): StorageStats {
    val libraryBytes = library.totalSizeBytes()
    return withContext(Dispatchers.IO) {
      val volume = StatFs(paths.filesDir.path)
      StorageStats(
        libraryBytes = libraryBytes,
        thumbnailBytes = sizeOf(paths.thumbnailsDir),
        tempBytes = sizeOf(paths.workRoot),
        freeBytes = volume.availableBytes,
        totalBytes = volume.totalBytes,
      )
    }
  }

  private fun sizeOf(directory: File): Long = directory.walk().filter { it.isFile }.sumOf { it.length() }
}
