package com.vidorax.media.library

import android.content.Context
import com.vidorax.media.model.SiteId
import java.io.File

/**
 * Private storage layout (docs/ARCHITECTURE.md section 3.3):
 *
 *     filesDir/library/<site>/<Safe Title>_<shortId>.<ext>
 *     filesDir/thumbs/<id>.webp
 *     noBackupFilesDir/work/<id>/
 *
 * The database stores library and thumbnail paths relative to filesDir, so rows stay valid when Android moves the
 * app's data directory.
 */
class StoragePaths(filesDir: File, noBackupFilesDir: File) {
  val filesDir: File = filesDir.absoluteFile.normalize()
  val libraryDir = File(this.filesDir, "library")
  val thumbnailsDir = File(this.filesDir, "thumbs")
  val workRoot = File(noBackupFilesDir.absoluteFile.normalize(), "work")

  /** v1 download folders, `filesDir/VidoraXDownloads/<id>/<file>`. */
  val legacyDownloadsDir = File(this.filesDir, "VidoraXDownloads")

  /** A library file path that does not exist yet. The folder is not created. */
  fun newLibraryFile(site: SiteId, title: String, id: String, extension: String): File {
    val folder = File(libraryDir, site.wire)
    var copy = 1
    var file: File
    do {
      file = File(folder, FileNames.libraryFileName(title, id, extension, copy))
      copy++
    } while (file.exists())
    return file
  }

  fun thumbnailFile(id: String): File = File(thumbnailsDir, "${FileNames.safeId(id)}.webp")

  fun workDir(id: String): File = File(workRoot, FileNames.safeId(id))

  /** The database form of a file under filesDir. */
  fun toStoredPath(file: File): String {
    val relative = file.absoluteFile.normalize().toRelativeString(filesDir)
    require(relative.isNotEmpty() && !relative.startsWith("..")) { "Not inside app storage: $file" }
    return relative
  }

  fun fromStoredPath(path: String): File = File(filesDir, path)

  companion object {
    fun from(context: Context) = StoragePaths(context.filesDir, context.noBackupFilesDir)
  }
}
