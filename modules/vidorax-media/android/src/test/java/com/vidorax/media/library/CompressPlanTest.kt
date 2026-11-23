package com.vidorax.media.library

import androidx.media3.effect.Presentation
import androidx.media3.transformer.DefaultEncoderFactory
import expo.modules.kotlin.exception.CodedException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** P10 Compress video (#680): the request JavaScript sends, the size it shrinks to, and the estimate. */
@RunWith(RobolectricTestRunner::class)
class CompressPlanTest {
  private fun record(
    video: String = "h264",
    audio: String = "copy",
    videoBitrate: Double? = 2_000_000.0,
    maxShortSide: Double? = 720.0,
  ) = EditRequestRecord(
    sourceId = "lib1",
    kind = "compress",
    video = video,
    audio = audio,
    title = "Clip (compressed)",
    videoBitrate = videoBitrate,
    maxShortSide = maxShortSide,
  )

  @Test
  fun aValidCompressBecomesAnEditRequestWithItsTarget() {
    val request = record().toModel()
    assertEquals(EditKind.COMPRESS, request.kind)
    assertEquals(TrackPlan.H264, request.video)
    assertEquals(CompressSettings(2_000_000, 720), request.compress)
    // Compress never trims: the whole video is kept.
    assertEquals(0L, request.startMs)
    assertNull(request.endMs)
  }

  @Test
  fun compressAlwaysReencodesTheVideoAndNeedsABitrate() {
    assertThrows(CodedException::class.java) { record(video = "copy").toModel() }
    assertThrows(CodedException::class.java) { record(video = "drop").toModel() }
    assertThrows(CodedException::class.java) { record(videoBitrate = null).toModel() }
    assertThrows(CodedException::class.java) { record(videoBitrate = Double.NaN).toModel() }
    assertThrows(CodedException::class.java) { record(videoBitrate = 50_000.0).toModel() }
    assertThrows(CodedException::class.java) { record(videoBitrate = 80_000_000.0).toModel() }
    assertThrows(CodedException::class.java) { record(maxShortSide = 100.0).toModel() }
    assertThrows(CodedException::class.java) { record(maxShortSide = Double.POSITIVE_INFINITY).toModel() }
  }

  @Test
  fun theSizeIsOptionalAndTheSoundMayBeCopiedReencodedOrAbsent() {
    assertNull(record(maxShortSide = null).toModel().compress?.maxShortSide)
    assertEquals(TrackPlan.AAC, record(audio = "aac").toModel().audio)
    assertEquals(TrackPlan.DROP, record(audio = "drop").toModel().audio)
  }

  @Test
  fun otherKindsIgnoreTheCompressFields() {
    val mp4 = EditRequestRecord(sourceId = "lib1", kind = "mp4", video = "copy", audio = "copy", videoBitrate = 1.0).toModel()
    assertNull(mp4.compress)
  }

  @Test
  fun theEditorListsCompressAmongItsKinds() {
    assertEquals(listOf("trim", "mp4", "audio", "compress"), MediaEditor.kinds())
  }

  @Test
  fun aVideoIsOnlyEverScaledDownByItsShortSide() {
    assertEquals(720, CompressPlan.scaledShortSide(1920, 1080, 720))
    // Portrait: the short side is the width.
    assertEquals(720, CompressPlan.scaledShortSide(1080, 1920, 720))
    // Already that small or smaller: kept as it is, never scaled up.
    assertNull(CompressPlan.scaledShortSide(1280, 720, 720))
    assertNull(CompressPlan.scaledShortSide(640, 360, 720))
    // Unknown size or no size asked.
    assertNull(CompressPlan.scaledShortSide(null, 1080, 720))
    assertNull(CompressPlan.scaledShortSide(1920, 0, 720))
    assertNull(CompressPlan.scaledShortSide(1920, 1080, null))
  }

  @Test
  fun theEffectsScaleOnlyWhenNeeded() {
    val settings = CompressSettings(2_000_000, 720)
    val effects = CompressPlan.videoEffects(settings, 1920, 1080)
    assertEquals(1, effects.size)
    assertTrue(effects.single() is Presentation)
    assertTrue(CompressPlan.videoEffects(settings, 1280, 720).isEmpty())
    assertTrue(CompressPlan.effects(settings, 640, 360).videoEffects.isEmpty())
    assertTrue(CompressPlan.effects(settings, 640, 360).audioProcessors.isEmpty())
  }

  @Test
  fun theEstimateIsTheBitratesOverTheLengthPlusTheContainer() {
    val settings = CompressSettings(2_000_000, 720)
    // 60 s × (2 000 000 + 128 000) bit/s ÷ 8 × 1.02 = 16 279 200 bytes; the same numbers as compress-plan.test.ts.
    assertEquals(16_279_200L, CompressPlan.estimateBytes(60_000, settings, hasAudio = true))
    assertEquals(15_300_000L, CompressPlan.estimateBytes(60_000, settings, hasAudio = false))
    assertEquals(0L, CompressPlan.estimateBytes(0, settings, hasAudio = true))
    assertEquals(128_000, CompressPlan.AUDIO_ESTIMATE_BITRATE)
    assertEquals(1.02, CompressPlan.CONTAINER_OVERHEAD, 0.0)
  }

  @Test
  fun theEncoderIsAskedForTheTargetBitrate() {
    val factory = CompressPlan.encoderFactory(RuntimeEnvironment.getApplication(), CompressSettings(1_000_000, null))
    assertTrue(factory is DefaultEncoderFactory)
    // A requested bitrate is what makes Transformer re-encode an H.264 source instead of copying it.
    assertTrue(factory.videoNeedsEncoding())
  }
}
