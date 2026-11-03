package com.vidorax.web.window

import com.vidorax.web.window.WindowUrlPolicy.Decision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WindowUrlPolicyTest {
  @Test
  fun webPagesStayInTheWindow() {
    assertEquals(Decision.STAY, WindowUrlPolicy.decide("https://en.wikipedia.org/wiki/Lahore"))
    assertEquals(Decision.STAY, WindowUrlPolicy.decide("http://example.com/"))
    assertEquals(Decision.STAY, WindowUrlPolicy.decide("HTTPS://EXAMPLE.COM"))
    assertEquals(Decision.STAY, WindowUrlPolicy.decide("about:blank"))
  }

  @Test
  fun otherLinksGoToTheMainWindow() {
    listOf(
      "intent://item/42#Intent;scheme=snssdk1233;end",
      "mailto:someone@example.com",
      "tel:+92300",
      "market://details?id=x",
      "snssdk1233://item/42",
    ).forEach { assertEquals(it, Decision.OPEN_IN_APP, WindowUrlPolicy.decide(it)) }
  }

  @Test
  fun scriptAndLocalUrlsAreNeverFollowed() {
    listOf(
      "javascript:alert(1)",
      "JavaScript:void(0)",
      "file:///sdcard/x.html",
      "content://media/external/1",
      "data:text/html,<b>x</b>",
      "blob:https://example.com/1",
      "no-scheme-at-all",
    ).forEach { assertEquals(it, Decision.BLOCK, WindowUrlPolicy.decide(it)) }
  }

  @Test
  fun aWindowOpensOnlyOnAWebPage() {
    assertTrue(WindowUrlPolicy.canOpen("https://example.com"))
    assertFalse(WindowUrlPolicy.canOpen("about:blank"))
    assertFalse(WindowUrlPolicy.canOpen("javascript:alert(1)"))
    assertFalse(WindowUrlPolicy.canOpen("https://example.com/" + "a".repeat(WindowUrlPolicy.MAX_URL_LENGTH)))
  }
}
