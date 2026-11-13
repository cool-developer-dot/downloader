package com.vidorax.web.memory

import android.app.ActivityManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class AppMemoryTest {
  @Test
  fun readsTheSummaryStatsInKilobytes() {
    val stats = mapOf(
      "summary.total-pss" to "182340",
      "summary.java-heap" to " 40120 ",
      "summary.native-heap" to "61000",
      "summary.graphics" to "nonsense",
    )
    val device = ActivityManager.MemoryInfo().apply {
      availMem = 2048L * 1024 * 1024
      totalMem = 8192L * 1024 * 1024
      lowMemory = true
    }
    val reading = AppMemory.of(stats, 1, device)
    assertEquals(182340, reading.totalPssKb)
    assertEquals(40120, reading.javaHeapKb)
    assertEquals(61000, reading.nativeHeapKb)
    assertEquals(0, reading.graphicsKb)
    assertEquals(2048L * 1024, reading.deviceAvailableKb)
    assertEquals(8192L * 1024, reading.deviceTotalKb)
    assertTrue(reading.lowMemory)
  }

  @Test
  fun fallsBackToTotalPssWhenTheSummaryIsMissing() {
    val reading = AppMemory.of(emptyMap(), 95000, null)
    assertEquals(95000, reading.totalPssKb)
    assertEquals(0, reading.deviceTotalKb)
    assertFalse(reading.lowMemory)
    assertEquals(0, AppMemory.of(mapOf("summary.total-pss" to "-5"), -1, null).totalPssKb)
  }

  @Test
  fun aRealReadingIsNeverNegativeAndMapsEveryField() {
    val reading = AppMemory.read(RuntimeEnvironment.getApplication())
    assertTrue(reading.totalPssKb >= 0)
    assertTrue(reading.deviceAvailableKb >= 0)
    val map = AppMemory.toMap(reading)
    assertEquals(
      setOf("totalPssKb", "javaHeapKb", "nativeHeapKb", "graphicsKb", "deviceAvailableKb", "deviceTotalKb", "lowMemory"),
      map.keys,
    )
  }
}
