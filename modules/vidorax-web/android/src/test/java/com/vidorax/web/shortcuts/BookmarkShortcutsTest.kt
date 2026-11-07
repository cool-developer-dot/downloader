package com.vidorax.web.shortcuts

import android.content.Intent
import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class BookmarkShortcutsTest {
  @Test
  fun onlyWebAddressesCanBecomeShortcuts() {
    assertTrue(BookmarkShortcuts.isWebUrl("https://en.wikipedia.org/wiki/Lahore"))
    assertTrue(BookmarkShortcuts.isWebUrl("HTTP://example.com"))
    assertFalse(BookmarkShortcuts.isWebUrl("javascript:alert(1)"))
    assertFalse(BookmarkShortcuts.isWebUrl("file:///sdcard/x.html"))
    assertFalse(BookmarkShortcuts.isWebUrl("intent://x#Intent;end"))
    assertFalse(BookmarkShortcuts.isWebUrl("https://two words.com"))
    assertFalse(BookmarkShortcuts.isWebUrl(""))
  }

  @Test
  fun theLetterComesFromTheTitleElseTheHost() {
    assertEquals("L", BookmarkShortcuts.letterOf("lahore Fort", "https://example.com"))
    assertEquals("ل", BookmarkShortcuts.letterOf("  — لاہور", "https://ur.wikipedia.org"))
    assertEquals("E", BookmarkShortcuts.letterOf("  ", "https://www.example.com/x"))
    assertEquals("9", BookmarkShortcuts.letterOf("9gag", "https://9gag.com"))
    assertEquals("?", BookmarkShortcuts.letterOf("—", "https://---/"))
    assertEquals("example.com", BookmarkShortcuts.hostOf("https://user@www.Example.com:8080/a?b#c"))
  }

  @Test
  fun idsAndColoursAreStablePerAddress() {
    val a = BookmarkShortcuts.shortcutId("https://a.test/")
    assertEquals(a, BookmarkShortcuts.shortcutId("https://a.test/"))
    assertNotEquals(a, BookmarkShortcuts.shortcutId("https://b.test/"))
    assertTrue(a.matches(Regex("bookmark-[0-9a-f]{16}")))
    assertEquals(BookmarkShortcuts.colorFor("https://a.test/x"), BookmarkShortcuts.colorFor("https://www.a.test/y"))
    assertEquals("Example", BookmarkShortcuts.label("Example", "https://e.com"))
    assertEquals("e.com", BookmarkShortcuts.label(" ", "https://e.com/path"))
    assertEquals(25, BookmarkShortcuts.label("x".repeat(60), "https://e.com").length)
  }

  @Test
  fun theShortcutIntentCarriesTheAddressOnceAndNeverAView() {
    val context = RuntimeEnvironment.getApplication()
    val intent = BookmarkShortcuts.openIntent(context, "https://a.test/page")
    assertEquals(BookmarkShortcuts.ACTION_OPEN, intent.action)
    assertNotEquals(Intent.ACTION_VIEW, intent.action)
    assertNull(intent.data)
    assertEquals(context.packageName, intent.`package`)
    assertEquals("https://a.test/page", BookmarkShortcuts.takeShortcutUrl(intent))
    assertNull(BookmarkShortcuts.takeShortcutUrl(intent))
    assertNull(BookmarkShortcuts.takeShortcutUrl(Intent(Intent.ACTION_VIEW).putExtra(BookmarkShortcuts.EXTRA_URL, "https://a.test/")))
    assertNull(
      BookmarkShortcuts.takeShortcutUrl(Intent(BookmarkShortcuts.ACTION_OPEN).putExtra(BookmarkShortcuts.EXTRA_URL, "javascript:x")),
    )
  }

  @Test
  fun theLetterIconIsASquareBitmapOfTheAskedSize() {
    val icon = BookmarkShortcuts.letterIcon("L", Color.BLUE, 192)
    assertEquals(192, icon.width)
    assertEquals(192, icon.height)
    assertEquals(48, BookmarkShortcuts.letterIcon("L", Color.BLUE, 1).width)
  }

  @Test
  @Config(sdk = [34])
  fun pinningRefusesABadAddressFirst() {
    val context = RuntimeEnvironment.getApplication()
    assertEquals("invalid", BookmarkShortcuts.pin(context, "javascript:x", "x"))
  }
}
