package com.vidorax.web.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SuspendedViewsTest {
  @Test
  fun aParkedViewIsSuspendedUntilItIsActiveAgain() {
    val views = SuspendedViews(capacity = 8)
    views.set(11, suspended = true)
    assertTrue(11 in views)
    assertFalse(12 in views)
    views.set(11, suspended = false)
    assertFalse(11 in views)
  }

  @Test
  fun parkingTheSameViewTwiceKeepsOneEntry() {
    val views = SuspendedViews(capacity = 2)
    views.set(1, suspended = true)
    views.set(1, suspended = true)
    views.set(2, suspended = true)
    assertTrue(1 in views)
    assertTrue(2 in views)
  }

  @Test
  fun staysBoundedDroppingTheOldestTags() {
    val views = SuspendedViews(capacity = 2)
    views.set(1, suspended = true)
    views.set(2, suspended = true)
    views.set(3, suspended = true)
    assertFalse(1 in views)
    assertTrue(2 in views)
    assertTrue(3 in views)
  }

  @Test
  fun reParkingAViewMakesItTheNewest() {
    val views = SuspendedViews(capacity = 2)
    views.set(1, suspended = true)
    views.set(2, suspended = true)
    views.set(1, suspended = true)
    views.set(3, suspended = true)
    assertTrue(1 in views)
    assertFalse(2 in views)
  }
}
