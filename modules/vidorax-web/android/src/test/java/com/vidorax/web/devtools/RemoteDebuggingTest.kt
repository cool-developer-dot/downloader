package com.vidorax.web.devtools

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteDebuggingTest {
  private val applied = mutableListOf<Boolean>()

  @After
  fun reset() {
    RemoteDebugging.resetForTests()
  }

  @Test
  fun offUntilTurnedOnAndBackOff() {
    assertFalse("a new process starts with it off", RemoteDebugging.enabled)
    assertTrue(RemoteDebugging.set(true) { applied += it })
    assertTrue(RemoteDebugging.enabled)
    assertFalse(RemoteDebugging.set(false) { applied += it })
    assertEquals(listOf(true, false), applied)
  }
}
