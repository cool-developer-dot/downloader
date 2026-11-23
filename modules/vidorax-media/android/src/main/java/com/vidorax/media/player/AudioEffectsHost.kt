package com.vidorax.media.player

import android.media.audiofx.AudioEffect
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.Virtualizer
import android.util.Log

/**
 * P19 #549 Equalizer, #551 Bass Boost, #552 Virtualizer: Android's own audio effects on one player's audio session
 * (ExoPlayer's `audioSessionId`), so they shape only VidoraX's sound. Each effect is created when first turned on and
 * released when turned off or when the player goes; a phone that lacks one (or lets another app hold it) reports it
 * unavailable instead of failing. Main thread.
 */
class AudioEffectsHost(val sessionId: Int) {
  data class Settings(
    val eqEnabled: Boolean = false,
    /** Millibels per device band (the band list from [describe]); missing bands are 0. */
    val bandLevelsMb: List<Int> = emptyList(),
    /** 0…1000. */
    val bassStrength: Int = 0,
    /** 0…1000. */
    val virtualizerStrength: Int = 0,
  )

  private var equalizer: Equalizer? = null
  private var bass: BassBoost? = null
  private var virtualizer: Virtualizer? = null

  fun apply(settings: Settings) {
    if (sessionId == AudioEffect.ERROR_BAD_VALUE || sessionId <= 0) return
    // Equalizer
    if (settings.eqEnabled) {
      val eq = equalizer ?: create { Equalizer(PRIORITY, sessionId) }.also { equalizer = it }
      eq?.let { effect ->
        runCatching {
          val bands = effect.numberOfBands.toInt()
          val range = effect.bandLevelRange
          for (band in 0 until bands) {
            val level = (settings.bandLevelsMb.getOrNull(band) ?: 0).coerceIn(range[0].toInt(), range[1].toInt())
            effect.setBandLevel(band.toShort(), level.toShort())
          }
          effect.enabled = true
        }.onFailure { Log.w(TAG, "equalizer: ${it.message}") }
      }
    } else {
      equalizer = release(equalizer)
    }
    // Bass boost
    if (settings.bassStrength > 0) {
      val effect = bass ?: create { BassBoost(PRIORITY, sessionId) }.also { bass = it }
      effect?.let {
        runCatching {
          if (it.strengthSupported) it.setStrength(settings.bassStrength.coerceIn(0, 1000).toShort())
          it.enabled = true
        }.onFailure { error -> Log.w(TAG, "bass boost: ${error.message}") }
      }
    } else {
      bass = release(bass)
    }
    // Virtualizer
    if (settings.virtualizerStrength > 0) {
      val effect = virtualizer ?: create { Virtualizer(PRIORITY, sessionId) }.also { virtualizer = it }
      effect?.let {
        runCatching {
          if (it.strengthSupported) it.setStrength(settings.virtualizerStrength.coerceIn(0, 1000).toShort())
          it.enabled = true
        }.onFailure { error -> Log.w(TAG, "virtualizer: ${error.message}") }
      }
    } else {
      virtualizer = release(virtualizer)
    }
  }

  /** What the device's equalizer offers (its bands and level range), and which effects exist; probes if needed. */
  fun describe(): Map<String, Any?> {
    val eq = equalizer ?: create { Equalizer(PRIORITY, sessionId) }
    val bands = eq?.let { effect ->
      runCatching {
        val range = effect.bandLevelRange
        (0 until effect.numberOfBands.toInt()).map { band ->
          mapOf(
            "centerHz" to effect.getCenterFreq(band.toShort()) / 1000,
            "minMb" to range[0].toInt(),
            "maxMb" to range[1].toInt(),
          )
        }
      }.getOrNull()
    }
    if (eq != null && eq !== equalizer) release(eq)
    return mapOf(
      "equalizer" to (bands != null && bands.isNotEmpty()),
      "bands" to (bands ?: emptyList<Map<String, Any>>()),
      "bassBoost" to isAvailable(AudioEffect.EFFECT_TYPE_BASS_BOOST),
      "virtualizer" to isAvailable(AudioEffect.EFFECT_TYPE_VIRTUALIZER),
    )
  }

  fun releaseAll() {
    equalizer = release(equalizer)
    bass = release(bass)
    virtualizer = release(virtualizer)
  }

  private fun <T : AudioEffect> create(factory: () -> T): T? =
    try {
      factory()
    } catch (error: Throwable) {
      // UnsupportedOperationException (no such effect), IllegalArgumentException / RuntimeException (busy, bad session).
      Log.w(TAG, "audio effect unavailable: ${error.message}")
      null
    }

  private fun <T : AudioEffect> release(effect: T?): T? {
    runCatching {
      effect?.enabled = false
      effect?.release()
    }
    return null
  }

  companion object {
    private const val TAG = "VidoraAudioFx"
    private const val PRIORITY = 0

    private fun isAvailable(type: java.util.UUID): Boolean =
      runCatching { AudioEffect.queryEffects().any { it.type == type } }.getOrDefault(false)
  }
}
