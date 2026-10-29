package com.vidorax.web.navigation

import org.junit.Assert.assertEquals
import org.junit.Test

class WebHistoryWindowTest {
  private fun entries(size: Int) = { index: Int -> WebHistoryWindow.Entry("https://e.example/$index", "Page $index") }

  @Test
  fun shortListsAreSentWhole() {
    val window = WebHistoryWindow.of(5, 3, entries(5))
    assertEquals(3, window.currentIndex)
    assertEquals(5, window.entries.size)
    assertEquals("https://e.example/0", window.entries.first().url)
  }

  @Test
  fun longListsKeepTheEntriesAroundTheCurrentOneWithRelativeIndices() {
    val window = WebHistoryWindow.of(100, 70, entries(100))
    assertEquals(WebHistoryWindow.MAX_BACK, window.currentIndex)
    assertEquals(WebHistoryWindow.MAX_BACK + 1 + WebHistoryWindow.MAX_FORWARD, window.entries.size)
    assertEquals("https://e.example/70", window.entries[window.currentIndex].url)
    assertEquals("https://e.example/30", window.entries.first().url)
  }

  @Test
  fun emptyOrBrokenListsAreEmpty() {
    assertEquals(-1, WebHistoryWindow.of(0, -1, entries(0)).currentIndex)
    assertEquals(0, WebHistoryWindow.of(3, 7, entries(3)).entries.size)
  }
}
