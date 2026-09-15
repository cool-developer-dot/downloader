package com.vidorax.media.files

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.vidorax.media.NoAppException
import com.vidorax.media.model.LibraryItem
import java.io.File

/**
 * Hands library files to other apps through [VidoraFileProvider]. Read access travels with the intent's ClipData, so
 * only the app the user picks can read the file, and only for that task. Call on the main thread.
 */
class FileActions(private val context: Context) {
  private val authority = "${context.packageName}.vidorax.files"

  /** Opens the system chooser to play [item] in another app. Rejects with ERR_NO_APP when no app can. */
  fun openWith(activity: Activity?, item: LibraryItem) {
    val uri = contentUri(item.file)
    val view = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, item.mimeType)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    view.clipData = ClipData.newRawUri(item.title, uri)
    if (view.resolveActivity(context.packageManager) == null) {
      throw NoAppException("No installed app opens ${item.mimeType}")
    }
    start(activity, Intent.createChooser(view, null))
  }

  /** Opens the share sheet with the files of [items] attached. [items] must not be empty. */
  fun share(activity: Activity?, items: List<LibraryItem>) {
    val uris = items.map { contentUri(it.file) }
    val send = if (uris.size == 1) {
      Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris.single())
    } else {
      Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, ArrayList(uris))
    }
    send.type = shareMimeType(items.map { it.mimeType })
    send.clipData = ClipData.newRawUri(null, uris.first()).apply {
      uris.drop(1).forEach { addItem(ClipData.Item(it)) }
    }
    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    start(activity, Intent.createChooser(send, null))
  }

  private fun contentUri(file: File): Uri = FileProvider.getUriForFile(context, authority, file)

  private fun start(activity: Activity?, intent: Intent) {
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }
}

// One MIME type for several files: the exact type when they all match, the family wildcard (e.g. video/*) when they
// share a family, otherwise any type.
internal fun shareMimeType(mimeTypes: List<String>): String {
  val distinct = mimeTypes.distinct()
  if (distinct.size == 1) return distinct.single()
  val families = distinct.map { it.substringBefore('/') }.distinct()
  return if (families.size == 1) "${families.single()}/*" else "*/*"
}
