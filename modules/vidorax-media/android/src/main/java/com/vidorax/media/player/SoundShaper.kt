package com.vidorax.media.player

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.tanh

/**
 * P19 Audio effects: what [VidoraAudioProcessor] does to each frame, in this order — #555 mono, #556 balance (both for
 * stereo; other layouts pass), #557 night mode (a compressor: quiet parts up, loud parts down), #558 normalization (a
 * slow gain toward one loudness for every video), #548 volume boost, and a soft limiter that keeps boosted or
 * compressed sound from clipping. Pure DSP on float samples in −1…1 (JVM-tested); one instance per processor, state
 * carried across buffers and cleared by [reset] (a seek).
 */
class SoundShaper {
  data class Settings(
    val mono: Boolean = false,
    /** −1 (left only) … 0 … 1 (right only). */
    val balance: Float = 0f,
    val nightMode: Boolean = false,
    val normalize: Boolean = false,
    /** Linear gain, 1 (off) … 4 (+12 dB). */
    val boost: Float = 1f,
  ) {
    val neutral: Boolean
      get() = !mono && abs(balance) < 1e-3f && !nightMode && !normalize && abs(boost - 1f) < 1e-3f
  }

  @Volatile var settings = Settings()

  private var sampleRate = 48_000
  private var compressorEnvelope = 0f
  /** The running loudness (mean square); negative until the first sound (it starts from the sound itself). */
  private var normalizeMeanSquare = -1f
  private var normalizeGain = 1f

  fun configure(sampleRate: Int) {
    this.sampleRate = sampleRate.coerceAtLeast(8_000)
    reset()
  }

  fun reset() {
    compressorEnvelope = 0f
    normalizeMeanSquare = -1f
    normalizeGain = 1f
  }

  /** Processes `frames` interleaved frames of `channels` samples in place. */
  fun process(samples: FloatArray, frames: Int, channels: Int) {
    val s = settings
    if (s.neutral || frames <= 0 || channels <= 0) return
    val stereo = channels == 2
    val leftGain = if (s.balance > 0f) 1f - s.balance else 1f
    val rightGain = if (s.balance < 0f) 1f + s.balance else 1f
    val attack = coefficient(COMPRESSOR_ATTACK_S)
    val release = coefficient(COMPRESSOR_RELEASE_S)
    val normalizeSmoothing = coefficient(NORMALIZE_WINDOW_S)
    val maxGainStep = dbToGain(NORMALIZE_SLEW_DB_PER_S / sampleRate)

    for (frame in 0 until frames) {
      val base = frame * channels
      if (stereo) {
        var l = samples[base]
        var r = samples[base + 1]
        if (s.mono) {
          val m = (l + r) * 0.5f
          l = m
          r = m
        }
        samples[base] = l * leftGain
        samples[base + 1] = r * rightGain
      }

      // The frame's level (its loudest channel) drives the dynamics, so every channel moves together.
      var peak = 0f
      var energy = 0f
      for (c in 0 until channels) {
        val v = samples[base + c]
        peak = max(peak, abs(v))
        energy += v * v
      }

      var gain = s.boost
      if (s.nightMode) {
        val coeff = if (peak > compressorEnvelope) attack else release
        compressorEnvelope = coeff * compressorEnvelope + (1f - coeff) * peak
        gain *= compressorGain(compressorEnvelope)
      }
      if (s.normalize) {
        val frameMeanSquare = energy / channels
        normalizeMeanSquare = if (normalizeMeanSquare < 0f) {
          if (frameMeanSquare > SILENCE_POWER) frameMeanSquare else -1f
        } else {
          normalizeSmoothing * normalizeMeanSquare + (1f - normalizeSmoothing) * frameMeanSquare
        }
        val wanted = if (normalizeMeanSquare < 0f) 1f else normalizeWanted(normalizeMeanSquare)
        // Toward the wanted gain at most NORMALIZE_SLEW_DB_PER_S, so a quiet pause never pumps the sound up at once.
        normalizeGain = if (wanted > normalizeGain) min(wanted, normalizeGain * maxGainStep) else max(wanted, normalizeGain / maxGainStep)
        gain *= normalizeGain
      }

      for (c in 0 until channels) {
        samples[base + c] = softLimit(samples[base + c] * gain)
      }
    }
  }

  private fun coefficient(seconds: Float): Float = exp(-1f / (seconds * sampleRate))

  companion object {
    // #557 Night mode: −30 dBFS threshold, 3:1 above it, then +9 dB make-up so speech comes up.
    const val COMPRESSOR_THRESHOLD_DB = -30f
    const val COMPRESSOR_RATIO = 3f
    const val COMPRESSOR_MAKEUP_DB = 9f
    const val COMPRESSOR_ATTACK_S = 0.005f
    const val COMPRESSOR_RELEASE_S = 0.2f

    // #558 Normalization: toward −20 dBFS RMS measured over ~1.5 s, ±12 dB at most, 6 dB a second at most.
    const val NORMALIZE_TARGET_DB = -20f
    const val NORMALIZE_MAX_DB = 12f
    const val NORMALIZE_WINDOW_S = 1.5f
    const val NORMALIZE_SLEW_DB_PER_S = 6f
    /** Below this (−60 dBFS) the sound is silence: normalization holds its gain. */
    const val SILENCE_DB = -60f

    private val SILENCE_POWER = dbToPower(SILENCE_DB)

    fun dbToGain(db: Float): Float = 10f.pow(db / 20f)

    private fun dbToPower(db: Float): Float = 10f.pow(db / 10f)

    fun gainToDb(gain: Float): Float = 20f * log10(max(gain, 1e-9f))

    /** The compressor's gain for an envelope level: 1× below the threshold, 3:1 above it, plus the make-up. */
    fun compressorGain(envelope: Float): Float {
      val levelDb = gainToDb(envelope)
      val reductionDb = if (levelDb > COMPRESSOR_THRESHOLD_DB) {
        (levelDb - COMPRESSOR_THRESHOLD_DB) * (1f - 1f / COMPRESSOR_RATIO)
      } else {
        0f
      }
      return dbToGain(COMPRESSOR_MAKEUP_DB - reductionDb)
    }

    /** The gain that brings a mean square to the target, within ±12 dB; 1× for silence. */
    fun normalizeWanted(meanSquare: Float): Float {
      val levelDb = 10f * log10(max(meanSquare, 1e-12f))
      if (levelDb < SILENCE_DB) return 1f
      val gainDb = (NORMALIZE_TARGET_DB - levelDb).coerceIn(-NORMALIZE_MAX_DB, NORMALIZE_MAX_DB)
      return dbToGain(gainDb)
    }

    /** Unchanged up to 0.8; above, eased toward ±1 (never past it; very loud input reaches it). */
    fun softLimit(x: Float): Float {
      val a = abs(x)
      if (a <= LIMIT_KNEE) return x
      val shaped = LIMIT_KNEE + (1f - LIMIT_KNEE) * tanh((a - LIMIT_KNEE) / (1f - LIMIT_KNEE))
      return if (x < 0f) -shaped else shaped
    }

    private const val LIMIT_KNEE = 0.8f

    /** #548: a boost percent (100–200) as a linear gain (200% = +6 dB = 2×). */
    fun boostGain(percent: Int): Float = percent.coerceIn(100, 200) / 100f
  }
}
