package com.vidorax.media.library

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import com.vidorax.media.NotFoundException
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.process.MediaFiles
import com.vidorax.media.process.MediaProcessor
import com.vidorax.media.process.TrackContainer
import com.vidorax.media.verify.Verifier
import com.vidorax.media.verify.VerifyResult

/** P12: what an export needs to know about a library video, read before anything is written. */
internal data class EditSourceInfo(
  val durationMs: Long,
  /** The picture's size as displayed (rotation applied). */
  val width: Int,
  val height: Int,
  /** Frames per second when the container says so; null otherwise. */
  val frameRate: Float?,
  val hasAudio: Boolean,
)

/**
 * P12 Create GIF (#676) and Merge videos (#682): a library video read and checked the way [MediaEditor] checks an
 * edit's source — the file is there, the verifier accepts it, it isn't protected, it has video and a known length —
 * plus its displayed size and frame rate. Refuses with ERR_NOT_FOUND / ERR_EDIT_REFUSED. Blocking.
 */
@OptIn(UnstableApi::class)
internal object EditSources {
  fun inspect(item: LibraryItem): EditSourceInfo {
    if (!item.file.isFile) throw NotFoundException("The file of ${item.id} is missing")
    val verdict = Verifier.verify(item.file)
    if (verdict is VerifyResult.Invalid) throw EditRefusedException("This file cannot be edited (${verdict.detail})")
    val info = MediaFiles.read(item.file, MediaProcessor.trackContainer(item.container))
      ?: MediaFiles.read(item.file, TrackContainer.UNKNOWN)
      ?: throw EditRefusedException("This file cannot be read")
    if (info.encrypted) throw EditRefusedException("This file is protected")
    val video = info.video ?: throw EditRefusedException("This file has no video")
    val durationMs = item.durationMs ?: info.durationUs?.let { it / 1_000 } ?: throw EditRefusedException("Unknown length")
    val format = video.format
    val size = displaySize(item.width, item.height, 0)
      ?: displaySize(format.width.takeIf { it > 0 }, format.height.takeIf { it > 0 }, format.rotationDegrees)
      ?: throw EditRefusedException("The picture's size is unknown")
    return EditSourceInfo(
      durationMs = durationMs,
      width = size.first,
      height = size.second,
      frameRate = format.frameRate.takeIf { it > 0f },
      hasAudio = info.audio != null,
    )
  }
}
