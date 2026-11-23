package com.vidorax.media.library

import com.vidorax.media.model.LibraryItem
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One video's length as [LengthProbe] found it: null when it isn't known (see [LengthProbe.lengths]). */
internal data class ProbedLength(val id: String, val durationMs: Long?)

/**
 * P9 #711 Duration Filter — the lengths of library videos that have none recorded, measured from the video's own file
 * with the existing [MediaInfo] probe (Android's `MediaMetadataRetriever`, the same reading a download or an import
 * makes). Used by JavaScript's background backfill, a few videos at a time.
 *
 * Only files of this app's own library are read: the id is looked up in the library, and only the file its record
 * points to is opened, if it is there and readable. Nothing is written: JavaScript keeps the lengths (P9's
 * `media_play_stats.duration_ms`).
 */
internal class LengthProbe(
  /** The library's record for an id (null: not a library video). */
  private val itemOf: suspend (String) -> LibraryItem?,
  /** The file's length in ms, or null when it can't be read ([MediaInfo.read]). */
  private val readLengthMs: (File) -> Long?,
) {
  /**
   * For each id (blank and repeated ids dropped, at most [MAX_IDS]): the length the library already has, else the one
   * measured from the file; null when the id isn't a library video, its file is missing or unreadable, or it has no
   * length. Never throws for one bad file.
   */
  suspend fun lengths(ids: List<String>): List<ProbedLength> = withContext(Dispatchers.IO) {
    val wanted = ids.map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(MAX_IDS)
    val out = ArrayList<ProbedLength>(wanted.size)
    for (id in wanted) {
      out.add(ProbedLength(id, lengthOf(id)))
    }
    out
  }

  private suspend fun lengthOf(id: String): Long? {
    val item = runCatching { itemOf(id) }.getOrNull() ?: return null
    item.durationMs?.takeIf { it > 0 }?.let { return it }
    val file = item.file
    if (!file.isFile || !file.canRead()) return null
    return runCatching { readLengthMs(file) }.getOrNull()?.takeIf { it > 0 }
  }

  companion object {
    /** The most ids one call measures (each one opens a file). */
    const val MAX_IDS = 10
  }
}
