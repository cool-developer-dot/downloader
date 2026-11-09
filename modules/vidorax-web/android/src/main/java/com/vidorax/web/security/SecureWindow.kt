package com.vidorax.web.security

import android.app.Activity
import android.view.WindowManager
import androidx.annotation.MainThread

/**
 * B11 #106 — no screenshots and no recent-apps preview while an incognito tab is on screen: `FLAG_SECURE` on the
 * activity's window, set and cleared by JS (on only while an incognito tab is in front or listed in the tab switcher,
 * the browser is shown and the app is in front). The one owner of that flag for the browser; it only clears what it
 * set, so a flag another part of the app set stays.
 */
internal object SecureWindow {
  private var ownsFlag = false

  /** Returns whether the window is secure afterwards. */
  @MainThread
  fun set(activity: Activity?, secure: Boolean): Boolean {
    val window = activity?.window ?: return false
    val flags = window.attributes.flags
    val isSecure = flags and WindowManager.LayoutParams.FLAG_SECURE != 0
    if (secure && !isSecure) {
      window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      ownsFlag = true
    } else if (!secure && isSecure && ownsFlag) {
      window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      ownsFlag = false
    } else if (!secure) {
      ownsFlag = false
    }
    return window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
  }
}
