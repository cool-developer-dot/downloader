package com.vidorax.web.security

import android.app.Activity
import android.view.WindowManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SecureWindowTest {
  private fun secure(activity: Activity) = activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

  @Test
  fun setsAndClearsFlagSecure() {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    assertFalse(secure(activity))
    assertTrue(SecureWindow.set(activity, true))
    assertTrue(secure(activity))
    assertTrue("idempotent", SecureWindow.set(activity, true))
    assertFalse(SecureWindow.set(activity, false))
    assertFalse(secure(activity))
  }

  @Test
  fun neverClearsAFlagSomethingElseSet() {
    val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    SecureWindow.set(activity, true)
    assertTrue("still secure: not ours to clear", SecureWindow.set(activity, false))
    assertTrue(secure(activity))
  }

  @Test
  fun noActivityIsHarmless() {
    assertEquals(false, SecureWindow.set(null, true))
  }
}
