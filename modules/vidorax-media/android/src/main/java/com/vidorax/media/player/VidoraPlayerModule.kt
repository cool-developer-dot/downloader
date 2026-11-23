package com.vidorax.media.player

import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.video.player.VideoPlayer

/**
 * The `VidoraPlayer` Expo module: Faran's Player packages (P14–P19) reach expo-video's ExoPlayer through it — what
 * expo-video's JavaScript API cannot set. Its contract is modules/vidorax-media/src/VidoraPlayer.types.ts.
 *
 * JavaScript passes its expo-video `VideoPlayer` (a shared object) to each call; every call runs on the main thread,
 * where ExoPlayer lives. A player that has been released is ignored (its ExoPlayer refuses calls).
 */
@OptIn(UnstableApi::class)
class VidoraPlayerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VidoraPlayer")

    // P14 #670 (stream quality cap) and P17 #574 (Audio Only Mode: no video decoding).
    AsyncFunction("setTrackLimits") { player: VideoPlayer, maxLongSide: Int?, videoDisabled: Boolean ->
      val exo = player.player
      val limits = PlayerTrackLimits.of(maxLongSide, videoDisabled)
      exo.trackSelectionParameters = limits.applyTo(exo.trackSelectionParameters)
    }.runOnQueue(Queues.MAIN)

    // P14 #670: what the stream plays now, for "Auto · 720p now" (null before the first video format is known).
    AsyncFunction("getPlayingVideoSize") { player: VideoPlayer, promise: Promise ->
      val format = player.player.videoFormat
      if (format == null || format.width <= 0 || format.height <= 0) {
        promise.resolve(null)
      } else {
        promise.resolve(mapOf("width" to format.width, "height" to format.height, "bitrate" to format.bitrate))
      }
    }.runOnQueue(Queues.MAIN)
  }
}
