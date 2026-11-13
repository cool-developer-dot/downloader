package com.vidorax.web.offline

import android.webkit.WebView
import androidx.annotation.MainThread
import java.io.File

/**
 * B17 #178 — Save page offline: `WebView.saveWebArchive` writes the page as a web archive (.mht) into the app's own
 * storage, one folder per browser profile: `<filesDir>/offline-pages/<profile>/<id>.mht`. Opened read-only in
 * [OfflinePageActivity] (no JavaScript, no network). Ids and profile keys are checked, and every path is
 * canonicalised and must stay inside that folder.
 */
internal object OfflinePages {
  const val ROOT = "offline-pages"
  private val SAFE = Regex("^[A-Za-z0-9_-]{1,64}$")

  fun isSafeName(value: String?): Boolean = value != null && SAFE.matches(value)

  fun rootDir(filesDir: File): File = File(filesDir, ROOT)

  /** The profile's folder, or null for an unsafe key. */
  fun profileDir(filesDir: File, profile: String): File? = if (isSafeName(profile)) File(rootDir(filesDir), profile) else null

  /** The archive of [id] in [profile]'s folder, or null for an unsafe id / key. */
  fun archiveFile(filesDir: File, profile: String, id: String): File? {
    if (!isSafeName(id)) return null
    val dir = profileDir(filesDir, profile) ?: return null
    return File(dir, "$id.mht")
  }

  /** True when [file] (canonical) is an archive inside the offline-pages folder. */
  fun isInside(filesDir: File, file: File): Boolean {
    val root = rootDir(filesDir).canonicalFile
    val canonical = try {
      file.canonicalFile
    } catch (_: Exception) {
      return false
    }
    return canonical.name.endsWith(".mht") && canonical.parentFile?.parentFile == root
  }

  /** Saves the page; [done] gets the archive's size in bytes (0 = not saved). */
  @MainThread
  fun save(webView: WebView, target: File, done: (Long) -> Unit) {
    target.parentFile?.mkdirs()
    try {
      webView.saveWebArchive(target.path, false) { saved ->
        val file = saved?.let { File(it) }
        done(if (file != null && file.isFile) file.length() else 0L)
      }
    } catch (_: RuntimeException) {
      done(0L)
    }
  }

  fun delete(file: File?): Boolean = file != null && file.isFile && file.delete()

  /** A profile was deleted (B20) or the guest ended: its saved pages go with it. */
  fun deleteProfile(filesDir: File, profile: String): Boolean {
    val dir = profileDir(filesDir, profile) ?: return false
    return !dir.exists() || dir.deleteRecursively()
  }
}
