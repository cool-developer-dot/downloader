package com.vidorax.media.files

import android.app.Activity
import android.app.DownloadManager
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import com.vidorax.media.NotFoundException
import java.io.File

/**
 * Files: the files VidoraX's browser handed to Android's DownloadManager — pictures, documents, archives, apps, audio
 * the engine does not keep — so the Files tab lists them too (the client's formats guide: every DRM-free format).
 *
 * DownloadManager answers an app only with the downloads that app started, so this is exactly "what VidoraX
 * downloaded" with no storage permission. The files stay where Android put them (the phone's Downloads folder, where
 * other apps find them as well); VidoraX reads them through DownloadManager's own `content://` links, and Delete is
 * DownloadManager's `remove`, which deletes the file. A download whose file is gone is left out.
 */
class SystemDownloads(private val context: Context) {
  private val manager: DownloadManager? get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager

  data class Entry(
    val id: Long,
    val title: String,
    val mimeType: String?,
    val sizeBytes: Long,
    val modifiedAt: Long,
    val uri: String,
  ) {
    fun toMap(): Map<String, Any?> = mapOf(
      "id" to id.toString(),
      "title" to title,
      "mimeType" to mimeType,
      "sizeBytes" to sizeBytes.toDouble(),
      "modifiedAt" to modifiedAt.toDouble(),
      "uri" to uri,
    )
  }

  /** The finished downloads VidoraX started whose file can still be read, newest first. */
  fun list(): List<Entry> {
    val dm = manager ?: return emptyList()
    val query = DownloadManager.Query().setFilterByStatus(DownloadManager.STATUS_SUCCESSFUL)
    val rows = runCatching { dm.query(query) }.getOrNull() ?: return emptyList()
    val entries = mutableListOf<Entry>()
    rows.use { cursor ->
      while (cursor.moveToNext()) {
        val id = cursor.long(DownloadManager.COLUMN_ID) ?: continue
        val uri = runCatching { dm.getUriForDownloadedFile(id) }.getOrNull() ?: continue
        if (!readable(uri)) continue
        val local = cursor.string(DownloadManager.COLUMN_LOCAL_URI)
        entries += Entry(
          id = id,
          title = displayName(cursor.string(DownloadManager.COLUMN_TITLE), local),
          mimeType = cursor.string(DownloadManager.COLUMN_MEDIA_TYPE)?.takeIf { it.contains('/') },
          sizeBytes = cursor.long(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)?.coerceAtLeast(0) ?: 0,
          modifiedAt = cursor.long(DownloadManager.COLUMN_LAST_MODIFIED_TIMESTAMP) ?: 0,
          uri = uri.toString(),
        )
      }
    }
    return entries.sortedByDescending { it.modifiedAt }
  }

  /** Deletes the files (DownloadManager removes the download and its file). Returns how many it removed. */
  fun remove(ids: List<Long>): Int {
    if (ids.isEmpty()) return 0
    return runCatching { manager?.remove(*ids.toLongArray()) ?: 0 }.getOrDefault(0)
  }

  /** Android's chooser to open the file in another app (VidoraX opens its own videos, audio and PDFs itself). */
  fun openWith(activity: Activity?, id: Long, mimeType: String?, title: String?) {
    FileActions(context).openIncomingWith(activity, uriOf(id), mimeType ?: "*/*", title)
  }

  /** The share sheet with the file attached. */
  fun share(activity: Activity?, id: Long, mimeType: String?, title: String?) {
    val uri = uriOf(id)
    val send = Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uri)
    send.type = mimeType ?: "*/*"
    send.clipData = ClipData.newRawUri(title, uri)
    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    val chooser = Intent.createChooser(send, null)
    if (activity != null) activity.startActivity(chooser) else context.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  /** Copies the file to [target] (the PDF viewer reads from its cache folder). */
  fun copyTo(id: Long, target: File) {
    target.parentFile?.mkdirs()
    val input = context.contentResolver.openInputStream(uriOf(id)) ?: throw NotFoundException("The file can no longer be read")
    input.use { source -> target.outputStream().use { source.copyTo(it) } }
  }

  private fun uriOf(id: Long): Uri =
    runCatching { manager?.getUriForDownloadedFile(id) }.getOrNull() ?: throw NotFoundException("No such download")

  private fun readable(uri: Uri): Boolean =
    runCatching { context.contentResolver.openFileDescriptor(uri, "r")?.use { true } ?: false }.getOrDefault(false)

  companion object {
    /** The file name the download has: its title, else the last part of its local path, else "Download". */
    fun displayName(title: String?, localUri: String?): String {
      title?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
      val fromPath = localUri?.substringAfterLast('/')?.let { runCatching { Uri.decode(it) }.getOrDefault(it) }?.trim()
      return fromPath?.takeIf { it.isNotEmpty() } ?: "Download"
    }

    private fun Cursor.long(column: String): Long? =
      getColumnIndex(column).takeIf { it >= 0 && !isNull(it) }?.let(::getLong)

    private fun Cursor.string(column: String): String? =
      getColumnIndex(column).takeIf { it >= 0 && !isNull(it) }?.let(::getString)
  }
}

