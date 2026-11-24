package com.vidorax.media.cast

import android.content.ContentResolver
import android.content.Context
import android.content.res.AssetFileDescriptor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

/** The file can't be cast: a private video, a file still downloading, one outside VidoraX's reach, or none at all. */
class CastSourceRefusedException(val reason: Reason) : IllegalArgumentException(reason.name) {
  enum class Reason { PRIVATE, NOT_LOCAL, OUTSIDE_APP, GROWING, MISSING, UNKNOWN_LENGTH }
}

/**
 * P13 #667: the one file the cast server may serve, opened from the URI the Player plays.
 *
 * - `file://` only inside VidoraX's own storage (the library and the old downloads folder in `filesDir`, the app's
 *   external files folder). Never the Private Folder: its encrypted files (`noBackupFilesDir/vault`) and the decrypted
 *   playback copy (`cacheDir/vault-play`) are refused here as well as in JavaScript (`src/player/cast/cast-rules.ts`).
 * - `content://`: a video on the phone (MediaStore) or a file another app opened VidoraX with, read the same way the
 *   Player reads it. Not the growing file of a download still in progress (its length isn't final).
 */
object CastSources {
  private const val PRIVATE_VAULT_DIR = "vault"
  private const val PRIVATE_PLAY_DIR = "vault-play"
  private const val GROWING_AUTHORITY_SUFFIX = ".vidorax.growing"

  fun open(context: Context, uriString: String, contentType: String?): CastServedFile {
    val uri = Uri.parse(uriString)
    return when (uri.scheme?.lowercase()) {
      "file" -> openFile(context, File(uri.path ?: throw CastSourceRefusedException(CastSourceRefusedException.Reason.MISSING)), contentType)
      ContentResolver.SCHEME_CONTENT -> openContent(context, uri, contentType)
      else -> throw CastSourceRefusedException(CastSourceRefusedException.Reason.NOT_LOCAL)
    }
  }

  /** Whether [file] is somewhere the cast server may read: VidoraX's own storage, never the Private Folder. */
  fun isServableFile(context: Context, file: File): Boolean {
    val path = canonical(file)
    val privateRoots = listOf(File(context.noBackupFilesDir, PRIVATE_VAULT_DIR), File(context.cacheDir, PRIVATE_PLAY_DIR))
    if (privateRoots.any { isInside(path, canonical(it)) }) return false
    val allowed = listOfNotNull(context.filesDir, context.getExternalFilesDir(null))
    return allowed.any { isInside(path, canonical(it)) }
  }

  internal fun openFile(context: Context, file: File, contentType: String?): CastServedFile {
    if (!isServableFile(context, file)) {
      val privateFile = canonical(file).contains("${File.separator}$PRIVATE_VAULT_DIR")
      throw CastSourceRefusedException(
        if (privateFile) CastSourceRefusedException.Reason.PRIVATE else CastSourceRefusedException.Reason.OUTSIDE_APP,
      )
    }
    val target = file.canonicalFile
    if (!target.isFile) throw CastSourceRefusedException(CastSourceRefusedException.Reason.MISSING)
    val size = target.length()
    val type = contentType ?: CastMimeTypes.forName(target.name)
    return object : CastServedFile {
      override val length: Long = size
      override val contentType: String = type

      override fun open(offset: Long): InputStream =
        FileInputStream(target).also { it.channel.position(offset) }
    }
  }

  private fun openContent(context: Context, uri: Uri, contentType: String?): CastServedFile {
    if (uri.authority?.endsWith(GROWING_AUTHORITY_SUFFIX) == true) {
      throw CastSourceRefusedException(CastSourceRefusedException.Reason.GROWING)
    }
    val resolver = context.contentResolver
    val size = contentLength(resolver, uri)
    if (size <= 0L) throw CastSourceRefusedException(CastSourceRefusedException.Reason.UNKNOWN_LENGTH)
    val type = contentType ?: resolver.getType(uri) ?: CastMimeTypes.forName(uri.lastPathSegment ?: "")
    return object : CastServedFile {
      override val length: Long = size
      override val contentType: String = type

      override fun open(offset: Long): InputStream {
        val descriptor = resolver.openFileDescriptor(uri, "r")
          ?: throw CastSourceRefusedException(CastSourceRefusedException.Reason.MISSING)
        return ParcelFileDescriptor.AutoCloseInputStream(descriptor).also { it.channel.position(offset) }
      }
    }
  }

  private fun contentLength(resolver: ContentResolver, uri: Uri): Long {
    val fromDescriptor = runCatching {
      resolver.openAssetFileDescriptor(uri, "r")?.use { it.length }
    }.getOrNull()
    if (fromDescriptor != null && fromDescriptor != AssetFileDescriptor.UNKNOWN_LENGTH && fromDescriptor > 0L) {
      return fromDescriptor
    }
    return runCatching {
      resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getLong(0) else -1L
      }
    }.getOrNull() ?: -1L
  }

  private fun canonical(file: File): String = runCatching { file.canonicalPath }.getOrDefault(file.absolutePath)

  private fun isInside(path: String, root: String): Boolean =
    path == root || path.startsWith(root.trimEnd(File.separatorChar) + File.separator)
}

/** Content types the Default Media Receiver understands, by file extension; anything else as a generic video. */
object CastMimeTypes {
  private val byExtension = mapOf(
    "mp4" to "video/mp4",
    "m4v" to "video/mp4",
    "mov" to "video/mp4",
    "webm" to "video/webm",
    "mkv" to "video/x-matroska",
    "3gp" to "video/3gpp",
    "ts" to "video/mp2t",
    "m3u8" to "application/x-mpegURL",
    "mpd" to "application/dash+xml",
    "mp3" to "audio/mpeg",
    "m4a" to "audio/mp4",
    "aac" to "audio/aac",
    "ogg" to "audio/ogg",
    "opus" to "audio/ogg",
    "wav" to "audio/wav",
    "flac" to "audio/flac",
  )

  fun forName(name: String): String =
    byExtension[name.substringAfterLast('.', "").lowercase()] ?: "video/mp4"
}
