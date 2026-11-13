package com.vidorax.media.runner

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import com.vidorax.media.InvalidRequestException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

/** H6 (#422): a crossed data limit as a system notification on the finished-downloads channel. */
@RunWith(RobolectricTestRunner::class)
class DataLimitNoticeTest {
  private val context = RuntimeEnvironment.getApplication()
  private val manager = context.getSystemService(NotificationManager::class.java)

  @Before
  fun setUp() {
    shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    val launcher = ComponentName(context, "com.vidorax.media.TestLauncherActivity")
    shadowOf(context.packageManager).addActivityIfNotPresent(launcher)
    shadowOf(context.packageManager).addIntentFilterForActivity(
      launcher,
      IntentFilter(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) },
    )
  }

  @Test
  fun `a crossed limit is posted on the status channel and opens the app`() {
    assertTrue(DataLimitNotice.show(context, "day", "Daily data limit reached", "1.0 GB of 1.0 GB used today"))

    val posted = shadowOf(manager).getNotification(DataLimitNotice.DAY_NOTIFICATION_ID)
    assertNotNull(posted)
    assertEquals(DownloadNotifications.CHANNEL_STATUS, posted.channelId)
    assertEquals("Daily data limit reached", posted.extras.getCharSequence(Notification.EXTRA_TITLE))
    assertEquals("1.0 GB of 1.0 GB used today", posted.extras.getCharSequence(Notification.EXTRA_TEXT))
    assertNotNull("tapping it opens VidoraX", posted.contentIntent)
    assertTrue("it goes away when tapped", posted.flags and Notification.FLAG_AUTO_CANCEL != 0)
    assertFalse("it is not ongoing", posted.flags and Notification.FLAG_ONGOING_EVENT != 0)
  }

  @Test
  fun `each period has its own notification, and crossing again replaces it`() {
    DataLimitNotice.show(context, "day", "Day", "first")
    DataLimitNotice.show(context, "month", "Month", "m")
    DataLimitNotice.show(context, "day", "Day", "second")

    assertEquals(2, shadowOf(manager).allNotifications.size)
    val day = shadowOf(manager).getNotification(DataLimitNotice.DAY_NOTIFICATION_ID)
    assertEquals("second", day.extras.getCharSequence(Notification.EXTRA_TEXT))
    assertNotNull(shadowOf(manager).getNotification(DataLimitNotice.MONTH_NOTIFICATION_ID))
  }

  @Test
  fun `without the notification permission nothing is posted and no error is raised`() {
    shadowOf(context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)

    assertFalse(DataLimitNotice.show(context, "month", "Monthly data limit reached", "x"))
    assertNull(shadowOf(manager).getNotification(DataLimitNotice.MONTH_NOTIFICATION_ID))
  }

  @Test
  fun `an unknown period or an empty title is refused`() {
    assertThrows(InvalidRequestException::class.java) { DataLimitNotice.show(context, "week", "Title", "x") }
    assertThrows(InvalidRequestException::class.java) { DataLimitNotice.show(context, "day", " \u0007 ", "x") }
  }

  @Test
  fun `texts are cleaned and bounded`() {
    val (title, text) = DataLimitNotice.clean("  Limit\u0000 reached ", "a\u0007b".plus("x".repeat(1_000)))!!
    assertEquals("Limit reached", title)
    assertTrue(text.startsWith("abx"))
    assertEquals(DataLimitNotice.MAX_TEXT, text.length)
    assertNull(DataLimitNotice.clean("", "text"))
  }

  @Test
  fun `the ids stay clear of the runner and of every download`() {
    for (id in listOf(DataLimitNotice.DAY_NOTIFICATION_ID, DataLimitNotice.MONTH_NOTIFICATION_ID)) {
      assertTrue(id != SUMMARY_NOTIFICATION_ID)
      assertTrue(id < DOWNLOAD_NOTIFICATION_ID_BASE)
    }
    assertNull(DataLimitNotice.notificationIdFor("year"))
  }
}
