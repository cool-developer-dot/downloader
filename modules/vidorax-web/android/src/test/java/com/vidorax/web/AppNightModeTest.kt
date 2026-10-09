package com.vidorax.web

import org.junit.Assert.assertEquals
import org.junit.Test

class AppNightModeTest {
  @Test
  fun keepsLightAndDark() {
    assertEquals(AppNightMode.LIGHT, AppNightMode.normalize("light"))
    assertEquals(AppNightMode.DARK, AppNightMode.normalize("dark"))
  }

  @Test
  fun anythingElseFollowsTheDevice() {
    assertEquals(AppNightMode.SYSTEM, AppNightMode.normalize("system"))
    assertEquals(AppNightMode.SYSTEM, AppNightMode.normalize(null))
    assertEquals(AppNightMode.SYSTEM, AppNightMode.normalize(""))
    assertEquals(AppNightMode.SYSTEM, AppNightMode.normalize("logo"))
    assertEquals(AppNightMode.SYSTEM, AppNightMode.normalize("DARK"))
  }
}
