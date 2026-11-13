package com.vidorax.web.navigation

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationModeTest {
  @Test
  fun mapsTheAospValues() {
    assertEquals("threeButton", NavigationMode.of(0))
    assertEquals("twoButton", NavigationMode.of(1))
    assertEquals("gesture", NavigationMode.of(2))
    assertEquals("unknown", NavigationMode.of(-1))
    assertEquals("unknown", NavigationMode.of(7))
  }
}
