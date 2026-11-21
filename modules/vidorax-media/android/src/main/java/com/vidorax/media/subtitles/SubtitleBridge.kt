package com.vidorax.media.subtitles

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.library.FileNames
import com.vidorax.media.library.StoragePaths
import java.io.File

/** H19: what JavaScript sees of a subtitle track — never its URL. */
internal fun SubtitleTrack.toSubtitleJs(): Map<String, Any?> = mapOf(
  "id" to id,
  "language" to language,
  "name" to name,
  "format" to format?.wire,
  "isDefault" to isDefault,
  "isForced" to isForced,
  "refused" to refused?.wire,
)

internal fun SubtitleRecord.toSubtitleJs(): Map<String, Any?> = mapOf(
  "state" to state.wire,
  "subtitles" to files.mapIndexed { index, file ->
    mapOf("index" to index, "language" to file.language, "name" to file.name, "bytes" to file.bytes.toDouble())
  },
  "failed" to failed,
  "note" to note,
)

/**
 * H19 Export: a subtitle as `.vtt` or `.srt` (converted by JavaScript), written to `library/.subtitle-exports/` (inside
 * the FileProvider's paths; earlier exports are removed) and offered through the share sheet.
 */
internal object SubtitleExport {
  const val MAX_TEXT_CHARS = 10 * 1024 * 1024
  private const val FOLDER = ".subtitle-exports"

  private val SUBTITLE_TYPES = mapOf("vtt" to "text/vtt", "srt" to "application/x-subrip")

  /** #510: a download queue sent to another phone (`vidorax.downloadQueue` JSON). */
  val QUEUE_TYPES = mapOf("json" to "application/json")

  fun write(paths: StoragePaths, fileName: String, text: String, types: Map<String, String> = SUBTITLE_TYPES): Pair<File, String> {
    if (text.length > MAX_TEXT_CHARS) throw InvalidRequestException("The text is too large")
    val extension = fileName.substringAfterLast('.', "").lowercase()
    val mime = types[extension] ?: throw InvalidRequestException("Only ${types.keys.joinToString()} files can be shared here")
    val folder = File(paths.libraryDir, FOLDER)
    folder.listFiles()?.forEach { it.delete() }
    folder.mkdirs()
    val file = File(folder, "${FileNames.safeTitle(fileName.substringBeforeLast('.'))}.$extension")
    file.writeText(text, Charsets.UTF_8)
    return file to mime
  }

  fun share(context: Context, activity: Activity?, file: File, mime: String) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.vidorax.files", file)
    val send = Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uri).setType(mime)
    send.clipData = ClipData.newRawUri(file.name, uri)
    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    val chooser = Intent.createChooser(send, null)
    if (activity != null) activity.startActivity(chooser) else context.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }
}
