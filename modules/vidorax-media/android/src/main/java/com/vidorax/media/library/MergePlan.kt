package com.vidorax.media.library

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.FrameDropEffect
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.model.LibraryItem
import kotlin.math.roundToInt

/** P12 Merge videos (#682): the library videos to join, in their order. */
internal data class MergeSettings(val sourceIds: List<String>)

/** One video of a merge, as read before anything is written. */
internal data class MergePart(val item: LibraryItem, val info: EditSourceInfo)

/** The joined video. */
internal data class MergeLayout(
  val parts: List<MergePart>,
  /** The output's size: the first video's, rounded down to even numbers (the H.264 encoder needs them). */
  val width: Int,
  val height: Int,
  /** The first video's frame rate (null when unknown): a faster clip is dropped to it. */
  val frameRate: Float?,
  /** Some video has sound: the output gets a sound track, silent while a video without sound plays. */
  val hasAudio: Boolean,
) {
  val totalMs: Long get() = parts.sumOf { it.info.durationMs }
  val sizeBytes: Long get() = parts.sumOf { it.item.sizeBytes }
}

/**
 * P12 Merge videos (#682): two or more library videos joined one after another into a NEW item, with one Media3
 * Transformer composition (a single `EditedMediaItemSequence`, media3-transformer 1.9.0). [MediaEditor] runs it like any
 * edit (one at a time, progress, Cancel, free-space check, the output checked, a new library row).
 *
 * - **Size:** the output has the first video's displayed size. Every video is fitted inside it with
 *   `Presentation.createForWidthAndHeight(w, h, LAYOUT_SCALE_TO_FIT)`: scaled up or down with its aspect ratio kept,
 *   black bars filling the rest ([fitInside] is that maths). The first video fits exactly.
 * - **Frame rate:** frames keep their own timestamps, so every clip plays at its real speed. A clip with a higher frame
 *   rate than the first video is dropped to the first one's rate (`FrameDropEffect`); a slower clip keeps its frames
 *   (none are invented), so the file can have a variable frame rate, which MP4 carries.
 * - **Sound:** in 1.9.0 every video of a sequence must give the tracks the sequence declares. When any video has sound
 *   the sequence is `withAudioAndVideoFrom` (its track types include audio, which sets `forceAudioTrack`): a video
 *   without sound gets silence for its length. When none has sound it is `withVideoFrom` and the output has none.
 *   (`experimentalSetForceAudioTrack` is deprecated in 1.9.0 and refuses a sequence built with track types.)
 * - The video is always re-encoded to H.264 (Transformer re-encodes any sequence of more than one item); the sound to
 *   AAC.
 */
@OptIn(UnstableApi::class)
internal object MergePlan {
  const val MIN_VIDEOS = 2
  const val MAX_VIDEOS = 10

  /** Rates this close count as the same (29.97 and 30 fps). */
  const val FRAME_RATE_SLACK = 0.5f

  /**
   * The videos JavaScript sent, checked: 2–[MAX_VIDEOS] ids, each once, and [sourceId] (the video the merge was started
   * from, whose site and page the new item gets) one of them. Rejects with ERR_INVALID_REQUEST.
   */
  fun settings(sourceId: String, sourceIds: List<String>?): MergeSettings {
    val ids = sourceIds ?: throw InvalidRequestException("A merge needs its videos")
    if (ids.size < MIN_VIDEOS) throw InvalidRequestException("A merge joins at least two videos")
    if (ids.size > MAX_VIDEOS) throw InvalidRequestException("A merge joins at most $MAX_VIDEOS videos")
    if (ids.any { it.isBlank() }) throw InvalidRequestException("A merge video has no id")
    if (ids.toSet().size != ids.size) throw InvalidRequestException("A video is in the merge twice")
    if (sourceId !in ids) throw InvalidRequestException("The merge starts from one of its videos")
    return MergeSettings(ids)
  }

  /** One video, read and checked like an edit's source. Blocking. */
  fun inspect(item: LibraryItem): MergePart = MergePart(item, EditSources.inspect(item))

  /** Even numbers (rounded down), at least 2. */
  fun evenSize(width: Int, height: Int): Pair<Int, Int> = maxOf(2, width - width % 2) to maxOf(2, height - height % 2)

  /**
   * Where a [width] × [height] picture ends up inside [boxWidth] × [boxHeight]: scaled to fit with its aspect ratio
   * kept (what `LAYOUT_SCALE_TO_FIT` draws; the rest is black).
   */
  fun fitInside(boxWidth: Int, boxHeight: Int, width: Int, height: Int): Pair<Int, Int> {
    require(boxWidth > 0 && boxHeight > 0 && width > 0 && height > 0)
    val scale = minOf(boxWidth.toDouble() / width, boxHeight.toDouble() / height)
    return (width * scale).roundToInt().coerceIn(1, boxWidth) to (height * scale).roundToInt().coerceIn(1, boxHeight)
  }

  fun layout(parts: List<MergePart>): MergeLayout {
    require(parts.size >= MIN_VIDEOS) { "A merge joins at least two videos" }
    val first = parts.first().info
    val (width, height) = evenSize(first.width, first.height)
    return MergeLayout(parts, width, height, first.frameRate, parts.any { it.info.hasAudio })
  }

  /** The rate a clip is dropped to: the first video's, when the clip is faster; null keeps all its frames. */
  fun frameRateCap(first: Float?, part: Float?): Float? =
    if (first != null && part != null && part > first + FRAME_RATE_SLACK) first else null

  /** Space for the output, as for any re-encode: the videos' sizes × [MediaEditor.REENCODE_FACTOR]. Same as JavaScript. */
  fun estimateBytes(layout: MergeLayout): Long = (layout.sizeBytes * MediaEditor.REENCODE_FACTOR).toLong()

  /** A faster clip's frame drop first (less to scale), then the fit into the output's size. */
  fun videoEffects(layout: MergeLayout, part: MergePart): List<Effect> = buildList {
    frameRateCap(layout.frameRate, part.info.frameRate)?.let { add(FrameDropEffect.createDefaultFrameDropEffect(it)) }
    add(Presentation.createForWidthAndHeight(layout.width, layout.height, Presentation.LAYOUT_SCALE_TO_FIT))
  }

  /** The one sequence of every video in order. [keepAudio] false leaves the sound out. */
  fun composition(layout: MergeLayout, keepAudio: Boolean): Composition {
    val items = layout.parts.map { part ->
      EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(part.item.file)))
        .setRemoveAudio(!keepAudio)
        .setEffects(Effects(emptyList(), videoEffects(layout, part)))
        .build()
    }
    val sequence = if (keepAudio) {
      EditedMediaItemSequence.withAudioAndVideoFrom(items)
    } else {
      EditedMediaItemSequence.withVideoFrom(items)
    }
    return Composition.Builder(sequence).build()
  }
}
