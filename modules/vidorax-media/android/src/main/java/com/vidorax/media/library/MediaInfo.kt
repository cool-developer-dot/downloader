package com.vidorax.media.library

import android.content.Context
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.media3.inspector.MediaExtractorCompat
import java.io.File

/** What a finished file reports about itself. Codecs are sample MIME types such as `video/avc`. */
data class MediaMetadata(
  val durationMs: Long?,
  /** Displayed width and height: rotation is already applied. */
  val width: Int?,
  val height: Int?,
  val bitrate: Long?,
  val hasVideo: Boolean,
  val hasAudio: Boolean,
  val videoCodec: String?,
  val audioCodec: String?,
  /** Container MIME type as the platform reports it, e.g. `video/mp4`. */
  val containerMimeType: String?,
) {
  val isPlayable: Boolean get() = hasVideo || hasAudio
}

/** Reads [MediaMetadata] from local files. Blocking: call from an IO thread. Unreadable media never throws. */
class MediaInfo(private val context: Context) {
  fun read(file: File): MediaMetadata {
    val tracks = trackMimeTypes(file)
    val videoCodec = tracks?.firstOrNull { it.startsWith("video/") }
    val audioCodec = tracks?.firstOrNull { it.startsWith("audio/") }
    val retriever = MediaMetadataRetriever()
    try {
      try {
        retriever.setDataSource(file.path)
      } catch (e: RuntimeException) {
        return MediaMetadata(
          durationMs = null,
          width = null,
          height = null,
          bitrate = null,
          hasVideo = videoCodec != null,
          hasAudio = audioCodec != null,
          videoCodec = videoCodec,
          audioCodec = audioCodec,
          containerMimeType = null,
        )
      }
      val size = displaySize(
        retriever.int(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH),
        retriever.int(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT),
        retriever.int(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION) ?: 0,
      )
      return MediaMetadata(
        durationMs = retriever.long(MediaMetadataRetriever.METADATA_KEY_DURATION)?.takeIf { it > 0 },
        width = size?.first,
        height = size?.second,
        bitrate = retriever.long(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.takeIf { it > 0 },
        // Media3's track list is authoritative when it could parse the container; otherwise ask the platform.
        hasVideo = if (tracks != null) videoCodec != null else retriever.says(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO),
        hasAudio = if (tracks != null) audioCodec != null else retriever.says(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO),
        videoCodec = videoCodec,
        audioCodec = audioCodec,
        containerMimeType = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE),
      )
    } finally {
      retriever.release()
    }
  }

  /** Sample MIME types of every track, or null when Media3 cannot parse the container. */
  private fun trackMimeTypes(file: File): List<String>? {
    val extractor = MediaExtractorCompat(context)
    return try {
      extractor.setDataSource(Uri.fromFile(file), 0)
      (0 until extractor.trackCount).mapNotNull { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME) }
    } catch (e: Exception) {
      // UnrecognizedInputFormatException, ParserException or I/O: the container is unknown to Media3.
      null
    } finally {
      extractor.release()
    }
  }
}

/** Width and height as displayed: a 90 or 270 degree rotation swaps them. Null unless both are known. */
internal fun displaySize(width: Int?, height: Int?, rotationDegrees: Int): Pair<Int, Int>? {
  if (width == null || height == null || width <= 0 || height <= 0) return null
  return if (rotationDegrees % 180 == 0) width to height else height to width
}

private fun MediaMetadataRetriever.long(key: Int): Long? = extractMetadata(key)?.trim()?.toLongOrNull()

private fun MediaMetadataRetriever.int(key: Int): Int? = extractMetadata(key)?.trim()?.toIntOrNull()

private fun MediaMetadataRetriever.says(key: Int): Boolean = extractMetadata(key) == "yes"
