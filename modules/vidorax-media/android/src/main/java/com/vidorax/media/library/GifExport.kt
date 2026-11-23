package com.vidorax.media.library

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.os.Build
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.NotFoundException
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.subtitles.SubtitleExport
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.BufferedOutputStream
import java.io.File
import java.io.IOException
import kotlin.math.roundToInt

/** P12 Create GIF (#676): a part of a library video, at a width and a frame rate. */
internal data class GifRequest(
  val sourceId: String,
  val startMs: Long,
  val endMs: Long,
  /** The GIF's width in pixels; never more than the video's own (the height keeps the aspect ratio). */
  val width: Int,
  val fps: Int,
  /** The Gallery file's name ("<video title> 1m23.4s"). */
  val title: String,
)

/** What JavaScript sends to `startGifExport` (src/media-edit/gif-plan.ts decides it). */
data class GifRequestRecord(
  @Field val sourceId: String = "",
  @Field val startMs: Double? = null,
  @Field val endMs: Double? = null,
  @Field val width: Double? = null,
  @Field val fps: Double? = null,
  @Field val title: String = "",
) : Record {
  internal fun toModel(): GifRequest {
    if (sourceId.isBlank()) throw InvalidRequestException("No item to make a GIF of")
    val start = startMs?.takeIf { it.isFinite() && it >= 0 }?.toLong() ?: throw InvalidRequestException("A GIF needs a start")
    val end = endMs?.takeIf { it.isFinite() }?.toLong() ?: throw InvalidRequestException("A GIF needs an end")
    if (end - start < GifPlan.MIN_LENGTH_MS) throw InvalidRequestException("A GIF is at least one second long")
    if (end - start > GifPlan.MAX_LENGTH_MS) throw InvalidRequestException("A GIF is at most 15 seconds long")
    val pixels = width?.takeIf { it.isFinite() }?.roundToInt()
    if (pixels == null || pixels < GifPlan.MIN_WIDTH || pixels > GifPlan.MAX_WIDTH) throw InvalidRequestException("The GIF width is out of range")
    val rate = fps?.takeIf { it.isFinite() }?.roundToInt()
    if (rate == null || rate < GifPlan.MIN_FPS || rate > GifPlan.MAX_FPS) throw InvalidRequestException("The GIF frame rate is out of range")
    return GifRequest(sourceId, start, end, pixels, rate, Titles.clamp(title))
  }
}

/** The frames a GIF is made of, decided before anything is written. */
internal data class GifFramePlan(
  val startMs: Long,
  val endMs: Long,
  val width: Int,
  val height: Int,
  val fps: Int,
  val frames: Int,
)

/** The GIF made: saved in the Gallery ([uri]), with a private copy for Share ([shareName]). */
internal data class GifResult(
  val uri: String,
  val shareName: String,
  val width: Int,
  val height: Int,
  val frames: Int,
  val bytes: Long,
  val durationMs: Long,
) {
  fun toJs(): Map<String, Any> = mapOf(
    "uri" to uri,
    "shareName" to shareName,
    "width" to width,
    "height" to height,
    "frames" to frames,
    "bytes" to bytes.toDouble(),
    "durationMs" to durationMs.toDouble(),
  )
}

/**
 * P12 Create GIF (#676): the GIF's range, size, frame count and size estimate. Pure; src/media-edit/gif-plan.ts does
 * the same maths with the same numbers (both test files check them).
 *
 * - The part is 1 to 15 seconds and stays inside the video (near the end the start moves back, as a trim's does).
 * - The width is never more than the video's (a smaller video keeps its own width); the height keeps the aspect.
 * - Frames: one every 1/fps second from the start, ⌈length × fps⌉ of them (at most 15 s × 15 fps = 225).
 * - Size: 33 bytes for the file (header, screen, loop extension, trailer) plus, per frame, 788 bytes (its control
 *   extension, descriptor, a 256-colour table, LZW code size and terminator) plus the LZW data and one length byte
 *   per 255. The LZW data is counted at 3/5 byte a pixel for the estimate the sheet shows (typical of video frames
 *   without dithering) and at 3/2 byte a pixel (12-bit codes, never more) for the free-space check.
 */
internal object GifPlan {
  const val MIN_LENGTH_MS = 1_000L
  const val MAX_LENGTH_MS = 15_000L
  const val MIN_FPS = 1
  const val MAX_FPS = 15
  const val MIN_WIDTH = 16
  const val MAX_WIDTH = 480
  const val FILE_OVERHEAD_BYTES = 33L
  const val FRAME_OVERHEAD_BYTES = 788L

  /** The part, made valid for a video of [durationMs]: 1–15 s, inside the video. */
  fun clampRange(startMs: Long, endMs: Long, durationMs: Long): Pair<Long, Long> {
    if (durationMs < MIN_LENGTH_MS) throw EditRefusedException("The video is too short for a GIF")
    val length = minOf((endMs - startMs).coerceIn(MIN_LENGTH_MS, MAX_LENGTH_MS), durationMs)
    val start = startMs.coerceIn(0, durationMs - length)
    return start to start + length
  }

  /** The GIF's size for a video of [sourceWidth] × [sourceHeight] at [width] (never wider than the video). */
  fun outputSize(sourceWidth: Int, sourceHeight: Int, width: Int): Pair<Int, Int> {
    require(sourceWidth > 0 && sourceHeight > 0 && width > 0)
    val w = minOf(width, sourceWidth)
    val h = maxOf(1, (sourceHeight.toDouble() * w / sourceWidth).roundToInt())
    return w to h
  }

  fun frameCount(lengthMs: Long, fps: Int): Int = ((lengthMs * fps + 999) / 1_000).toInt()

  /** When frame [index] is taken, in microseconds of the video. */
  fun frameTimeUs(startMs: Long, index: Int, fps: Int): Long = startMs * 1_000 + index * 1_000_000L / fps

  /** About how big the GIF is (shown before it starts). */
  fun estimateBytes(frames: Int, width: Int, height: Int): Long = bytes(frames, width, height, 3, 5)

  /** The most the GIF can take (the free-space check counts this). */
  fun maxBytes(frames: Int, width: Int, height: Int): Long = bytes(frames, width, height, 3, 2)

  /** The free space needed: the GIF in the Gallery and its private share copy. */
  fun spaceNeeded(plan: GifFramePlan): Long = 2 * maxBytes(plan.frames, plan.width, plan.height)

  private fun bytes(frames: Int, width: Int, height: Int, numerator: Long, denominator: Long): Long {
    if (frames <= 0 || width <= 0 || height <= 0) return 0
    val lzw = ceilDiv(width.toLong() * height * numerator, denominator)
    return FILE_OVERHEAD_BYTES + frames * (FRAME_OVERHEAD_BYTES + lzw + ceilDiv(lzw, 255))
  }

  private fun ceilDiv(value: Long, divisor: Long): Long = (value + divisor - 1) / divisor
}

/**
 * P12 Create GIF (#676): the frames from the video and the files. Each frame is the video's frame closest to its moment
 * (`MediaMetadataRetriever.getScaledFrameAtTime`, `OPTION_CLOSEST`, decoded at the GIF's size on Android 8.1+; scaled
 * after a full-size decode on 7–8), handed to [GifEncoder] one at a time. A frame that can't be read repeats the one
 * before, so the timing stays right. The GIF is written to the edit's work folder, saved to the Gallery
 * ([ThumbnailExport.saveGif]), then kept as the one private share copy, `files/library/.gif-exports/<title>.gif` (the
 * module's FileProvider already serves `library/`; only the latest copy is kept, like a screenshot's).
 */
internal object GifExport {
  private const val FOLDER = ".gif-exports"
  const val GIF_EXTENSION = "gif"
  const val GIF_MIME = "image/gif"

  /** Refusals and the frame plan: everything decided before a byte is written. Blocking. */
  fun plan(source: LibraryItem, request: GifRequest): GifFramePlan = plan(EditSources.inspect(source), request)

  /** The frame plan for a video already read ([EditSources.inspect]). Pure. */
  fun plan(info: EditSourceInfo, request: GifRequest): GifFramePlan {
    val (start, end) = GifPlan.clampRange(request.startMs, request.endMs, info.durationMs)
    val (width, height) = GifPlan.outputSize(info.width, info.height, request.width)
    return GifFramePlan(start, end, width, height, request.fps, GifPlan.frameCount(end - start, request.fps))
  }

  /**
   * Writes the GIF of [source] to [output]. [onFrame] gets the number of frames done; [checkActive] throws to stop
   * (Cancel). Blocking; the partial file is the caller's to delete.
   */
  fun write(source: File, plan: GifFramePlan, output: File, onFrame: (Int) -> Unit, checkActive: () -> Unit) {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(source.path)
      BufferedOutputStream(output.outputStream()).use { stream ->
        val encoder = GifEncoder(stream, plan.width, plan.height)
        val delays = GifEncoder.delaysCs(plan.frames, plan.fps)
        val pixels = IntArray(plan.width * plan.height)
        var haveFrame = false
        for (index in 0 until plan.frames) {
          checkActive()
          val frame = grab(retriever, GifPlan.frameTimeUs(plan.startMs, index, plan.fps), plan.width, plan.height)
          if (frame != null) {
            frame.getPixels(pixels, 0, plan.width, 0, 0, plan.width, plan.height)
            frame.recycle()
            haveFrame = true
          } else if (!haveFrame) {
            throw EditRefusedException("No frame could be read from this video")
          }
          encoder.addFrame(pixels, delays[index])
          onFrame(index + 1)
        }
        encoder.finish()
      }
    } finally {
      runCatching { retriever.release() }
    }
  }

  /** The frame closest to [timeUs] at exactly [width] × [height]; null when the video gives none there. */
  private fun grab(retriever: MediaMetadataRetriever, timeUs: Long, width: Int, height: Int): Bitmap? {
    val raw = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        retriever.getScaledFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST, width, height)
      } else {
        retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)
      }
    } catch (e: RuntimeException) {
      null
    } ?: return null
    if (raw.width == width && raw.height == height) return raw
    val scaled = Bitmap.createScaledBitmap(raw, width, height, true)
    if (scaled !== raw) raw.recycle()
    return scaled
  }

  /** Moves the finished GIF to the one private share copy (an older one is removed) and returns it. */
  fun keepShareCopy(paths: StoragePaths, gif: File, title: String): File {
    val folder = File(paths.libraryDir, FOLDER)
    folder.listFiles()?.forEach { it.delete() }
    if (!folder.isDirectory && !folder.mkdirs()) throw IOException("Could not create $folder")
    val target = File(folder, galleryFileName(Titles.clamp(title), GIF_EXTENSION))
    if (!gif.renameTo(target)) {
      gif.copyTo(target, overwrite = true)
      gif.delete()
    }
    return target
  }

  /** The share copy named [shareName] (a bare file name from [GifResult.shareName]); ERR_NOT_FOUND otherwise. */
  fun shareFile(paths: StoragePaths, shareName: String): File {
    val file = File(File(paths.libraryDir, FOLDER), shareName)
    val bareName = shareName.isNotBlank() && file.name == shareName && !shareName.startsWith(".")
    if (!bareName || !shareName.endsWith(".$GIF_EXTENSION") || !file.isFile) {
      throw NotFoundException("The GIF is no longer available")
    }
    return file
  }

  /** Call on the main thread. */
  fun share(context: Context, activity: Activity?, file: File) {
    SubtitleExport.share(context, activity, file, GIF_MIME)
  }
}
