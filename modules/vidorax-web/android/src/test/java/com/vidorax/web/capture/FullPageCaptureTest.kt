package com.vidorax.web.capture

import com.vidorax.web.capture.FullPageCapture.Plan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FullPageCaptureTest {
  @Test
  fun slicesCoverThePageEndToEndWithoutGoingPastIt() {
    val plan = FullPageCapture.plan(contentHeightPx = 5000, viewWidth = 1080, viewHeight = 2000, maxWidth = 720) as Plan.Slices
    assertEquals(listOf(0, 2000, 3000), plan.offsets) // the last screen ends at the bottom
    assertEquals(720, plan.outWidth)
    assertEquals((5000 * (720f / 1080)).toInt(), plan.outHeight)
  }

  @Test
  fun aZoomedPageIsTallerAndAShortOneIsJustTheScreen() {
    // contentHeightPx already includes density × zoom (CSS height × WebView.scale).
    val zoomed = FullPageCapture.plan(contentHeightPx = (2000 * 2.625f * 1.5f).toInt(), viewWidth = 1080, viewHeight = 2000, maxWidth = 720)
    assertTrue(zoomed is Plan.Slices && zoomed.offsets.size == 4)
    assertEquals(Plan.Single, FullPageCapture.plan(2001, 1080, 2000, 720))
    assertEquals(Plan.Single, FullPageCapture.plan(0, 1080, 2000, 720))
  }

  @Test
  fun aPageTallerThanTheLimitIsRefused() {
    val tallest = (FullPageCapture.MAX_HEIGHT / (720f / 1080)).toInt()
    assertTrue(FullPageCapture.plan(tallest - 10, 1080, 2000, 720) is Plan.Slices)
    assertEquals(Plan.TooLong, FullPageCapture.plan(tallest + 100, 1080, 2000, 720))
  }
}
