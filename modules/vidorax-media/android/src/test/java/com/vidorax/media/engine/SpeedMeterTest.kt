package com.vidorax.media.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeedMeterTest {
  @Test fun steadyTransferReportsItsRate() {
    val meter = SpeedMeter()
    var speed = 0L
    // 64 KiB every 100 ms = 655 360 B/s.
    for (i in 1..40) speed = meter.add(i * 100L, i * 65_536L)
    assertEquals(655_360L, speed)
  }

  @Test fun burstyChunksAverageOutOverTheWindow() {
    val meter = SpeedMeter()
    var speed = 0L
    var bytes = 0L
    // Alternating 1 ms and 399 ms gaps: per-chunk speed swings between 50 kB/s and 20 MB/s; the window stays near
    // the real 100 kB/s (within the error of where a window edge falls relative to a burst).
    var t = 0L
    for (i in 1..20) {
      t += if (i % 2 == 0) 1 else 399
      bytes += 20_000
      speed = meter.add(t, bytes)
    }
    assertTrue("expected about 100 kB/s, got $speed", speed in 85_000L..115_000L)
  }

  @Test fun reportsNothingUntilEnoughTimeHasPassed() {
    val meter = SpeedMeter()
    assertEquals(0L, meter.add(1_000, 0))
    assertEquals(0L, meter.add(1_100, 500_000))
    assertTrue(meter.add(1_600, 1_000_000) > 0)
  }

  @Test fun bytesGoingBackwardsStartANewMeasurement() {
    val meter = SpeedMeter()
    for (i in 1..20) meter.add(i * 100L, i * 100_000L)
    // The server ignored Range: the transfer restarted from zero.
    assertEquals("a restart never reports a negative or stale speed", 0L, meter.add(2_100, 10_000))
    assertEquals(0L, meter.add(2_300, 30_000))
    assertTrue(meter.add(2_700, 70_000) > 0)
  }

  @Test fun aStalledTransferFallsToZero() {
    val meter = SpeedMeter()
    for (i in 1..10) meter.add(i * 100L, i * 50_000L)
    var speed = 1L
    for (t in 1_100L..5_000L step 100) speed = meter.add(t, 500_000)
    assertEquals(0L, speed)
  }
}
