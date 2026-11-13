package com.vidorax.web.memory

import android.app.ActivityManager
import android.content.Context
import android.os.Debug

/**
 * B3 #190 — how much memory the app uses, for Browser settings' memory monitor. No permission: the app reads its own
 * process (`Debug.getMemoryInfo`, the same numbers `dumpsys meminfo` shows: proportional set size, Java / native heap,
 * graphics) and the device's totals (`ActivityManager.getMemoryInfo`). Takes a few milliseconds; call it off the main
 * thread, on demand (the screen polls while it is open).
 */
object AppMemory {
  data class Reading(
    val totalPssKb: Long,
    val javaHeapKb: Long,
    val nativeHeapKb: Long,
    val graphicsKb: Long,
    val deviceAvailableKb: Long,
    val deviceTotalKb: Long,
    val lowMemory: Boolean,
  )

  /** A `Debug.MemoryInfo.getMemoryStats()` value ("12345" kB) as a number; 0 when missing or not a number. */
  fun statKb(stats: Map<String, String>, key: String): Long = stats[key]?.trim()?.toLongOrNull()?.coerceAtLeast(0) ?: 0

  fun of(stats: Map<String, String>, fallbackTotalPssKb: Long, device: ActivityManager.MemoryInfo?): Reading {
    val total = statKb(stats, "summary.total-pss").takeIf { it > 0 } ?: fallbackTotalPssKb.coerceAtLeast(0)
    return Reading(
      totalPssKb = total,
      javaHeapKb = statKb(stats, "summary.java-heap"),
      nativeHeapKb = statKb(stats, "summary.native-heap"),
      graphicsKb = statKb(stats, "summary.graphics"),
      deviceAvailableKb = (device?.availMem ?: 0L).coerceAtLeast(0) / 1024,
      deviceTotalKb = (device?.totalMem ?: 0L).coerceAtLeast(0) / 1024,
      lowMemory = device?.lowMemory == true,
    )
  }

  fun read(context: Context): Reading {
    val info = Debug.MemoryInfo()
    Debug.getMemoryInfo(info)
    val device = ActivityManager.MemoryInfo()
    (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.getMemoryInfo(device)
    return of(info.memoryStats ?: emptyMap(), info.totalPss.toLong(), device)
  }

  fun toMap(reading: Reading): Map<String, Any> = mapOf(
    "totalPssKb" to reading.totalPssKb,
    "javaHeapKb" to reading.javaHeapKb,
    "nativeHeapKb" to reading.nativeHeapKb,
    "graphicsKb" to reading.graphicsKb,
    "deviceAvailableKb" to reading.deviceAvailableKb,
    "deviceTotalKb" to reading.deviceTotalKb,
    "lowMemory" to reading.lowMemory,
  )
}
