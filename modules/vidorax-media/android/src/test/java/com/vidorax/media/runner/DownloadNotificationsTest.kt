package com.vidorax.media.runner

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

/** The Android half: what is actually posted, and what happens when the user says no to notifications. */
@RunWith(RobolectricTestRunner::class)
class DownloadNotificationsTest {
  private val context = RuntimeEnvironment.getApplication()
  private val manager = context.getSystemService(NotificationManager::class.java)
  private lateinit var notifications: DownloadNotifications

  private fun content(
    id: String = "dl-1",
    title: String = "Beach clip",
    text: String = "Downloading · 400 B of 1.0 kB",
    percent: Int? = 40,
    kind: DownloadNotificationContent.Kind = DownloadNotificationContent.Kind.ACTIVE,
    ongoing: Boolean = true,
    showProgress: Boolean = true,
    actions: List<DownloadNotificationContent.Action> = emptyList(),
    target: DownloadNotificationContent.Target = DownloadNotificationContent.Target.DOWNLOADS,
  ) = DownloadNotificationContent(
    downloadId = id,
    title = title,
    text = text,
    percent = percent,
    showProgress = showProgress,
    ongoing = ongoing,
    kind = kind,
    actions = actions,
    target = target,
  )

  @Before
  fun setUp() {
    shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    // The library has no activity of its own; give the test package the launcher the host app provides.
    val launcher = ComponentName(context, "com.vidorax.media.TestLauncherActivity")
    shadowOf(context.packageManager).addActivityIfNotPresent(launcher)
    shadowOf(context.packageManager).addIntentFilterForActivity(
      launcher,
      IntentFilter(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) },
    )
    notifications = DownloadNotifications(context)
  }

  @Test
  fun `a transfer is posted under its own stable id with its progress`() {
    notifications.show(content())

    val posted = shadowOf(manager).getNotification(notificationIdFor("dl-1"))
    assertNotNull("the download has its own notification", posted)
    assertEquals("Beach clip", posted.extras.getCharSequence(Notification.EXTRA_TITLE))
    assertEquals("Downloading · 400 B of 1.0 kB", posted.extras.getCharSequence(Notification.EXTRA_TEXT))
    assertEquals(40, posted.extras.getInt(Notification.EXTRA_PROGRESS))
    assertEquals(100, posted.extras.getInt(Notification.EXTRA_PROGRESS_MAX))
    assertFalse(posted.extras.getBoolean(Notification.EXTRA_PROGRESS_INDETERMINATE))
    assertTrue("a running transfer is ongoing", posted.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertEquals(DownloadNotifications.CHANNEL_PROGRESS, posted.channelId)
    assertNotNull("tapping it opens VidoraX", posted.contentIntent)

    // Updating the same download replaces its notification instead of adding a second one.
    notifications.show(content(text = "Downloading · 900 B of 1.0 kB", percent = 90))
    assertEquals(1, shadowOf(manager).size())
    assertEquals(90, shadowOf(manager).getNotification(notificationIdFor("dl-1")).extras.getInt(Notification.EXTRA_PROGRESS))
  }

  @Test
  fun `each download keeps its own notification`() {
    notifications.show(content(id = "dl-1", title = "First"))
    notifications.show(content(id = "dl-2", title = "Second", percent = 80))

    assertEquals(2, shadowOf(manager).size())
    assertEquals("First", shadowOf(manager).getNotification(notificationIdFor("dl-1")).extras.getCharSequence(Notification.EXTRA_TITLE))
    assertEquals("Second", shadowOf(manager).getNotification(notificationIdFor("dl-2")).extras.getCharSequence(Notification.EXTRA_TITLE))

    notifications.clear("dl-1")
    assertNull(shadowOf(manager).getNotification(notificationIdFor("dl-1")))
    assertNotNull(shadowOf(manager).getNotification(notificationIdFor("dl-2")))
  }

  @Test
  fun `a finished download stands on its own channel and clears when tapped`() {
    notifications.show(
      content(
        text = "Download complete · 1.0 kB",
        percent = null,
        kind = DownloadNotificationContent.Kind.COMPLETED,
        ongoing = false,
        showProgress = false,
      ),
    )

    val posted = shadowOf(manager).getNotification(notificationIdFor("dl-1"))
    assertEquals(DownloadNotifications.CHANNEL_STATUS, posted.channelId)
    assertEquals(0, posted.flags and Notification.FLAG_ONGOING_EVENT)
    assertTrue(posted.flags and Notification.FLAG_AUTO_CANCEL != 0)
    assertNull("nothing is grouped: a removed summary must never take a finished download with it", posted.group)
  }

  @Test
  fun `the runner summary is its own ongoing notification`() {
    val summary = aggregateSummaryContent(activeCount = 2, pausedCount = 1, bytesDone = 350, totalBytes = 1_000)
    assertTrue(notifications.showSummary(summary))

    val posted = shadowOf(manager).getNotification(SUMMARY_NOTIFICATION_ID)
    assertEquals("Downloading 2 videos", posted.extras.getCharSequence(Notification.EXTRA_TITLE))
    assertEquals("Downloading · 35% · 1 paused", posted.extras.getCharSequence(Notification.EXTRA_TEXT))
    assertEquals(35, posted.extras.getInt(Notification.EXTRA_PROGRESS))
    assertTrue(posted.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertEquals(0, posted.flags and Notification.FLAG_GROUP_SUMMARY)
    assertNull("a group summary would take every download notification with it when removed", posted.group)

    notifications.clearSummary()
    assertNull(shadowOf(manager).getNotification(SUMMARY_NOTIFICATION_ID))
  }

  @Test
  fun `a single live download is shown by the runner notification itself`() {
    val single = singleSummaryContent(
      content(
        text = "Downloading · 400 B of 1.0 kB",
        actions = listOf(DownloadNotificationContent.Action.PAUSE, DownloadNotificationContent.Action.CANCEL),
      ),
      pausedCount = 0,
    )
    assertTrue(notifications.showSummary(single))

    val posted = shadowOf(manager).getNotification(SUMMARY_NOTIFICATION_ID)
    assertEquals("Beach clip", posted.extras.getCharSequence(Notification.EXTRA_TITLE))
    assertEquals("Downloading · 400 B of 1.0 kB", posted.extras.getCharSequence(Notification.EXTRA_TEXT))
    assertEquals(40, posted.extras.getInt(Notification.EXTRA_PROGRESS))
    assertEquals("and only once", 1, shadowOf(manager).size())
    assertEquals("the only notification of a lone download must carry its buttons", 2, posted.actions.size)
    assertEquals("Pause", posted.actions[0].title)
    assertEquals(
      "dl-1",
      shadowOf(posted.actions[0].actionIntent).savedIntent.getStringExtra(DownloadActionReceiver.EXTRA_ID),
    )
  }

  @Test
  fun `action buttons reach the engine through the action receiver`() {
    notifications.show(
      content(
        actions = listOf(DownloadNotificationContent.Action.PAUSE, DownloadNotificationContent.Action.CANCEL),
      ),
    )

    val posted = shadowOf(manager).getNotification(notificationIdFor("dl-1"))
    assertEquals(2, posted.actions.size)
    assertEquals("Pause", posted.actions[0].title)
    assertEquals("Cancel", posted.actions[1].title)

    assertNotNull("a button with no icon is dropped by some system UIs", posted.actions[0].getIcon())
    val intents = posted.actions.map { shadowOf(it.actionIntent).savedIntent }
    assertEquals(DownloadActionReceiver.ACTION_PAUSE, intents[0].action)
    assertEquals(DownloadActionReceiver.ACTION_CANCEL, intents[1].action)
    assertEquals("dl-1", intents[0].getStringExtra(DownloadActionReceiver.EXTRA_ID))
    assertTrue("the buttons are ours, never another app's", intents.all { it.component?.className?.contains("DownloadActionReceiver") == true })
  }

  @Test
  fun `two downloads never share an action intent`() {
    notifications.show(content(id = "dl-1", actions = listOf(DownloadNotificationContent.Action.CANCEL)))
    notifications.show(content(id = "dl-2", actions = listOf(DownloadNotificationContent.Action.CANCEL)))

    val first = shadowOf(manager).getNotification(notificationIdFor("dl-1")).actions[0]
    val second = shadowOf(manager).getNotification(notificationIdFor("dl-2")).actions[0]
    assertEquals("dl-1", shadowOf(first.actionIntent).savedIntent.getStringExtra(DownloadActionReceiver.EXTRA_ID))
    assertEquals("dl-2", shadowOf(second.actionIntent).savedIntent.getStringExtra(DownloadActionReceiver.EXTRA_ID))
  }

  @Test
  fun `both channels are declared before anything is posted`() {
    notifications.show(content())

    val channels = shadowOf(manager).notificationChannels.map { (it as NotificationChannel).id }
    assertTrue(channels.contains(DownloadNotifications.CHANNEL_PROGRESS))
    assertTrue(channels.contains(DownloadNotifications.CHANNEL_STATUS))
  }

  @Test
  fun `a denied notification permission silences the notification without failing the download`() {
    shadowOf(context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)

    assertFalse(notifications.canPost())
    notifications.show(content())
    assertFalse(notifications.showSummary(singleSummaryContent(content(), pausedCount = 0)))

    assertEquals("nothing is posted, and nothing throws", 0, shadowOf(manager).size())
    // The foreground service still needs a notification object to attach to; building one must keep working.
    assertNotNull(notifications.buildSummary(RunnerSummaryContent.IDLE))
  }
}
