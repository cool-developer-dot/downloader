package com.vidorax.web.print

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PagePrintTest {
  @Test
  fun jobNamesAreOneSafeLine() {
    assertEquals("VidoraX - Lahore Fort - Wikipedia", PagePrint.jobName("Lahore Fort - Wikipedia", "https://en.wikipedia.org/"))
    assertEquals("VidoraX - a b c", PagePrint.jobName("a/b\nc", null))
    assertEquals("VidoraX - example.com", PagePrint.jobName("  ", "https://example.com/x"))
    assertEquals("VidoraX - page", PagePrint.jobName(null, "not a url"))
    assertEquals("VidoraX - لاہور", PagePrint.jobName("لاہور", null))
    assertTrue(PagePrint.jobName("x".repeat(300), null).length <= 100)
  }
}
