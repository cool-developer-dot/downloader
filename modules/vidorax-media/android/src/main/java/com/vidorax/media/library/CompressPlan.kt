package com.vidorax.media.library

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Codec
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.Effects
import androidx.media3.transformer.VideoEncoderSettings
import com.vidorax.media.InvalidRequestException
import kotlin.math.ceil

/** P10 Compress video (#680): the target a COMPRESS edit re-encodes the video to. */
internal data class CompressSettings(
  /** The H.264 encoder's target, in bits per second. */
  val videoBitrate: Int,
  /** The output's short side at most this (in pixels); null keeps the size. Never scales up. */
  val maxShortSide: Int?,
)

/**
 * P10 Compress video (#680): what a COMPRESS edit changes, used by [MediaEditor] (which runs it like any other edit:
 * one at a time, progress, Cancel, the free-space check, a NEW library item). The video is always re-encoded to H.264
 * at [CompressSettings.videoBitrate] — a requested encoder bitrate makes Transformer encode even an H.264 source
 * (`DefaultEncoderFactory.videoNeedsEncoding`) — and scaled down, never up, so its short side is at most
 * [CompressSettings.maxShortSide] (`Presentation.createForShortSide` keeps portrait and landscape the right way round).
 * The sound goes as in an MP4 conversion: AAC is copied, anything else re-encoded to AAC. Only media3-transformer
 * (and media3-effect, which it brings) is used. JavaScript picks the preset (src/media-edit/compress-plan.ts) and shows
 * the same estimate as [estimateBytes].
 */
@OptIn(UnstableApi::class)
internal object CompressPlan {
  const val MIN_VIDEO_BITRATE = 100_000
  const val MAX_VIDEO_BITRATE = 50_000_000
  const val MIN_SHORT_SIDE = 144
  const val MAX_SHORT_SIDE = 4_320

  /** What the estimate counts for the sound (AAC, copied or re-encoded). Same as JavaScript. */
  const val AUDIO_ESTIMATE_BITRATE = 128_000

  /** The MP4 container's own bytes on top of the tracks. Same as JavaScript. */
  const val CONTAINER_OVERHEAD = 1.02

  /** The settings JavaScript sent, checked. Rejects with ERR_INVALID_REQUEST. */
  fun settings(videoBitrate: Double?, maxShortSide: Double?): CompressSettings {
    val bitrate = videoBitrate?.takeIf { it.isFinite() }?.toLong()
      ?: throw InvalidRequestException("A compress edit needs a video bitrate")
    if (bitrate < MIN_VIDEO_BITRATE || bitrate > MAX_VIDEO_BITRATE) {
      throw InvalidRequestException("The video bitrate is out of range")
    }
    val side = maxShortSide?.let { value ->
      if (!value.isFinite()) throw InvalidRequestException("The size is out of range")
      value.toLong()
    }
    if (side != null && (side < MIN_SHORT_SIDE || side > MAX_SHORT_SIDE)) {
      throw InvalidRequestException("The size is out of range")
    }
    return CompressSettings(bitrate.toInt(), side?.toInt())
  }

  /**
   * The output's short side when the video must shrink to fit [maxShortSide]; null when it already fits (it is never
   * scaled up), when no size is asked for, or when the video's size is unknown.
   */
  fun scaledShortSide(width: Int?, height: Int?, maxShortSide: Int?): Int? {
    if (maxShortSide == null || width == null || height == null || width <= 0 || height <= 0) return null
    return if (minOf(width, height) > maxShortSide) maxShortSide else null
  }

  /** About how big the output is: the bitrates over the length, plus the container. 0 for an unknown length. */
  fun estimateBytes(durationMs: Long, settings: CompressSettings, hasAudio: Boolean): Long {
    if (durationMs <= 0) return 0
    val bitsPerSecond = settings.videoBitrate.toLong() + if (hasAudio) AUDIO_ESTIMATE_BITRATE.toLong() else 0L
    return ceil(bitsPerSecond * (durationMs / 1_000.0) / 8.0 * CONTAINER_OVERHEAD).toLong()
  }

  /** The encoder asked for the target bitrate (the platform may fall back to the closest it supports). */
  fun encoderFactory(context: Context, settings: CompressSettings): Codec.EncoderFactory =
    DefaultEncoderFactory.Builder(context)
      .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(settings.videoBitrate).build())
      .build()

  /** A scale-down when the video is bigger than asked; nothing otherwise. */
  fun videoEffects(settings: CompressSettings, width: Int?, height: Int?): List<Effect> =
    scaledShortSide(width, height, settings.maxShortSide)?.let { listOf<Effect>(Presentation.createForShortSide(it)) }
      ?: emptyList()

  fun effects(settings: CompressSettings, width: Int?, height: Int?): Effects =
    Effects(emptyList(), videoEffects(settings, width, height))
}
