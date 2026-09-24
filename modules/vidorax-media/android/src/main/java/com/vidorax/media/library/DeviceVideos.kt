package com.vidorax.media.library

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat

/** One video already on the device, as MediaStore describes it. Read-only: VidoraX never modifies these. */
data class DeviceVideo(
  val id: String,
  val uri: String,
  val title: String,
  val durationMs: Long?,
  val sizeBytes: Long,
  val width: Int?,
  val height: Int?,
  val addedAt: Long,
  val mimeType: String?,
)

/**
 * The device's own videos, for playing what the user already has. Nothing is copied, moved or written — the
 * app only reads MediaStore, and only when the user has granted the media permission.
 */
class DeviceVideos(private val context: Context) {
  fun hasPermission(): Boolean = access() != Access.NONE

  /** What the user granted: everything, only the items they picked (Android 14+), or nothing. */
  enum class Access { NONE, SELECTED, FULL }

  fun access(): Access {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return if (granted(Manifest.permission.READ_EXTERNAL_STORAGE)) Access.FULL else Access.NONE
    }
    if (granted(Manifest.permission.READ_MEDIA_VIDEO)) return Access.FULL
    // Android 14's "Select photos and videos": MediaStore returns exactly what the user picked.
    if (Build.VERSION.SDK_INT >= UPSIDE_DOWN_CAKE && granted(READ_MEDIA_VISUAL_USER_SELECTED)) {
      return Access.SELECTED
    }
    return Access.NONE
  }

  private fun granted(permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  /** Newest first. Returns an empty list when the permission is missing, never an error. */
  fun list(limit: Int, offset: Int): List<DeviceVideo> {
    if (!hasPermission()) return emptyList()
    val projection = arrayOf(
      MediaStore.Video.Media._ID,
      MediaStore.Video.Media.DISPLAY_NAME,
      MediaStore.Video.Media.TITLE,
      MediaStore.Video.Media.DURATION,
      MediaStore.Video.Media.SIZE,
      MediaStore.Video.Media.WIDTH,
      MediaStore.Video.Media.HEIGHT,
      MediaStore.Video.Media.DATE_ADDED,
      MediaStore.Video.Media.MIME_TYPE,
    )
    val collection = MediaStore.Video.Media.EXTERNAL_CONTENT_URI
    val sort = "${MediaStore.Video.Media.DATE_ADDED} DESC"
    // Ask MediaStore for the containers VidoraX can play; a row with no MIME type is kept and decided by its
    // file name below, because some files are stored as octet-stream.
    val supported = MediaTypes.videoMimeTypes.toList()
    val selection = supported.joinToString(
      prefix = "(${MediaStore.Video.Media.MIME_TYPE} IN (",
      separator = ",",
      postfix = ") OR ${MediaStore.Video.Media.MIME_TYPE} IS NULL)",
    ) { "?" }
    val videos = mutableListOf<DeviceVideo>()
    runCatching {
      context.contentResolver.query(collection, projection, selection, supported.toTypedArray(), sort)?.use { cursor ->
        val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
        val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
        val titleColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.TITLE)
        val durationColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION)
        val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
        val widthColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.WIDTH)
        val heightColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.HEIGHT)
        val addedColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_ADDED)
        val mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.MIME_TYPE)
        if (offset > 0 && !cursor.moveToPosition(offset - 1)) return@use
        while (cursor.moveToNext() && videos.size < limit) {
          val id = cursor.getLong(idColumn)
          val name = cursor.getString(nameColumn) ?: cursor.getString(titleColumn) ?: "Video"
          val mime = cursor.getString(mimeColumn)
          // Only formats this app can actually play are offered; nothing else is listed.
          if (!MediaTypes.isSupportedVideo(mime, name)) continue
          videos += DeviceVideo(
            id = id.toString(),
            uri = ContentUris.withAppendedId(collection, id).toString(),
            title = name,
            durationMs = cursor.getLong(durationColumn).takeIf { it > 0 },
            sizeBytes = cursor.getLong(sizeColumn),
            width = cursor.getInt(widthColumn).takeIf { it > 0 },
            height = cursor.getInt(heightColumn).takeIf { it > 0 },
            // MediaStore keeps DATE_ADDED in seconds.
            addedAt = cursor.getLong(addedColumn) * 1_000,
            mimeType = mime,
          )
        }
      }
    }
    return videos
  }

  private companion object {
    const val UPSIDE_DOWN_CAKE = 34
    const val READ_MEDIA_VISUAL_USER_SELECTED = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
  }
}
