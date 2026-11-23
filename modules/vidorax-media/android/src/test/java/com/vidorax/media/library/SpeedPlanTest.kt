package com.vidorax.media.library

import androidx.media3.common.C
import androidx.media3.effect.FrameDropEffect
import expo.modules.kotlin.exception.CodedException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * P12 Change speed (#684): the request (0.25× to 4×, not 1×), the part (inside the video, at least 1 s), the copy's
 * length (the part ÷ the speed) and space (the same numbers as src/media-edit/speed-plan.test.ts), the frame cap.
 */
class SpeedPlanTest {
  private fun record(speed: Double? = 2.0, startMs: Double? = null, endMs: Double? = null, video: String = "h264") =
    EditRequestRecord(
      sourceId = "lib1",
      kind = "speed",
      startMs = startMs,
      endMs = endMs,
      video = video,
      audio = "aac",
      title = "Beach (2× speed)",
      speed = speed,
    )

  @Test
  fun aValidSpeedChangeBecomesAnEditRequest() {
    val request = record().toModel()
    assertEquals(EditKind.SPEED, request.kind)
    assertEquals(SpeedSettings(2f, null, null), request.speed)
    assertEquals(SpeedSettings(0.25f, 10_000, 20_000), record(0.25, 10_000.0, 20_000.0).toModel().speed)
    assertEquals(4f, record(4.0).toModel().speed?.speed)
    // A negative start is the video's start.
    assertEquals(0L, record(0.5, -300.0, 5_000.0).toModel().speed?.startMs)
  }

  @Test
  fun theSpeedIsAQuarterToFourTimesAndNotOne() {
    for (bad in listOf(null, Double.NaN, 0.2, 4.5, 1.0, 1.0004)) {
      assertThrows("$bad", CodedException::class.java) { record(bad).toModel() }
    }
    // A part under one second, or a video edit that doesn't re-encode.
    assertThrows(CodedException::class.java) { record(2.0, 1_000.0, 1_500.0).toModel() }
    assertThrows(CodedException::class.java) { record(2.0, video = "copy").toModel() }
  }

  @Test
  fun thePartStaysInsideTheVideoAndTheWholeVideoHasNoClip() {
    fun range(start: Long?, end: Long?, durationMs: Long = 60_000) = SpeedPlan.range(SpeedSettings(2f, start, end), durationMs)
    assertEquals(0L to null, range(null, null))
    assertEquals(10_000L to 20_000L, range(10_000, 20_000))
    assertEquals(59_000L to 60_000L, range(59_500, null))
    assertEquals(0L to 30_000L, range(null, 30_000))
    // A part that is all of the video is the whole video.
    assertEquals(0L to null, range(0, 60_000))
    assertEquals(0L to null, range(0, 90_000))
    assertThrows(CodedException::class.java) { range(0, 900, durationMs = 900) }
  }

  @Test
  fun theCopyIsThePartDividedByTheSpeedAndTheSpaceTheSameAsJavaScript() {
    assertEquals(5_000L, SpeedPlan.outputMs(10_000, 2f))
    assertEquals(40_000L, SpeedPlan.outputMs(10_000, 0.25f))
    assertEquals(13_333L, SpeedPlan.outputMs(10_000, 0.75f))
    assertEquals(3_333L, SpeedPlan.outputMs(10_000, 3f))
    assertEquals(2_500L, SpeedPlan.outputMs(10_000, 4f))
    // 600 MB: the whole at 2× → 600 MB; a tenth at 0.5× → 240 MB.
    assertEquals(600_000_000L, SpeedPlan.estimateBytes(600_000_000, 600_000, 0, null, 2f))
    assertEquals(240_000_000L, SpeedPlan.estimateBytes(600_000_000, 600_000, 60_000, 120_000, 0.5f))
    assertEquals(4_800_000_000L, SpeedPlan.estimateBytes(600_000_000, 600_000, 0, null, 0.25f))
  }

  @Test
  fun aSpedUpCopyStaysAtSixtyFramesASecondAtMost() {
    assertNull(SpeedPlan.frameRateCap(2f, 30f))
    assertEquals(60f, SpeedPlan.frameRateCap(4f, 30f))
    assertEquals(60f, SpeedPlan.frameRateCap(2f, 60f))
    assertNull(SpeedPlan.frameRateCap(1.5f, 24f))
    // Unknown rate: taken as 30 fps.
    assertEquals(60f, SpeedPlan.frameRateCap(3f, null))
    // Slowed down: every frame is kept (shown longer).
    assertNull(SpeedPlan.frameRateCap(0.5f, 60f))
    assertTrue(SpeedPlan.effects(SpeedSettings(4f, null, null), 30f).videoEffects.single() is FrameDropEffect)
    assertTrue(SpeedPlan.effects(SpeedSettings(0.5f, null, null), 30f).videoEffects.isEmpty())
    assertTrue(SpeedPlan.effects(SpeedSettings(0.5f, null, null), 30f).audioProcessors.isEmpty())
  }

  @Test
  fun theSpeedNeverChangesDuringTheCopy() {
    val provider = SpeedPlan.provider(0.75f)
    assertEquals(0.75f, provider.getSpeed(0))
    assertEquals(0.75f, provider.getSpeed(3_600_000_000))
    assertEquals(C.TIME_UNSET, provider.getNextSpeedChangeTimeUs(0))
    // Transformer compares providers with equals().
    assertEquals(SpeedPlan.provider(0.75f), provider)
  }
}
