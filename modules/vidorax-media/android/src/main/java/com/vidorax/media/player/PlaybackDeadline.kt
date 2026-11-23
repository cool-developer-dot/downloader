package com.vidorax.media.player

import android.os.Handler
import android.os.Looper
import androidx.media3.common.Player

/**
 * P18 #644 Sleep Timer / #730 Playback Time Limit: one countdown per player, kept natively so it fires with the screen
 * off and VidoraX in the background (JavaScript timers can be held back there). JavaScript arms it with the time left
 * — the sleep timer's or the day's limit, whichever comes first — and re-arms it on every change.
 *
 * When it runs out while the video plays, the sound fades out over `fadeMs`, the player pauses and its volume is put
 * back (the next play is at the usual level); then [onFired] tells JavaScript. Main thread only.
 */
class PlaybackDeadline(private val player: Player, private val onFired: () -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private var fade: Fade? = null

  private val fire = Runnable {
    if (!player.isPlaying) {
      onFired()
      return@Runnable
    }
    startFade()
  }

  /** Runs out `inMs` from now (≤ 0: now); null cancels it (and a fade under way, with the volume put back). */
  fun arm(inMs: Long?, fadeMs: Long) {
    cancel()
    if (inMs == null) return
    fadeDuration = fadeMs.coerceIn(0, MAX_FADE_MS)
    handler.postDelayed(fire, inMs.coerceAtLeast(0))
  }

  fun cancel() {
    handler.removeCallbacks(fire)
    fade?.let { running ->
      handler.removeCallbacks(running)
      player.volume = running.startVolume
    }
    fade = null
  }

  private var fadeDuration = DEFAULT_FADE_MS

  private fun startFade() {
    val steps = FadeCurve.steps(fadeDuration)
    if (steps == 0) {
      finish(player.volume)
      return
    }
    val running = Fade(player.volume, steps)
    fade = running
    handler.post(running)
  }

  private fun finish(restoreVolume: Float) {
    fade = null
    player.pause()
    player.volume = restoreVolume
    onFired()
  }

  private inner class Fade(val startVolume: Float, private val steps: Int) : Runnable {
    private var step = 0

    override fun run() {
      if (fade !== this) return
      step += 1
      if (step >= steps || !player.isPlaying) {
        finish(startVolume)
        return
      }
      player.volume = FadeCurve.volumeAt(startVolume, step, steps)
      handler.postDelayed(this, FadeCurve.STEP_MS)
    }
  }

  companion object {
    const val DEFAULT_FADE_MS = 10_000L
    const val MAX_FADE_MS = 30_000L
  }
}

/** Pure arithmetic of the fade (JVM-tested): a linear ramp down in 100 ms steps. */
object FadeCurve {
  const val STEP_MS = 100L

  fun steps(fadeMs: Long): Int = (fadeMs / STEP_MS).toInt().coerceAtLeast(0)

  fun volumeAt(startVolume: Float, step: Int, steps: Int): Float =
    if (steps <= 0) 0f else (startVolume * (1f - step.toFloat() / steps)).coerceIn(0f, startVolume)
}
