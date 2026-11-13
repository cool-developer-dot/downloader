package com.vidorax.web.performance

import android.content.Context
import android.os.PowerManager

/**
 * B18 #191 — whether the phone's Battery Saver is on (`PowerManager.isPowerSaveMode`; no permission). The browser's
 * Battery saver "Follow the phone" reads it when the app comes to the front and every minute while browsing.
 */
object PowerSaving {
  fun isOn(context: Context): Boolean =
    runCatching { (context.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.isPowerSaveMode == true }
      .getOrDefault(false)
}
