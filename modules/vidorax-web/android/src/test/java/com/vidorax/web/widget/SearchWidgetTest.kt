package com.vidorax.web.widget

import android.app.PendingIntent
import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class SearchWidgetTest {
  private val context = RuntimeEnvironment.getApplication()

  @Test
  fun aTapStartsThisAppWithThePrivateAction() {
    val intent = SearchWidget.launchIntent(context)
    assertEquals(SearchWidget.ACTION_SEARCH, intent.action)
    assertEquals(context.packageName, intent.`package`)
    assertTrue(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    val pending = SearchWidget.pendingIntent(context)
    val shadow = shadowOf(pending)
    assertTrue(shadow.isActivityIntent)
    assertTrue("immutable", shadow.flags and PendingIntent.FLAG_IMMUTABLE != 0)
    assertEquals(SearchWidget.ACTION_SEARCH, shadow.savedIntent.action)
  }

  @Test
  fun theTapIsHandedOutOncePerIntent() {
    val intent = SearchWidget.launchIntent(context)
    assertTrue(SearchWidget.takeSearchTap(intent))
    assertFalse("a JS reload doesn't open another tab", SearchWidget.takeSearchTap(intent))
    assertFalse(SearchWidget.takeSearchTap(Intent(Intent.ACTION_MAIN)))
    assertFalse(SearchWidget.takeSearchTap(null))
  }

  @Test
  fun buildsItsViews() {
    assertNotNull(SearchWidget.views(context))
  }
}
