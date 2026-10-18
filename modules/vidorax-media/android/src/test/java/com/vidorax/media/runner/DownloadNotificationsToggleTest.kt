package com.vidorax.media.runner

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import org.junit.After
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

/**
 * The "Download notifications" setting in the native runner: off posts no notification of a download's own, and
 * never removes the one Android requires while downloads run — it is only minimized.
 */
@RunWith(RobolectricTestRunner::class)
class DownloadNotificationsToggleTest {
  private val context = RuntimeEnvironment.getApplication()
  private val manager = context.getSystemService(NotificationManager::class.java)
  private lateinit var notifications: DownloadNotifications

  private fun content(id: String, kind: DownloadNotificationContent.Kind) = DownloadNotificationContent(
    downloadId = id,
    title = "Clip $id",
    text = "text",
    percent = 50,
    showProgress = kind == DownloadNotificationContent.Kind.ACTIVE,
    ongoing = kind == DownloadNotificationContent.Kind.ACTIVE,
    kind = kind,
    actions = emptyList(),
    target = DownloadNotificationContent.Target.DOWNLOADS,
  )

  private val summary = RunnerSummaryContent(
    activeCount = 2,
    pausedCount = 0,
    percent = 40,
    title = "Downloading 2 videos",
    text = "40%",
    indeterminate = false,
  )

  @Before
  fun setUp() {
    shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    val launcher = ComponentName(context, "com.vidorax.media.TestLauncherActivity")
    shadowOf(context.packageManager).addActivityIfNotPresent(launcher)
    shadowOf(context.packageManager).addIntentFilterForActivity(
      launcher,
      IntentFilter(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) },
    )
    DownloadNotificationsToggle.resetForTests()
    notifications = DownloadNotifications(context)
  }

  @After
  fun tearDown() {
    DownloadNotificationsToggle.setEnabled(context, true)
    DownloadNotificationsToggle.resetForTests()
  }

  @Test
  fun `on by default, like the setting, and kept across a restart`() {
    assertTrue(DownloadNotificationsToggle.isEnabled(context))
    DownloadNotificationsToggle.setEnabled(context, false)
    DownloadNotificationsToggle.resetForTests() // a new process reads what was stored
    assertFalse(DownloadNotificationsToggle.isEnabled(context))
  }

  @Test
  fun `off, finished, failed, paused and running downloads post nothing of their own`() {
    DownloadNotificationsToggle.setEnabled(context, false)
    for ((index, kind) in DownloadNotificationContent.Kind.values().withIndex()) {
      notifications.show(content("dl-$index", kind))
    }
    assertTrue(shadowOf(manager).allNotifications.isEmpty())

    DownloadNotificationsToggle.setEnabled(context, true)
    notifications.show(content("dl-done", DownloadNotificationContent.Kind.COMPLETED))
    assertNotNull(shadowOf(manager).getNotification(notificationIdFor("dl-done")))
  }

  @Test
  fun `clearing a download's notification always goes through`() {
    notifications.show(content("dl-1", DownloadNotificationContent.Kind.PAUSED))
    DownloadNotificationsToggle.resetForTests()
    DownloadNotificationsToggle.setEnabled(context, true)
    notifications.show(content("dl-2", DownloadNotificationContent.Kind.PAUSED))
    // Off later: the per-download ones go, and clearing one by hand still works.
    DownloadNotificationsToggle.setEnabled(context, false)
    notifications.clear("dl-1")
    assertNull(shadowOf(manager).getNotification(notificationIdFor("dl-1")))
    assertNull(shadowOf(manager).getNotification(notificationIdFor("dl-2")))
  }

  @Test
  fun `the notification Android requires is still posted when off, only minimized`() {
    DownloadNotificationsToggle.setEnabled(context, false)
    assertTrue("never removed", notifications.showSummary(summary))
    val posted = shadowOf(manager).getNotification(SUMMARY_NOTIFICATION_ID)
    assertNotNull(posted)
    assertEquals(DownloadNotifications.CHANNEL_PROGRESS, posted.channelId)
    assertTrue("still ongoing", posted.flags and Notification.FLAG_ONGOING_EVENT != 0)
    assertEquals(Notification.FOREGROUND_SERVICE_DEFERRED, fgsBehavior(posted))
    assertFalse(posted.extras.getBoolean(Notification.EXTRA_SHOW_WHEN, true))
  }

  @Test
  fun `on, the required notification is exactly as before`() {
    val built = notifications.buildSummary(summary)
    assertEquals(Notification.FOREGROUND_SERVICE_DEFAULT, fgsBehavior(built))
  }

  @Test
  fun `turning it off takes away the downloads' own notifications but keeps the required one and app notices`() {
    notifications.show(content("dl-1", DownloadNotificationContent.Kind.COMPLETED))
    notifications.show(content("dl-2", DownloadNotificationContent.Kind.ACTIVE))
    notifications.showSummary(summary)
    val notice = SUMMARY_NOTIFICATION_ID - 4
    manager.notify(notice, Notification.Builder(context, DownloadNotifications.CHANNEL_STATUS).setSmallIcon(android.R.drawable.stat_sys_warning).build())

    DownloadNotificationsToggle.setEnabled(context, false)

    assertNull(shadowOf(manager).getNotification(notificationIdFor("dl-1")))
    assertNull(shadowOf(manager).getNotification(notificationIdFor("dl-2")))
    assertNotNull("required while downloads run", shadowOf(manager).getNotification(SUMMARY_NOTIFICATION_ID))
    assertNotNull("not a download's notification", shadowOf(manager).getNotification(notice))
  }

  @Test
  fun `the runner posts no finished notification when off`() {
    val host = object : RunnerHost {
      override fun start(summary: RunnerSummaryContent) = Unit
      override fun update(summary: RunnerSummaryContent) = Unit
      override fun stop() = Unit
    }
    val runner = DownloadRunner(host, notifications)
    DownloadNotificationsToggle.setEnabled(context, false)
    runner.onState(record("dl-9", com.vidorax.media.model.DownloadState.COMPLETED))
    runner.onState(record("dl-8", com.vidorax.media.model.DownloadState.FAILED))
    assertTrue(shadowOf(manager).allNotifications.isEmpty())
  }

  @Test
  fun `the download id range is all that is cleared`() {
    assertTrue(DownloadNotificationsToggle.isDownloadNotificationId(notificationIdFor("anything")))
    assertFalse(DownloadNotificationsToggle.isDownloadNotificationId(SUMMARY_NOTIFICATION_ID))
    assertFalse(DownloadNotificationsToggle.isDownloadNotificationId(DOWNLOAD_NOTIFICATION_ID_BASE - 1))
    assertFalse(DownloadNotificationsToggle.isDownloadNotificationId(DOWNLOAD_NOTIFICATION_ID_BASE + DOWNLOAD_NOTIFICATION_ID_SPAN))
  }

  /** The builder's setForegroundServiceBehavior, as stored (the getter is not public API). */
  private fun fgsBehavior(notification: Notification): Int =
    Notification::class.java.getDeclaredField("mFgsDeferBehavior").apply { isAccessible = true }.getInt(notification)

  private fun record(id: String, state: com.vidorax.media.model.DownloadState) = com.vidorax.media.model.DownloadRecord(
    id = id,
    state = state,
    title = "Clip",
    site = com.vidorax.media.model.SiteId.WEB,
    kind = com.vidorax.media.model.SourceKind.PROGRESSIVE,
    pageUrl = null,
    thumbnailUrl = null,
    qualityLabel = null,
    bytesDone = 0,
    totalBytes = null,
    errorCode = if (state == com.vidorax.media.model.DownloadState.FAILED) com.vidorax.media.model.DownloadErrorCode.NETWORK else null,
    errorMessage = null,
    attempts = 0,
    libraryItemId = null,
    createdAt = 1L,
    updatedAt = 2L,
  )
}
