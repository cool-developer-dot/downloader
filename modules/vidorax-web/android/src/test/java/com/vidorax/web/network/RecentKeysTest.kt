package com.vidorax.web.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecentKeysTest {
  @Test
  fun rejectsRepeatsInsideTheWindow() {
    val keys = RecentKeys(windowMs = 2_000)
    assertTrue(keys.add("a", now = 1_000))
    assertFalse(keys.add("a", now = 2_999))
    assertTrue(keys.add("b", now = 2_999))
  }

  @Test
  fun acceptsAKeyAgainOnceItsWindowHasPassed() {
    val keys = RecentKeys(windowMs = 2_000)
    assertTrue(keys.add("a", now = 1_000))
    assertTrue(keys.add("b", now = 2_500))
    assertTrue(keys.add("a", now = 3_000))
    assertFalse(keys.add("b", now = 4_499))
    assertTrue(keys.add("b", now = 4_500))
  }

  @Test
  fun repeatsDoNotExtendTheWindow() {
    val keys = RecentKeys(windowMs = 2_000)
    assertTrue(keys.add("a", now = 0))
    assertFalse(keys.add("a", now = 1_500))
    assertTrue(keys.add("a", now = 2_000))
  }
}
