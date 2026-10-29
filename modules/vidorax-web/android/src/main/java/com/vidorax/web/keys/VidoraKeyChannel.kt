package com.vidorax.web.keys

import android.view.KeyEvent

/**
 * B6 #240 / B21: the one channel through which the app takes keys from the system — Volume Up / Down for page
 * scrolling, and keyboard shortcut combos (B21). `MainActivity.dispatchKeyEvent` asks [dispatch] first; a captured
 * key is reported to JS on key down and swallowed on key down and up, so the system does nothing with it (no volume
 * change). Nothing is captured while no listener is set (JS not listening) or for keys JS did not ask for.
 * Configured from the main thread by `VidoraWeb.setKeyCapture`; key events arrive on the main thread too.
 */
object VidoraKeyChannel {
  @Volatile private var volumeKeys = false
  @Volatile private var combos: Set<String> = emptySet()
  @Volatile private var listener: ((key: String, repeat: Boolean) -> Unit)? = null

  fun configure(volumeKeys: Boolean, combos: Collection<String>) {
    this.volumeKeys = volumeKeys
    this.combos = combos.map { it.lowercase() }.toSet()
  }

  fun setListener(listener: ((key: String, repeat: Boolean) -> Unit)?) {
    this.listener = listener
  }

  /** True when the key was taken (the caller must then not pass it on). */
  @JvmStatic
  fun dispatch(event: KeyEvent): Boolean {
    val report = listener ?: return false
    val key = KeyCapture.comboOf(
      event.keyCode,
      ctrl = event.isCtrlPressed,
      alt = event.isAltPressed,
      shift = event.isShiftPressed,
      meta = event.isMetaPressed,
    ) ?: return false
    if (!KeyCapture.captures(key, volumeKeys, combos)) return false
    when (event.action) {
      KeyEvent.ACTION_DOWN -> report(key, event.repeatCount > 0)
      KeyEvent.ACTION_UP -> Unit
      else -> return false
    }
    return true
  }
}

/** Pure rules of [VidoraKeyChannel] (JVM-tested). */
internal object KeyCapture {
  const val VOLUME_UP = "volumeUp"
  const val VOLUME_DOWN = "volumeDown"

  /** A stable name for the key and its modifiers (`ctrl+alt+shift+meta+<key>`, in that order), or null. */
  fun comboOf(keyCode: Int, ctrl: Boolean, alt: Boolean, shift: Boolean, meta: Boolean): String? {
    when (keyCode) {
      KeyEvent.KEYCODE_VOLUME_UP -> return VOLUME_UP
      KeyEvent.KEYCODE_VOLUME_DOWN -> return VOLUME_DOWN
    }
    val name = keyName(keyCode) ?: return null
    return buildString {
      if (ctrl) append("ctrl+")
      if (alt) append("alt+")
      if (shift) append("shift+")
      if (meta) append("meta+")
      append(name)
    }
  }

  fun captures(key: String, volumeKeys: Boolean, combos: Set<String>): Boolean =
    if (key == VOLUME_UP || key == VOLUME_DOWN) volumeKeys else key in combos

  private fun keyName(keyCode: Int): String? = when (keyCode) {
    in KeyEvent.KEYCODE_A..KeyEvent.KEYCODE_Z -> ('a' + (keyCode - KeyEvent.KEYCODE_A)).toString()
    in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> ('0' + (keyCode - KeyEvent.KEYCODE_0)).toString()
    in KeyEvent.KEYCODE_F1..KeyEvent.KEYCODE_F12 -> "f${keyCode - KeyEvent.KEYCODE_F1 + 1}"
    KeyEvent.KEYCODE_TAB -> "tab"
    KeyEvent.KEYCODE_SPACE -> "space"
    KeyEvent.KEYCODE_ENTER -> "enter"
    KeyEvent.KEYCODE_ESCAPE -> "escape"
    KeyEvent.KEYCODE_DPAD_LEFT -> "left"
    KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
    KeyEvent.KEYCODE_DPAD_UP -> "up"
    KeyEvent.KEYCODE_DPAD_DOWN -> "down"
    KeyEvent.KEYCODE_PAGE_UP -> "pageup"
    KeyEvent.KEYCODE_PAGE_DOWN -> "pagedown"
    KeyEvent.KEYCODE_MOVE_HOME -> "home"
    KeyEvent.KEYCODE_MOVE_END -> "end"
    KeyEvent.KEYCODE_EQUALS -> "="
    KeyEvent.KEYCODE_PLUS -> "+"
    KeyEvent.KEYCODE_MINUS -> "-"
    KeyEvent.KEYCODE_SLASH -> "/"
    else -> null
  }
}
