package com.vidorax.media.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ThumbnailsTest {
  @Test
  fun frameIsTenPercentInAndAtLeastOneSecond() {
    assertEquals(6_000L, thumbnailFrameTimeMs(60_000))
    assertEquals(1_000L, thumbnailFrameTimeMs(5_000))
    assertEquals(1_000L, thumbnailFrameTimeMs(null))
  }

  @Test
  fun frameStaysInsideVeryShortMedia() {
    assertEquals(400L, thumbnailFrameTimeMs(800))
    assertEquals(500L, thumbnailFrameTimeMs(1_000))
  }

  @Test
  fun sizeIs480WideWithTheAspectRatioKept() {
    assertEquals(480 to 270, thumbnailSize(1920, 1080))
    assertEquals(480 to 853, thumbnailSize(1080, 1920))
    assertEquals(320 to 240, thumbnailSize(320, 240))
    assertNull(thumbnailSize(null, 1080))
  }

  @Test
  fun displayedSizeAppliesRotation() {
    assertEquals(1920 to 1080, displaySize(1920, 1080, 0))
    assertEquals(1080 to 1920, displaySize(1920, 1080, 90))
    assertEquals(1920 to 1080, displaySize(1920, 1080, 180))
    assertEquals(1080 to 1920, displaySize(1920, 1080, -90))
    assertNull(displaySize(0, 1080, 0))
  }
}
