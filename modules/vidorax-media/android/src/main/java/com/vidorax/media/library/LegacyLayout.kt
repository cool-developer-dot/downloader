package com.vidorax.media.library

/**
 * How v1 laid out a download folder (`filesDir/VidoraXDownloads/<id>/`, src/downloads/engine/file-paths.ts in v1):
 * the finished file, `<name>.part` while a progressive transfer ran, `<name>.rangepart` during range merges, and
 * `.hls` / `.mranges` workspace folders holding `*.tmp` files.
 */
internal object LegacyLayout {
  data class Entry(val name: String, val sizeBytes: Long)

  private val TRANSFER_SUFFIXES = listOf(".part", ".rangepart", ".tmp")
  private val WORKSPACE_FOLDERS = setOf(".hls", ".mranges")

  // v1 also saved images and documents; they never belong in the video library.
  private val NON_MEDIA_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "gif", "pdf", "m3u8", "m3u", "mpd")

  /**
   * The finished download among a folder's regular files, or null when it never completed. A known media extension
   * wins; otherwise the largest file with an unknown extension is returned (v1 fell back to `.bin` when it could not
   * tell the type), which the caller must confirm by reading its tracks.
   */
  fun mediaCandidate(files: List<Entry>): Entry? {
    val names = files.mapTo(HashSet()) { it.name }
    val finished = files.filter { entry ->
      entry.sizeBytes > 0 &&
        !entry.name.startsWith(".") &&
        TRANSFER_SUFFIXES.none { entry.name.endsWith(it, ignoreCase = true) || "${entry.name}$it" in names } &&
        MediaTypes.extensionOf(entry.name) !in NON_MEDIA_EXTENSIONS
    }
    return finished.filter { MediaTypes.forFileName(it.name) != null }.maxByOrNull { it.sizeBytes }
      ?: finished.maxByOrNull { it.sizeBytes }
  }

  /** Files and folders that only an unfinished v1 transfer used. */
  fun isTransferLeftover(name: String, isDirectory: Boolean): Boolean =
    if (isDirectory) name in WORKSPACE_FOLDERS else TRANSFER_SUFFIXES.any { name.endsWith(it, ignoreCase = true) }

  fun titleFromFileName(name: String): String =
    Titles.clamp(name.substringBeforeLast('.').replace('_', ' '))
}
