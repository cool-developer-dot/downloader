package com.vidorax.web.window

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class BrowserWindowRequestTest {
  private fun request(
    windowId: String = "w_1",
    url: String = "https://example.com/a",
    profile: String = "Default",
    userAgent: String? = null,
    colors: Map<String, String> = emptyMap(),
    labels: Map<String, String> = emptyMap(),
  ) = BrowserWindowRequest.of(windowId, url, "Title", profile, userAgent, false, false, false, colors, labels)

  @Test
  fun acceptsAWebPageInAKnownProfile() {
    val parsed = request(profile = "vidorax-work1")
    assertNotNull(parsed)
    assertEquals("https://example.com/a", parsed!!.url)
    assertEquals("vidorax-work1", parsed.profile)
  }

  @Test
  fun refusesBadIdsPagesAndProfiles() {
    assertNull(request(windowId = ""))
    assertNull(request(windowId = "has space"))
    assertNull(request(url = "javascript:alert(1)"))
    assertNull(request(url = "file:///sdcard/a.html"))
    assertNull(request(profile = "someone-else"))
  }

  @Test
  fun dropsAnUnsafeUserAgent() {
    assertNull(request(userAgent = "Mozilla\nX-Injected: 1")!!.userAgent)
    assertNull(request(userAgent = "a".repeat(BrowserWindowRequest.MAX_USER_AGENT_LENGTH + 1))!!.userAgent)
    assertEquals("Mozilla/5.0", request(userAgent = "Mozilla/5.0")!!.userAgent)
  }

  @Test
  fun parsesColoursAndFallsBackOnBadOnes() {
    assertEquals(0xFF112233.toInt(), BrowserWindowRequest.parseColor("#112233"))
    assertEquals(0x80112233.toInt(), BrowserWindowRequest.parseColor("#80112233"))
    assertNull(BrowserWindowRequest.parseColor("red"))
    assertNull(BrowserWindowRequest.parseColor("#12345"))
    val parsed = request(colors = mapOf("background" to "#102030", "text" to "nope"))!!
    assertEquals(0xFF102030.toInt(), parsed.colors.background)
    assertEquals(0xFF111114.toInt(), parsed.colors.text)
  }

  @Test
  fun labelsAreTrimmedCutAndNeverEmpty() {
    val parsed = request(labels = mapOf("back" to "  پیچھے  ", "close" to "", "moveBack" to "x".repeat(200)))!!
    assertEquals("پیچھے", parsed.labels.back)
    assertEquals("Close window", parsed.labels.close)
    assertEquals(BrowserWindowRequest.MAX_LABEL_LENGTH, parsed.labels.moveBack.length)
  }
}
