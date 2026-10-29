package com.vidorax.web.keys

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyCaptureTest {
  private fun combo(keyCode: Int, ctrl: Boolean = false, alt: Boolean = false, shift: Boolean = false, meta: Boolean = false) =
    KeyCapture.comboOf(keyCode, ctrl, alt, shift, meta)

  @Test
  fun volumeKeysHaveTheirOwnNamesWhateverTheModifiers() {
    assertEquals("volumeUp", combo(KeyEvent.KEYCODE_VOLUME_UP))
    assertEquals("volumeDown", combo(KeyEvent.KEYCODE_VOLUME_DOWN, shift = true))
  }

  @Test
  fun shortcutCombosNameModifiersInAFixedOrder() {
    assertEquals("ctrl+t", combo(KeyEvent.KEYCODE_T, ctrl = true))
    assertEquals("ctrl+shift+tab", combo(KeyEvent.KEYCODE_TAB, ctrl = true, shift = true))
    assertEquals("ctrl+alt+shift+meta+5", combo(KeyEvent.KEYCODE_5, ctrl = true, alt = true, shift = true, meta = true))
    assertEquals("alt+left", combo(KeyEvent.KEYCODE_DPAD_LEFT, alt = true))
    assertEquals("f5", combo(KeyEvent.KEYCODE_F5))
    assertEquals("f12", combo(KeyEvent.KEYCODE_F12))
  }

  @Test
  fun keysWithoutANameAreNeverCaptured() {
    assertNull(combo(KeyEvent.KEYCODE_BACK))
    assertNull(combo(KeyEvent.KEYCODE_HOME))
    assertNull(combo(KeyEvent.KEYCODE_POWER))
    assertNull(combo(KeyEvent.KEYCODE_VOLUME_MUTE))
  }

  @Test
  fun volumeKeysOnlyWhenAskedForAndCombosOnlyWhenListed() {
    assertFalse(KeyCapture.captures("volumeUp", volumeKeys = false, combos = emptySet()))
    assertTrue(KeyCapture.captures("volumeDown", volumeKeys = true, combos = emptySet()))
    assertFalse(KeyCapture.captures("ctrl+t", volumeKeys = true, combos = emptySet()))
    assertTrue(KeyCapture.captures("ctrl+t", volumeKeys = false, combos = setOf("ctrl+t")))
    // Typing letters is never taken unless a combo names the exact key.
    assertFalse(KeyCapture.captures("t", volumeKeys = true, combos = setOf("ctrl+t")))
  }
}
