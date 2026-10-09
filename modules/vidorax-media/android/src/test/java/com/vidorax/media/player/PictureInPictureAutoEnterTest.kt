package com.vidorax.media.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PictureInPictureAutoEnterTest {
  @Test
  fun entersOnlyOnAndroid8To11WhileArmed() {
    assertTrue(PictureInPictureAutoEnter.shouldEnterOnLeave(26, armed = true, supported = true, inPictureInPicture = false))
    assertTrue(PictureInPictureAutoEnter.shouldEnterOnLeave(30, armed = true, supported = true, inPictureInPicture = false))
    // Android 12+: expo-video's setAutoEnterEnabled enters PiP; asking again would race it.
    assertFalse(PictureInPictureAutoEnter.shouldEnterOnLeave(31, armed = true, supported = true, inPictureInPicture = false))
    assertFalse(PictureInPictureAutoEnter.shouldEnterOnLeave(35, armed = true, supported = true, inPictureInPicture = false))
    // No PictureInPictureParams before Android 8.
    assertFalse(PictureInPictureAutoEnter.shouldEnterOnLeave(25, armed = true, supported = true, inPictureInPicture = false))
  }

  @Test
  fun neverEntersWhenNotPlayingUnsupportedOrAlreadyInPictureInPicture() {
    assertFalse(PictureInPictureAutoEnter.shouldEnterOnLeave(29, armed = false, supported = true, inPictureInPicture = false))
    assertFalse(PictureInPictureAutoEnter.shouldEnterOnLeave(29, armed = true, supported = false, inPictureInPicture = false))
    assertFalse(PictureInPictureAutoEnter.shouldEnterOnLeave(29, armed = true, supported = true, inPictureInPicture = true))
  }

  @Test
  fun aspectRatioStaysInsideThePictureInPictureLimits() {
    assertEquals(1920 to 1080, PictureInPictureAutoEnter.safeAspect(1920, 1080))
    assertEquals(1080 to 1920, PictureInPictureAutoEnter.safeAspect(1080, 1920))
    // 3:1 and 1:3 would make PictureInPictureParams throw.
    assertEquals(239 to 100, PictureInPictureAutoEnter.safeAspect(3000, 1000))
    assertEquals(100 to 239, PictureInPictureAutoEnter.safeAspect(1000, 3000))
    assertNull(PictureInPictureAutoEnter.safeAspect(0, 1080))
    assertNull(PictureInPictureAutoEnter.safeAspect(1920, -1))
  }
}
