package com.vidorax.media.net

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** The User-Agent and timeouts survive a restart; custom headers never reach disk. */
@RunWith(RobolectricTestRunner::class)
class NetworkOptionsPersistenceTest {
  private val context = RuntimeEnvironment.getApplication()
  private val prefs get() = NetworkOptions.prefs(context)

  @Before
  fun setUp() {
    prefs.edit().clear().commit()
    NetworkOptions.resetForTests()
  }

  @After
  fun tearDown() {
    NetworkOptions.resetForTests()
  }

  /** A new process: memory is gone, only what was saved remains. */
  private fun restart() {
    NetworkOptions.resetForTests()
    NetworkOptions.restore(context)
  }

  @Test
  fun nothingSavedMeansTodaysBehaviour() {
    restart()
    assertEquals(NetworkOptions.DEFAULT, NetworkOptions.current)
    assertTrue(NetworkOptions.current.isDefault)
  }

  @Test
  fun userAgentAndTimeoutsAreUsedAfterARestartBeforeJavaScriptRuns() {
    NetworkOptions.applyFromJs(context, "Custom/1.0", mapOf("X-Api-Key" to "secret-value"), 15, 60)
    restart()
    val restored = NetworkOptions.current
    assertEquals("Custom/1.0", restored.userAgent)
    assertEquals(15, restored.connectTimeoutSeconds)
    assertEquals(60, restored.readTimeoutSeconds)
    assertTrue("headers are never restored from disk", restored.headers.isEmpty())
  }

  @Test
  fun headersAreNeverWrittenToDisk() {
    NetworkOptions.applyFromJs(context, "Custom/1.0", mapOf("X-Api-Key" to "secret-value"), null, null)
    // The headers are in effect in this process…
    assertEquals(listOf("X-Api-Key" to "secret-value"), NetworkOptions.current.headers)
    // …but nothing about them is saved.
    val saved = prefs.all
    assertFalse(saved.keys.any { it.contains("X-Api-Key", ignoreCase = true) || it.contains("header", ignoreCase = true) })
    assertFalse(saved.values.any { it.toString().contains("secret-value") })
  }

  @Test
  fun choosingAutomaticAgainRemovesTheSavedValues() {
    NetworkOptions.applyFromJs(context, "Custom/1.0", null, 30, 30)
    NetworkOptions.applyFromJs(context, null, null, null, null)
    assertTrue(prefs.all.isEmpty())
    restart()
    assertEquals(NetworkOptions.DEFAULT, NetworkOptions.current)
  }

  @Test
  fun aPushFromJavaScriptWinsOverWhatWasSaved() {
    NetworkOptions.applyFromJs(context, "Old/1.0", null, null, null)
    NetworkOptions.resetForTests()
    NetworkOptions.applyFromJs(context, "New/2.0", null, null, null)
    // MediaServices starting after the push must not bring the old value back.
    NetworkOptions.restore(context)
    assertEquals("New/2.0", NetworkOptions.current.userAgent)
  }

  @Test
  fun savedValuesAreValidatedAgainOnRestore() {
    prefs.edit()
      .putString("userAgent", "Bad\r\nInjected: 1")
      .putInt("connectTimeoutSeconds", 1)
      .putInt("readTimeoutSeconds", 100_000)
      .commit()
    restart()
    assertNull(NetworkOptions.current.userAgent)
    assertEquals(NetworkOptions.MIN_TIMEOUT_SECONDS, NetworkOptions.current.connectTimeoutSeconds)
    assertEquals(NetworkOptions.MAX_TIMEOUT_SECONDS, NetworkOptions.current.readTimeoutSeconds)
  }

  @Test
  fun persistedPartDropsTheHeaders() {
    val options = NetworkOptions(userAgent = "A/1", headers = listOf("X-A" to "1"), connectTimeoutSeconds = 20)
    assertEquals(NetworkOptions(userAgent = "A/1", connectTimeoutSeconds = 20), NetworkOptions.persistedPart(options))
  }
}
