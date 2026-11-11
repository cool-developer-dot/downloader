package com.vidorax.media.library

import expo.modules.kotlin.exception.CodedException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** The edit request JavaScript sends is checked before anything runs. */
class MediaEditorTest {
  private fun record(
    kind: String = "trim",
    video: String = "copy",
    audio: String = "copy",
    startMs: Double? = 2_000.0,
    endMs: Double? = 9_000.0,
  ) = EditRequestRecord(
    sourceId = "lib1",
    kind = kind,
    startMs = startMs,
    endMs = endMs,
    keyframeStart = true,
    video = video,
    audio = audio,
    title = "Clip (trimmed)",
  )

  @Test
  fun aValidTrimBecomesAnEditRequest() {
    val request = record().toModel()
    assertEquals(EditKind.TRIM, request.kind)
    assertEquals(2_000L, request.startMs)
    assertEquals(9_000L, request.endMs)
    assertEquals(TrackPlan.COPY, request.video)
    assertTrue(request.keyframeStart)
  }

  @Test
  fun aNegativeStartIsClampedToZero() {
    assertEquals(0L, record(startMs = -5_000.0).toModel().startMs)
  }

  @Test
  fun audioOnlyMustDropTheVideoAndKeepTheSound() {
    assertEquals(TrackPlan.DROP, record(kind = "audio", video = "drop", audio = "aac").toModel().video)
    assertThrows(CodedException::class.java) { record(kind = "audio", video = "copy").toModel() }
    assertThrows(CodedException::class.java) { record(kind = "audio", video = "drop", audio = "drop").toModel() }
  }

  @Test
  fun aVideoEditKeepsTheVideoAndPlansMatchTheirTrack() {
    assertThrows(CodedException::class.java) { record(kind = "mp4", video = "drop").toModel() }
    assertThrows(CodedException::class.java) { record(video = "aac").toModel() }
    assertThrows(CodedException::class.java) { record(audio = "h264").toModel() }
  }

  @Test
  fun unknownKindsAndPlansAreRefused() {
    assertThrows(CodedException::class.java) { record(kind = "rotate").toModel() }
    assertThrows(CodedException::class.java) { record(video = "vp9").toModel() }
    assertThrows(CodedException::class.java) { EditRequestRecord(kind = "trim").toModel() }
  }

  @Test
  fun theOneSecondMinimumIsTheSameAsInJavaScript() {
    assertEquals(1_000L, MediaEditor.MIN_TRIM_MS)
    assertFalse(MediaEditor.REENCODE_FACTOR < MediaEditor.COPY_FACTOR)
  }
}
