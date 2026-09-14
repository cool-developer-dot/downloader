/**
 * Phase 7C — Android MediaStore / SAF export of managed completed files.
 *
 * Streams private canonical file → public MediaStore (API 29+) or SAF (API 24–28).
 * Validates path under VidoraXDownloads/{downloadId}/ before any read.
 * Never deletes the private source. Never logs Cookie/Authorization/source URLs.
 */
package com.anonymous.vidorax.mediaexport

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class VidoraMediaExportModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private val io = Executors.newSingleThreadExecutor()
  private val nextRequestCode = AtomicInteger(7100)
  private var pendingSaf: PendingSaf? = null

  private data class PendingSaf(
    val requestCode: Int,
    val absolutePath: String,
    val expectedBytes: Long,
    val promise: Promise,
  )

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "VidoraMediaExport"

  @ReactMethod
  fun getSdkInt(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT)
  }

  @ReactMethod
  fun mediaStoreUriExists(contentUri: String, promise: Promise) {
    io.execute {
      try {
        val uri = Uri.parse(contentUri.trim())
        if (!uri.scheme.equals("content", ignoreCase = true)) {
          promise.resolve(false)
          return@execute
        }
        reactContext.contentResolver.openAssetFileDescriptor(uri, "r").use { afd ->
          promise.resolve(afd != null)
        }
      } catch (_: Exception) {
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun deletePendingMediaStoreUri(contentUri: String, promise: Promise) {
    io.execute {
      try {
        val uri = Uri.parse(contentUri.trim())
        if (!uri.scheme.equals("content", ignoreCase = true)) {
          promise.resolve(false)
          return@execute
        }
        // Only delete when IS_PENDING=1 if we can read it; otherwise best-effort delete of
        // VidoraX-owned pending rows. Callers must not pass published receipts here.
        val deleted = reactContext.contentResolver.delete(uri, null, null)
        promise.resolve(deleted > 0)
      } catch (_: Exception) {
        promise.resolve(false)
      }
    }
  }

  /**
   * Export managed private file to MediaStore (API 29+) or launch SAF CREATE_DOCUMENT (API 24–28).
   *
   * collection: "video" | "audio" | "downloads"
   */
  @ReactMethod
  fun exportManagedFile(
    absolutePath: String,
    downloadId: String,
    displayName: String,
    mimeType: String,
    collection: String,
    relativePath: String,
    promise: Promise,
  ) {
    io.execute {
      try {
        val source = resolveManagedSource(absolutePath, downloadId)
          ?: run {
            promise.reject("INVALID_MANAGED_PATH", "Invalid managed path")
            return@execute
          }
        if (!source.isFile || !source.canRead()) {
          promise.reject("FILE_MISSING", "File is no longer available")
          return@execute
        }
        val expected = source.length()
        if (expected <= 0L) {
          promise.reject("FILE_MISSING", "File is no longer available")
          return@execute
        }

        val safeName = sanitizeDisplayName(displayName)
        val mime = resolveMime(mimeType, safeName)

        if (Build.VERSION.SDK_INT >= 29) {
          exportViaMediaStore(source, expected, safeName, mime, collection, relativePath, promise)
        } else {
          // Must hop to main thread for startActivityForResult.
          val activity = reactContext.currentActivity
          if (activity == null) {
            promise.reject("LEGACY_EXPORT_FAILED", "Unable to save this file")
            return@execute
          }
          val requestCode = nextRequestCode.getAndIncrement()
          pendingSaf = PendingSaf(requestCode, source.absolutePath, expected, promise)
          activity.runOnUiThread {
            try {
              val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mime
                putExtra(Intent.EXTRA_TITLE, safeName)
              }
              activity.startActivityForResult(intent, requestCode)
            } catch (_: Exception) {
              pendingSaf = null
              promise.reject("LEGACY_EXPORT_FAILED", "Unable to save this file")
            }
          }
        }
      } catch (e: Exception) {
        val msg = e.message?.lowercase() ?: ""
        if (msg.contains("enospc") || msg.contains("no space") || msg.contains("space")) {
          promise.reject("INSUFFICIENT_STORAGE", "Not enough storage")
        } else {
          promise.reject("COPY_IO_FAILED", "Unable to save this file")
        }
      }
    }
  }

  private fun exportViaMediaStore(
    source: File,
    expected: Long,
    displayName: String,
    mime: String,
    collection: String,
    relativePath: String,
    promise: Promise,
  ) {
    var pendingUri: Uri? = null
    try {
      val resolver = reactContext.contentResolver
      val collectionUri = collectionUriFor(collection)
      val values = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        put(MediaStore.MediaColumns.RELATIVE_PATH, normalizeRelativePath(relativePath, collection))
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }

      pendingUri = resolver.insert(collectionUri, values)
        ?: run {
          promise.reject("MEDIASTORE_INSERT_FAILED", "Unable to save this file")
          return
        }

      resolver.openOutputStream(pendingUri!!)?.use { output ->
        FileInputStream(source).use { input ->
          val buffer = ByteArray(64 * 1024)
          var copied = 0L
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            copied += read
          }
          output.flush()
          if (copied != expected) {
            throw CopyMismatchException(copied, expected)
          }
        }
      } ?: run {
        cleanupPending(pendingUri)
        promise.reject("OUTPUT_STREAM_UNAVAILABLE", "Unable to save this file")
        return
      }

      val publish = ContentValues().apply {
        put(MediaStore.MediaColumns.IS_PENDING, 0)
      }
      val updated = resolver.update(pendingUri!!, publish, null, null)
      if (updated <= 0) {
        cleanupPending(pendingUri)
        promise.reject("MEDIASTORE_PUBLISH_FAILED", "Unable to save this file")
        return
      }

      // Source private file intentionally untouched.
      promise.resolve(resultMap(pendingUri!!.toString(), displayName, expected, "mediastore"))
    } catch (e: CopyMismatchException) {
      cleanupPending(pendingUri)
      promise.reject("COPY_SIZE_MISMATCH", "Unable to save this file")
    } catch (e: Exception) {
      cleanupPending(pendingUri)
      val msg = e.message?.lowercase() ?: ""
      if (msg.contains("enospc") || msg.contains("no space") || msg.contains("space")) {
        promise.reject("INSUFFICIENT_STORAGE", "Not enough storage")
      } else {
        promise.reject("COPY_IO_FAILED", "Unable to save this file")
      }
    }
  }

  override fun onActivityResult(
    activity: Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?,
  ) {
    val pending = pendingSaf ?: return
    if (pending.requestCode != requestCode) {
      return
    }
    pendingSaf = null

    if (resultCode != Activity.RESULT_OK || data?.data == null) {
      pending.promise.reject("LEGACY_EXPORT_CANCELLED", "Save cancelled")
      return
    }

    val destUri = data.data!!
    io.execute {
      try {
        val source = File(pending.absolutePath)
        if (!source.isFile) {
          pending.promise.reject("FILE_MISSING", "File is no longer available")
          return@execute
        }
        reactContext.contentResolver.openOutputStream(destUri)?.use { output ->
          FileInputStream(source).use { input ->
            val buffer = ByteArray(64 * 1024)
            var copied = 0L
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              output.write(buffer, 0, read)
              copied += read
            }
            output.flush()
            if (copied != pending.expectedBytes) {
              try {
                reactContext.contentResolver.delete(destUri, null, null)
              } catch (_: Exception) {
              }
              pending.promise.reject("COPY_SIZE_MISMATCH", "Unable to save this file")
              return@execute
            }
          }
        } ?: run {
          pending.promise.reject("OUTPUT_STREAM_UNAVAILABLE", "Unable to save this file")
          return@execute
        }
        pending.promise.resolve(
          resultMap(destUri.toString(), source.name, pending.expectedBytes, "saf"),
        )
      } catch (e: Exception) {
        try {
          reactContext.contentResolver.delete(destUri, null, null)
        } catch (_: Exception) {
        }
        pending.promise.reject("LEGACY_EXPORT_FAILED", "Unable to save this file")
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    // no-op
  }

  private fun resolveManagedSource(absolutePath: String, downloadId: String): File? {
    val raw = absolutePath.trim().removePrefix("file://")
    if (raw.isEmpty() || raw.contains("..")) {
      return null
    }
    val safeId = sanitizeDownloadId(downloadId)
    if (safeId.isEmpty()) {
      return null
    }
    val file = try {
      File(raw).canonicalFile
    } catch (_: Exception) {
      return null
    }

    val candidates = listOfNotNull(
      reactContext.filesDir,
      reactContext.getExternalFilesDir(null),
      reactContext.noBackupFilesDir,
    ).mapNotNull { base ->
      try {
        File(base, "VidoraXDownloads/$safeId").canonicalFile
      } catch (_: Exception) {
        null
      }
    }

    val underManaged = candidates.any { itemDir ->
      file.path == itemDir.path || file.path.startsWith(itemDir.path + File.separator)
    }
    if (!underManaged) {
      return null
    }
    // Reject .part / active temps from completed-file export.
    if (file.name.endsWith(".part", ignoreCase = true) ||
      file.name.endsWith(".rangepart", ignoreCase = true)
    ) {
      return null
    }
    return file
  }

  private fun collectionUriFor(collection: String): Uri {
    return when (collection) {
      "audio" -> MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      "downloads" -> {
        if (Build.VERSION.SDK_INT >= 29) {
          MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        } else {
          MediaStore.Files.getContentUri("external")
        }
      }
      else -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
    }
  }

  private fun normalizeRelativePath(relativePath: String, collection: String): String {
    val trimmed = relativePath.trim().trim('/')
    if (trimmed.isNotEmpty()) {
      return if (trimmed.endsWith("/")) trimmed else "$trimmed/"
    }
    return when (collection) {
      "audio" -> "Music/VidoraX/"
      "downloads" -> "Download/VidoraX/"
      else -> "Movies/VidoraX/"
    }
  }

  private fun cleanupPending(uri: Uri?) {
    if (uri == null) return
    try {
      reactContext.contentResolver.delete(uri, null, null)
    } catch (_: Exception) {
    }
  }

  private fun resultMap(
    contentUri: String,
    displayName: String,
    bytesCopied: Long,
    strategy: String,
  ): WritableMap {
    return Arguments.createMap().apply {
      putString("contentUri", contentUri)
      putString("displayName", displayName)
      putDouble("bytesCopied", bytesCopied.toDouble())
      putString("strategy", strategy)
    }
  }

  private fun sanitizeDownloadId(downloadId: String): String {
    return downloadId.trim().replace(Regex("[^A-Za-z0-9._-]"), "_").take(120)
  }

  private fun sanitizeDisplayName(name: String): String {
    val trimmed = name.trim()
    if (trimmed.isEmpty() || trimmed.contains("://") || trimmed.startsWith("http", true)) {
      return "download.bin"
    }
    return trimmed
      .replace(Regex("[<>:\"|?*\\u0000-\\u001f]"), "_")
      .take(180)
      .ifEmpty { "download.bin" }
  }

  private fun resolveMime(mimeType: String, displayName: String): String {
    val trimmed = mimeType.trim().lowercase()
    if (trimmed.contains('/') && trimmed != "*/*") {
      return trimmed
    }
    val dot = displayName.lastIndexOf('.')
    if (dot > 0 && dot < displayName.length - 1) {
      val ext = displayName.substring(dot + 1).lowercase()
      MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)?.let { return it }
    }
    return "application/octet-stream"
  }

  private class CopyMismatchException(
    val copied: Long,
    val expected: Long,
  ) : Exception("copy mismatch")
}
