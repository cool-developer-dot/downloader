package com.vidorax.web.apps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class AppLinksTest {
  @Test
  fun onlyTheListedAppsAndTheirFirstInstalledPackage() {
    assertEquals(setOf("youtube", "instagram", "facebook", "tiktok", "x", "maps"), AppLinks.PACKAGES.keys)
    assertEquals("com.facebook.lite", AppLinks.installedPackage("facebook") { it == "com.facebook.lite" })
    assertNull(AppLinks.installedPackage("maps") { false })
    assertNull("an app VidoraX doesn't know", AppLinks.installedPackage("com.evil.app") { true })
  }

  @Test
  fun opensOnlyHttpsPagesInAnInstalledApp() {
    val context = RuntimeEnvironment.getApplication()
    assertFalse(AppLinks.open(context, "maps", "intent://evil"))
    assertFalse("not installed here", AppLinks.open(context, "maps", "https://maps.google.com/?q=Lahore"))
  }
}
