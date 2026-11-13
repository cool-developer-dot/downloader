package com.vidorax.web.selection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// Robolectric: org.json is only a stub in plain JVM unit tests.
@RunWith(RobolectricTestRunner::class)
class SelectionMenuTest {
  @Test
  fun keepsValidItemsInOrderAndSkipsBadOrRepeatedOnes() {
    val items = SelectionMenu.sanitize(
      ids = listOf("search", "Bad", "notes", "search", "", "highlight_2"),
      titles = listOf(" Search ", "x", "Save to notes", "Again", "Empty", "Highlight"),
    )
    assertEquals(
      listOf(
        SelectionMenu.Item("search", "Search"),
        SelectionMenu.Item("notes", "Save to notes"),
        SelectionMenu.Item("highlight_2", "Highlight"),
      ),
      items,
    )
  }

  @Test
  fun capsTheItemCountAndTitleLength() {
    val ids = (1..6).map { "item$it" }
    assertEquals(SelectionMenu.MAX_ITEMS, SelectionMenu.sanitize(ids, ids).size)
    assertEquals(emptyList<SelectionMenu.Item>(), SelectionMenu.sanitize(listOf("long"), listOf("x".repeat(41))))
    assertEquals(emptyList<SelectionMenu.Item>(), SelectionMenu.sanitize(listOf("a"), listOf("   ")))
  }

  @Test
  fun noItemsOrNoScriptMeansNoConfig() {
    assertNull(SelectionMenu.configOf(emptyList(), emptyList(), "getSelection()"))
    assertNull(SelectionMenu.configOf(listOf("search"), listOf("Search"), "  "))
    assertNotNull(SelectionMenu.configOf(listOf("search"), listOf("تلاش"), "getSelection()"))
  }

  @Test
  fun onlyChromiumsWebSearchIsRemoved() {
    val entries = listOf(
      SelectionMenu.MenuEntry(android.R.id.copy, "copy"),
      SelectionMenu.MenuEntry(android.R.id.paste, "paste"),
      SelectionMenu.MenuEntry(android.R.id.selectAll, "selectAll"),
      SelectionMenu.MenuEntry(android.R.id.shareText, "shareText"),
      SelectionMenu.MenuEntry(0x7f0b0123, SelectionMenu.CHROMIUM_WEB_SEARCH),
      SelectionMenu.MenuEntry(0x7f0b0124, null),
    )
    assertEquals(listOf(0x7f0b0123), SelectionMenu.idsToRemove(entries))
    assertEquals(emptyList<Int>(), SelectionMenu.idsToRemove(entries.take(4)))
  }

  @Test
  fun decodesTheScriptResultAsText() {
    assertEquals("Lahore", SelectionMenu.decodeSelection("\"Lahore\""))
    assertEquals("لاہور\nپنجاب", SelectionMenu.decodeSelection("\"لاہور\\nپنجاب\""))
    assertNull(SelectionMenu.decodeSelection(null))
    assertNull(SelectionMenu.decodeSelection("null"))
    assertNull(SelectionMenu.decodeSelection("\"   \""))
    assertNull(SelectionMenu.decodeSelection("42"))
    assertNull(SelectionMenu.decodeSelection("{\"text\":\"x\"}"))
    assertNull(SelectionMenu.decodeSelection("not json \""))
  }

  @Test
  fun cutsVeryLongSelectionsWithoutSplittingASurrogatePair() {
    val long = "a".repeat(SelectionMenu.MAX_TEXT_LENGTH + 10)
    assertEquals(SelectionMenu.MAX_TEXT_LENGTH, SelectionMenu.decodeSelection("\"$long\"")!!.length)

    val emoji = String(Character.toChars(0x1F600))
    val text = "a".repeat(SelectionMenu.MAX_TEXT_LENGTH - 1) + emoji + "b"
    val cut = SelectionMenu.decodeSelection("\"$text\"")!!
    assertEquals(SelectionMenu.MAX_TEXT_LENGTH - 1, cut.length)
    assertEquals('a', cut.last())
  }
}
