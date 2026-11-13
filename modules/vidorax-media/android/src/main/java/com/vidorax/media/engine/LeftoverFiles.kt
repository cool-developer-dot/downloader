package com.vidorax.media.engine

import com.vidorax.media.library.StoragePaths
import java.io.File

/** What a clean-up of leftover download files would remove, or removed (F15). */
data class LeftoverSummary(val files: Int, val bytes: Long) {
  companion object {
    val NONE = LeftoverSummary(0, 0)
  }
}

/**
 * Download files that belong to nothing any more (F15, Storage → "Leftover download files"):
 * - every entry of the engine's work root (`no_backup/work/<id>`: single-file and per-part `.part` + `.parts`
 *   checkpoints, HLS/DASH segments, split tracks, merge output, recordings) whose download is not one the engine keeps
 *   (see [DownloadEngine]'s keep rule), and loose files there;
 * - in v1 download folders (`files/VidoraXDownloads/<id>/`), only the temporary parts — the `.hls` and `.mranges`
 *   workspaces and `*.part` files — of a v1 download JavaScript does not report as still active. A v1 folder's finished
 *   file is a library video and is never touched.
 * Nothing outside these two roots is ever listed (imports, the library and thumbnails live elsewhere).
 */
internal class LeftoverFiles(private val paths: StoragePaths) {
  /**
   * The folders and files a clean-up removes. [keepWorkNames] are work-folder names to keep; [keepLegacyIds] the v1
   * downloads whose temporary parts stay — null leaves v1 folders alone entirely.
   */
  fun find(keepWorkNames: Set<String>, keepLegacyIds: Set<String>?): List<File> {
    val roots = mutableListOf<File>()
    paths.workRoot.listFiles()?.sortedBy { it.name }?.forEach { entry ->
      if (entry.name !in keepWorkNames) roots += entry
    }
    if (keepLegacyIds != null) {
      paths.legacyDownloadsDir.listFiles()?.sortedBy { it.name }?.forEach { folder ->
        if (!folder.isDirectory || folder.name in keepLegacyIds) return@forEach
        folder.listFiles()?.sortedBy { it.name }?.forEach { entry ->
          val workspace = entry.isDirectory && entry.name in LEGACY_WORKSPACES
          val partial = entry.isFile && LEGACY_PARTIAL_SUFFIXES.any { entry.name.endsWith(it) }
          if (workspace || partial) roots += entry
        }
      }
    }
    return roots
  }

  fun measure(roots: List<File>): LeftoverSummary {
    var files = 0
    var bytes = 0L
    roots.forEach { root ->
      root.walkBottomUp().filter { it.isFile }.forEach {
        files++
        bytes += it.length()
      }
    }
    return LeftoverSummary(files, bytes)
  }

  /** Deletes [roots]; counts only what is really gone (a file another process holds open may stay). */
  fun delete(roots: List<File>): LeftoverSummary {
    var files = 0
    var bytes = 0L
    roots.forEach { root ->
      root.walkBottomUp().forEach { entry ->
        if (entry.isFile) {
          val size = entry.length()
          if (entry.delete()) {
            files++
            bytes += size
          }
        } else {
          entry.delete()
        }
      }
    }
    return LeftoverSummary(files, bytes)
  }

  companion object {
    /** v1 temporary workspaces inside `VidoraXDownloads/<id>/` (HLS segments, multi-range parts). */
    val LEGACY_WORKSPACES = setOf(".hls", ".mranges")
    /** v1 in-progress files beside the final one. */
    val LEGACY_PARTIAL_SUFFIXES = listOf(".part")
  }
}
