package com.vidorax.web

import android.app.UiModeManager
import android.content.Context
import android.os.Build

/**
 * The app's own light/dark choice (Settings → Theme), told to Android so the launch follows it too:
 *
 * - Android 12+: the system draws the splash screen before any app code runs, from the app's theme resolved with
 *   the per-app night mode `UiModeManager.setApplicationNightMode` persisted (the Android 12 API made for this).
 * - Every version: the choice is kept in [PREFS] too; `MainApplication.onCreate` applies it with AppCompat before the
 *   first activity is created, so the in-app launch frames (the compat splash on Android 8–11, the window background)
 *   use the same resources.
 *
 * `system` hands the decision back to the device (`MODE_NIGHT_AUTO` / follow-system).
 */
object AppNightMode {
  const val PREFS = "vidorax_app_theme"
  const val KEY = "night_mode"
  const val LIGHT = "light"
  const val DARK = "dark"
  const val SYSTEM = "system"

  fun normalize(mode: String?): String = when (mode) {
    LIGHT, DARK -> mode
    else -> SYSTEM
  }

  /**
   * Records the choice and, on Android 12+, hands it to the system. The system keeps the per-app mode across restarts
   * (and forgets it with the app's data, like [PREFS]), so it is only told when the recorded choice changes. Returns
   * the mode applied.
   */
  fun apply(context: Context, mode: String?): String {
    val value = normalize(mode)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (prefs.getString(KEY, null) == value) {
      return value
    }
    prefs.edit().putString(KEY, value).apply()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      runCatching {
        context.getSystemService(UiModeManager::class.java)?.setApplicationNightMode(
          when (value) {
            DARK -> UiModeManager.MODE_NIGHT_YES
            LIGHT -> UiModeManager.MODE_NIGHT_NO
            else -> UiModeManager.MODE_NIGHT_AUTO
          },
        )
      }
    }
    return value
  }

  /** The recorded choice (null before the app ever told us). */
  fun recorded(context: Context): String? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
}
