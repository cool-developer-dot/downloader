package com.vidorax.media.player

import androidx.media3.common.C
import androidx.media3.common.TrackSelectionParameters
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PlayerTrackLimitsTest {
  private val base: TrackSelectionParameters = TrackSelectionParameters.DEFAULT

  @Test
  fun capsBothSidesWithTheLongSideBox() {
    val params = PlayerTrackLimits.of(1280, videoDisabled = false).applyTo(base)
    assertEquals(1280, params.maxVideoWidth)
    assertEquals(1280, params.maxVideoHeight)
    assertFalse(params.disabledTrackTypes.contains(C.TRACK_TYPE_VIDEO))
  }

  @Test
  fun autoLiftsAnEarlierCap() {
    val capped = PlayerTrackLimits.of(854, videoDisabled = false).applyTo(base)
    val auto = PlayerTrackLimits.NONE.applyTo(capped)
    assertEquals(Int.MAX_VALUE, auto.maxVideoWidth)
    assertEquals(Int.MAX_VALUE, auto.maxVideoHeight)
  }

  @Test
  fun audioOnlyDisablesTheVideoTrackAndCanBeUndone() {
    val audioOnly = PlayerTrackLimits.of(null, videoDisabled = true).applyTo(base)
    assertTrue(audioOnly.disabledTrackTypes.contains(C.TRACK_TYPE_VIDEO))
    val back = PlayerTrackLimits.of(null, videoDisabled = false).applyTo(audioOnly)
    assertFalse(back.disabledTrackTypes.contains(C.TRACK_TYPE_VIDEO))
  }

  @Test
  fun keepsOtherSelections() {
    val withLanguage = base.buildUpon().setPreferredAudioLanguage("ur").build()
    val params = PlayerTrackLimits.of(1920, videoDisabled = false).applyTo(withLanguage)
    assertEquals(listOf("ur"), params.preferredAudioLanguages)
  }

  @Test
  fun clampsNonsenseCaps() {
    assertNull(PlayerTrackLimits.of(0, videoDisabled = false).maxLongSide)
    assertNull(PlayerTrackLimits.of(-5, videoDisabled = false).maxLongSide)
    assertEquals(256, PlayerTrackLimits.of(100, videoDisabled = false).maxLongSide)
  }
}
