package com.vidorax.web.navigation

import android.content.Context
import android.provider.Settings

/**
 * B6 #45: the system navigation mode. Android has no public API for it; `Settings.Secure` `navigation_mode` (AOSP,
 * readable without a permission) is 0 = 3-button, 1 = 2-button, 2 = gesture.
 */
internal object NavigationMode {
  fun of(value: Int): String = when (value) {
    0 -> "threeButton"
    1 -> "twoButton"
    2 -> "gesture"
    else -> "unknown"
  }

  fun read(context: Context): String =
    try {
      of(Settings.Secure.getInt(context.contentResolver, "navigation_mode", -1))
    } catch (_: RuntimeException) {
      "unknown"
    }
}
