package com.vidorax.web.performance

import android.content.Context
import android.net.TrafficStats
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.provider.Settings

/**
 * B18 #185 — how many bytes this app has received and sent since the phone started (`TrafficStats.getUidRxBytes` /
 * `getUidTxBytes` for the app's own uid; no permission). The counters restart at 0 when the phone restarts, so a reading
 * carries the boot count (Android 7+) and the time since boot: the app compares readings and never counts across a
 * restart (see `browsing-traffic.ts`). The app subtracts what the download engine counted itself.
 */
object AppTraffic {
  data class Reading(val rxBytes: Long, val txBytes: Long, val bootCount: Int, val sinceBootMs: Long)

  /** Received / sent bytes of a uid (TrafficStats; swapped in tests). */
  fun interface Counters {
    fun bytes(uid: Int): Pair<Long, Long>
  }

  val trafficStats = Counters { uid -> TrafficStats.getUidRxBytes(uid) to TrafficStats.getUidTxBytes(uid) }

  /** The reading, or null where the phone doesn't count per-app traffic (TrafficStats.UNSUPPORTED). */
  fun read(context: Context, counters: Counters = trafficStats, uid: Int = Process.myUid()): Reading? {
    val (rx, tx) = counters.bytes(uid)
    if (rx == TrafficStats.UNSUPPORTED.toLong() || tx == TrafficStats.UNSUPPORTED.toLong() || rx < 0 || tx < 0) return null
    return Reading(rx, tx, bootCount(context), SystemClock.elapsedRealtime())
  }

  /** Settings.Global.BOOT_COUNT (Android 7+); -1 when unknown. */
  fun bootCount(context: Context): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1) }.getOrDefault(-1)
    } else {
      -1
    }

  fun toMap(reading: Reading?): Map<String, Any>? = reading?.let {
    mapOf(
      // Doubles: JS numbers are exact up to 2^53 bytes.
      "rxBytes" to it.rxBytes.toDouble(),
      "txBytes" to it.txBytes.toDouble(),
      "bootCount" to it.bootCount,
      "sinceBootMs" to it.sinceBootMs.toDouble(),
    )
  }
}
