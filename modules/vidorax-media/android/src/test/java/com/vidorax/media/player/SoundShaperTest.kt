package com.vidorax.media.player

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.sin
import kotlin.math.sqrt

class SoundShaperTest {
  private fun shaper(settings: SoundShaper.Settings) = SoundShaper().apply {
    configure(48_000)
    this.settings = settings
  }

  private fun rms(samples: FloatArray, from: Int = 0): Float {
    var sum = 0.0
    for (i in from until samples.size) sum += samples[i] * samples[i]
    return sqrt(sum / (samples.size - from)).toFloat()
  }

  /** A 1 kHz stereo sine at `amplitude`, `seconds` long, both channels the same. */
  private fun tone(amplitude: Float, seconds: Float): FloatArray {
    val frames = (48_000 * seconds).toInt()
    return FloatArray(frames * 2) { i -> amplitude * sin(2 * Math.PI * 1000 * (i / 2) / 48_000).toFloat() }
  }

  @Test
  fun neutralLeavesTheSoundAlone() {
    val samples = floatArrayOf(0.5f, -0.25f, 0.9f, 0.1f)
    shaper(SoundShaper.Settings()).process(samples, 2, 2)
    assertArrayEquals(floatArrayOf(0.5f, -0.25f, 0.9f, 0.1f), samples, 0f)
  }

  @Test
  fun monoAveragesBothEars() {
    val samples = floatArrayOf(0.6f, 0f, 0.2f, 0.4f)
    shaper(SoundShaper.Settings(mono = true)).process(samples, 2, 2)
    assertArrayEquals(floatArrayOf(0.3f, 0.3f, 0.3f, 0.3f), samples, 1e-6f)
  }

  @Test
  fun balanceTurnsOneSideDown() {
    val right = floatArrayOf(0.5f, 0.5f)
    shaper(SoundShaper.Settings(balance = 0.5f)).process(right, 1, 2)
    assertArrayEquals(floatArrayOf(0.25f, 0.5f), right, 1e-6f)
    val left = floatArrayOf(0.5f, 0.5f)
    shaper(SoundShaper.Settings(balance = -1f)).process(left, 1, 2)
    assertArrayEquals(floatArrayOf(0.5f, 0f), left, 1e-6f)
  }

  @Test
  fun monoAndBalanceOnlyTouchStereo() {
    val surround = floatArrayOf(0.1f, 0.2f, 0.3f, 0.4f, 0.5f, 0.6f)
    shaper(SoundShaper.Settings(mono = true, balance = 1f)).process(surround, 1, 6)
    assertArrayEquals(floatArrayOf(0.1f, 0.2f, 0.3f, 0.4f, 0.5f, 0.6f), surround, 1e-6f)
  }

  @Test
  fun boostIsLimitedNeverClipping() {
    assertEquals(1f, SoundShaper.boostGain(50), 0f)
    assertEquals(1.5f, SoundShaper.boostGain(150), 1e-6f)
    assertEquals(2f, SoundShaper.boostGain(400), 1e-6f)
    val samples = tone(0.9f, 0.05f)
    shaper(SoundShaper.Settings(boost = 2f)).process(samples, samples.size / 2, 2)
    assertTrue(samples.all { abs(it) <= 1f })
    // Quiet sound is simply louder.
    val quiet = floatArrayOf(0.1f, -0.1f)
    shaper(SoundShaper.Settings(boost = 2f)).process(quiet, 1, 2)
    assertArrayEquals(floatArrayOf(0.2f, -0.2f), quiet, 1e-6f)
  }

  @Test
  fun softLimitKeepsTheKneeAndStaysBelowOne() {
    assertEquals(0.5f, SoundShaper.softLimit(0.5f), 0f)
    assertEquals(-0.8f, SoundShaper.softLimit(-0.8f), 1e-6f)
    assertTrue(SoundShaper.softLimit(3f) <= 1f)
    assertTrue(SoundShaper.softLimit(-3f) >= -1f)
    assertTrue(SoundShaper.softLimit(1.1f) < 1f)
    assertTrue(SoundShaper.softLimit(0.9f) in 0.8f..0.9f)
  }

  @Test
  fun nightModeBringsQuietUpAndLoudDown() {
    // −40 dBFS speech-like tone comes up (make-up gain); a −3 dBFS one is turned down.
    val quiet = tone(0.01f, 0.5f)
    val loud = tone(0.7f, 0.5f)
    val quietBefore = rms(quiet)
    val loudBefore = rms(loud)
    shaper(SoundShaper.Settings(nightMode = true)).process(quiet, quiet.size / 2, 2)
    shaper(SoundShaper.Settings(nightMode = true)).process(loud, loud.size / 2, 2)
    assertTrue("quiet up", rms(quiet, quiet.size / 2) > quietBefore * 2f)
    assertTrue("loud down", rms(loud, loud.size / 2) < loudBefore)
    assertEquals(SoundShaper.dbToGain(SoundShaper.COMPRESSOR_MAKEUP_DB), SoundShaper.compressorGain(0.001f), 1e-4f)
  }

  @Test
  fun normalizationMovesTowardOneLoudnessSlowly() {
    assertEquals(1f, SoundShaper.normalizeWanted(1e-8f), 0f) // silence holds
    assertEquals(SoundShaper.dbToGain(12f), SoundShaper.normalizeWanted(1e-5f), 1e-3f) // capped at +12 dB
    val quiet = tone(0.02f, 4f) // about −37 dBFS RMS
    val before = rms(quiet)
    shaper(SoundShaper.Settings(normalize = true)).process(quiet, quiet.size / 2, 2)
    val lastSecond = rms(quiet, quiet.size - 48_000 * 2)
    assertTrue("louder", lastSecond > before * 2f)
    // Never more than 12 dB (4×) up.
    assertTrue("capped", lastSecond <= before * 4.01f)
  }
}
