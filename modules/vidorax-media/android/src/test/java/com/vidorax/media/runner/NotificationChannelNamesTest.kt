package com.vidorax.media.runner

import android.Manifest
import android.app.NotificationManager
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The download notification channels are named from string resources (values/, values-ur/), not hard-coded English. */
@RunWith(RobolectricTestRunner::class)
class NotificationChannelNamesTest {
  private val context = RuntimeEnvironment.getApplication()
  private val manager = context.getSystemService(NotificationManager::class.java)

  @Before fun setUp() {
    shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
  }

  private fun channelsAfterABuild(): Pair<android.app.NotificationChannel, android.app.NotificationChannel> {
    DownloadNotifications(context).buildSummary(RunnerSummaryContent.IDLE)
    return manager.getNotificationChannel(DownloadNotifications.CHANNEL_PROGRESS) to
      manager.getNotificationChannel(DownloadNotifications.CHANNEL_STATUS)
  }

  @Test fun englishNames() {
    val (progress, status) = channelsAfterABuild()
    assertEquals("Downloads in progress", progress.name)
    assertEquals("Shows videos VidoraX is downloading.", progress.description)
    assertEquals("Finished downloads", status.name)
    assertEquals("Tells you when a download finishes or fails.", status.description)
  }

  @Config(qualifiers = "ur")
  @Test fun urduNames() {
    val (progress, status) = channelsAfterABuild()
    assertEquals("جاری ڈاؤن لوڈز", progress.name)
    assertEquals("مکمل ڈاؤن لوڈز", status.name)
  }
}
