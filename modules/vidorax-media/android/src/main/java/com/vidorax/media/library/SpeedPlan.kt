package com.vidorax.media.library

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.FrameDropEffect
import androidx.media3.transformer.Effects
import com.vidorax.media.InvalidRequestException
import kotlin.math.abs
import kotlin.math.roundToLong

/** P12 Change speed (#684): the speed, and the part (both null: the whole video). */
internal data class SpeedSettings(val speed: Float, val startMs: Long?, val endMs: Long?)

/** One speed for the whole item (Transformer asks the speed at each moment and when it next changes: never). */
internal data class ConstantSpeedProvider(val speed: Float) : SpeedProvider {
  override fun getSpeed(timeUs: Long): Float = speed

  override fun getNextSpeedChangeTimeUs(timeUs: Long): Long = C.TIME_UNSET
}

/**
 * P12 Change speed (#684): a NEW item that plays [SpeedSettings.speed] times as fast, of the whole video or a part.
 * [MediaEditor] runs it like any edit. It uses Transformer's own speed change in media3-transformer 1.9.0,
 * `EditedMediaItem.Builder.setSpeed(SpeedProvider)`: at export Transformer puts a `TimestampAdjustment` before the
 * video effects and a `SpeedChangingAudioProcessor` before the audio processors, so picture and sound stay together.
 * The expo-video audio bridge isn't involved.
 *
 * - **Sound:** 1.9.0's `SpeedChangingAudioProcessor` sets Sonic's speed AND pitch to the same value (read from the
 *   bytecode, `updateSpeed`), so the sound changes like a tape played faster or slower: higher at 2×, lower at 0.5×.
 * - **Frames:** none are invented: slowed down, each frame is shown longer (30 fps at 0.5× plays at 15 fps). Sped up,
 *   a copy that would go over 60 fps has frames dropped evenly to 60 (`FrameDropEffect`, after the speed change),
 *   which keeps it within what phone encoders take.
 * - **The part:** like a trim, at least 1 s, inside the video; the copy is that part alone, at the new speed. The video
 *   is re-encoded to H.264, the sound to AAC.
 */
@OptIn(UnstableApi::class)
internal object SpeedPlan {
  const val MIN_SPEED = 0.25
  const val MAX_SPEED = 4.0
  const val MAX_OUTPUT_FRAME_RATE = 60f

  /** What a video of unknown frame rate is taken to have. */
  const val ASSUMED_FRAME_RATE = 30f

  /** The speed and part JavaScript sent, checked. Rejects with ERR_INVALID_REQUEST. */
  fun settings(speed: Double?, startMs: Double?, endMs: Double?): SpeedSettings {
    val value = speed?.takeIf { it.isFinite() } ?: throw InvalidRequestException("A speed change needs a speed")
    if (value < MIN_SPEED || value > MAX_SPEED) throw InvalidRequestException("The speed is 0.25× to 4×")
    if (abs(value - 1.0) < 0.001) throw InvalidRequestException("At 1× the copy would be the same video")
    val start = startMs?.let {
      if (!it.isFinite()) throw InvalidRequestException("The part's start is not a time")
      it.toLong().coerceAtLeast(0)
    }
    val end = endMs?.let {
      if (!it.isFinite()) throw InvalidRequestException("The part's end is not a time")
      it.toLong()
    }
    if (end != null && end - (start ?: 0L) < MediaEditor.MIN_TRIM_MS) throw InvalidRequestException("A part is at least one second long")
    return SpeedSettings(value.toFloat(), start, end)
  }

  /** The part kept, inside a video of [durationMs]: (start, end), or (0, null) for the whole video. */
  fun range(settings: SpeedSettings, durationMs: Long): Pair<Long, Long?> {
    if (settings.startMs == null && settings.endMs == null) return 0L to null
    val min = MediaEditor.MIN_TRIM_MS
    if (durationMs < min) throw InvalidRequestException("A part is at least one second long")
    val start = (settings.startMs ?: 0L).coerceIn(0, durationMs - min)
    val end = (settings.endMs ?: durationMs).coerceIn(start + min, durationMs)
    return if (start == 0L && end >= durationMs) 0L to null else start to end
  }

  /** How long the copy is: the part's length ÷ the speed. Same as JavaScript. */
  fun outputMs(keptMs: Long, speed: Float): Long = (keptMs / speed.toDouble()).roundToLong()

  /**
   * Space for the output: the part's share of the file × [MediaEditor.REENCODE_FACTOR] ÷ the speed (a slower copy is
   * longer). Same as JavaScript.
   */
  fun estimateBytes(sizeBytes: Long, durationMs: Long, startMs: Long, endMs: Long?, speed: Float): Long {
    val fraction = if (endMs != null && durationMs > 0) (endMs - startMs).toDouble() / durationMs else 1.0
    return (sizeBytes * fraction * MediaEditor.REENCODE_FACTOR / speed.toDouble()).toLong()
  }

  fun provider(speed: Float): SpeedProvider = ConstantSpeedProvider(speed)

  /** Sped up past 60 fps: the rate frames are dropped to; null keeps every frame. */
  fun frameRateCap(speed: Float, sourceFrameRate: Float?): Float? {
    if (speed <= 1f) return null
    val output = (sourceFrameRate?.takeIf { it > 0f } ?: ASSUMED_FRAME_RATE) * speed
    return if (output > MAX_OUTPUT_FRAME_RATE + 0.5f) MAX_OUTPUT_FRAME_RATE else null
  }

  fun effects(settings: SpeedSettings, sourceFrameRate: Float?): Effects {
    val cap = frameRateCap(settings.speed, sourceFrameRate)
    return Effects(emptyList(), cap?.let { listOf<Effect>(FrameDropEffect.createDefaultFrameDropEffect(it)) } ?: emptyList())
  }
}
