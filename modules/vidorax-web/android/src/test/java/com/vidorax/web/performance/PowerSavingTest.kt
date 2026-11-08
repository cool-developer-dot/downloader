package com.vidorax.web.performance

import android.content.Context
import android.os.PowerManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class PowerSavingTest {
  @Test
  fun followsThePhonesBatterySaver() {
    val context = RuntimeEnvironment.getApplication()
    val power = shadowOf(context.getSystemService(Context.POWER_SERVICE) as PowerManager)
    power.setIsPowerSaveMode(false)
    assertFalse(PowerSaving.isOn(context))
    power.setIsPowerSaveMode(true)
    assertTrue(PowerSaving.isOn(context))
    power.setIsPowerSaveMode(false)
    assertFalse(PowerSaving.isOn(context))
  }
}
