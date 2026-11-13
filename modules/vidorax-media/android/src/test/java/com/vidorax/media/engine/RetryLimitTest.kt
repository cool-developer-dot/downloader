package com.vidorax.media.engine

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** #332: the retry limit is saved with the download settings and read back after a restart, before JavaScript runs. */
@RunWith(RobolectricTestRunner::class)
class RetryLimitTest {
  private val context = RuntimeEnvironment.getApplication()
  private val prefs get() = RetryLimit.prefs(context)

  @Before fun setUp() {
    prefs.edit().clear().commit()
    RetryLimit.resetForTests()
  }

  @After fun tearDown() { RetryLimit.resetForTests() }

  /** A new process: memory is gone, only what was saved remains. */
  private fun restart() = RetryLimit.resetForTests()

  @Test fun nothingSavedIsAutomaticWhichIsTodaysFive() {
    assertNull(RetryLimit.current(context))
    assertEquals(DownloadEngine.MAX_NETWORK_ATTEMPTS, RetryLimit.attempts(RetryLimit.current(context)))
    assertEquals(5, RetryLimit.attempts(null))
  }

  @Test fun eachChoiceIsKeptAsChosen() {
    for (limit in listOf(1, 3, 5, 10)) {
      RetryLimit.applyFromJs(context, limit)
      assertEquals(limit, RetryLimit.current(context))
      assertEquals(limit, RetryLimit.attempts(limit))
    }
  }

  @Test fun valuesOutsideOneToTenAreClamped() {
    assertEquals(1, RetryLimit.clamp(0))
    assertEquals(1, RetryLimit.clamp(-3))
    assertEquals(10, RetryLimit.clamp(11))
    assertEquals(10, RetryLimit.clamp(Int.MAX_VALUE))
    assertNull(RetryLimit.clamp(null))
    RetryLimit.applyFromJs(context, 50)
    assertEquals(10, RetryLimit.current(context))
  }

  @Test fun aChosenLimitSurvivesARestart() {
    RetryLimit.applyFromJs(context, 3)
    restart()
    assertEquals(3, RetryLimit.current(context))
  }

  @Test fun automaticRemovesTheSavedValue() {
    RetryLimit.applyFromJs(context, 10)
    RetryLimit.applyFromJs(context, null)
    assertFalse("nothing stored unless the user chose a limit", prefs.contains("retryLimit"))
    restart()
    assertNull(RetryLimit.current(context))
  }

  @Test fun aPushThatChangesNothingWritesNothing() {
    RetryLimit.applyFromJs(context, 3)
    var writes = 0
    val listener = android.content.SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> writes += 1 }
    prefs.registerOnSharedPreferenceChangeListener(listener)
    RetryLimit.applyFromJs(context, 3)
    restart()
    RetryLimit.applyFromJs(context, 3)
    prefs.unregisterOnSharedPreferenceChangeListener(listener)
    assertEquals(0, writes)
  }

  @Test fun theOtherDownloadSettingsInTheSameFileAreLeftAlone() {
    prefs.edit().putInt("maxConcurrent", 3).putBoolean("wifiOnly", true).commit()
    RetryLimit.applyFromJs(context, 1)
    RetryLimit.applyFromJs(context, null)
    assertEquals(3, prefs.getInt("maxConcurrent", 0))
    assertEquals(true, prefs.getBoolean("wifiOnly", false))
  }

  @Test fun anUnreadableSavedValueIsAutomatic() {
    prefs.edit().putInt("retryLimit", 0).commit()
    assertNull(RetryLimit.current(context))
  }
}
