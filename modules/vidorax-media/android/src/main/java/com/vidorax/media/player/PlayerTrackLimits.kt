package com.vidorax.media.player

import androidx.media3.common.C
import androidx.media3.common.TrackSelectionParameters

/**
 * P14 #670 Adaptive bitrate: what the player may pick among a stream's video variants. HLS and DASH streams adapt to
 * the connection on their own (ExoPlayer's default); a cap keeps the adapting below a height, for data saving.
 *
 * The cap is a box (`maxLongSide` × `maxLongSide`) instead of a height: "720p" then fits both 1280×720 and a portrait
 * 720×1280 stream, while a 1920×1080 variant is left out. ExoPlayer still plays the smallest variant when none fits.
 */
data class PlayerTrackLimits(
  /** Longest side allowed (854 for 480p, 1280 for 720p, 1920 for 1080p); null = no cap (Auto). */
  val maxLongSide: Int?,
  /** P17 #574 Audio Only Mode: no video track is decoded at all (the battery saving), sound keeps playing. */
  val videoDisabled: Boolean,
) {
  fun applyTo(params: TrackSelectionParameters): TrackSelectionParameters {
    val side = maxLongSide?.takeIf { it > 0 } ?: Int.MAX_VALUE
    return params.buildUpon()
      .setMaxVideoSize(side, side)
      .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, videoDisabled)
      .build()
  }

  companion object {
    val NONE = PlayerTrackLimits(maxLongSide = null, videoDisabled = false)

    /** The JS record, clamped: a cap below 144 px would leave nothing sensible to show. */
    fun of(maxLongSide: Int?, videoDisabled: Boolean): PlayerTrackLimits =
      PlayerTrackLimits(maxLongSide?.takeIf { it > 0 }?.coerceAtLeast(MIN_LONG_SIDE), videoDisabled)

    private const val MIN_LONG_SIDE = 256
  }
}
