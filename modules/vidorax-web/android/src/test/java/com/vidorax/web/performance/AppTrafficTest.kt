package com.vidorax.web.performance

import android.net.TrafficStats
import android.os.Process
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class AppTrafficTest {
  private val context = RuntimeEnvironment.getApplication()

  @Test
  fun readsTheAppsOwnCountersWithTheBootCount() {
    var askedUid = -1
    val counters = AppTraffic.Counters { uid ->
      askedUid = uid
      5_000_000_000L to 1_234L
    }
    val reading = AppTraffic.read(context, counters)
    assertNotNull(reading)
    assertEquals("the app's own uid", Process.myUid(), askedUid)
    assertEquals(5_000_000_000L, reading!!.rxBytes)
    assertEquals(1_234L, reading.txBytes)
    // Robolectric doesn't keep Settings.Global.BOOT_COUNT; the reading carries whatever the phone says.
    assertEquals(AppTraffic.bootCount(context), reading.bootCount)
    assertTrue(reading.sinceBootMs >= 0)
    val map = AppTraffic.toMap(reading)!!
    assertEquals(5_000_000_000.0, map["rxBytes"])
    assertEquals(1_234.0, map["txBytes"])
    assertEquals(reading.bootCount, map["bootCount"])
  }

  @Test
  fun unsupportedCountersGiveNoReading() {
    val unsupported = TrafficStats.UNSUPPORTED.toLong()
    assertNull(AppTraffic.read(context, AppTraffic.Counters { unsupported to 10L }))
    assertNull(AppTraffic.read(context, AppTraffic.Counters { 10L to unsupported }))
    assertNull(AppTraffic.toMap(null))
  }

  @Test
  fun theRealCountersNeverThrow() {
    // Robolectric's TrafficStats has no per-app numbers: the real source must simply give "no reading" or one.
    AppTraffic.read(context)
  }
}
