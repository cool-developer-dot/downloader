package com.vidorax.media.runner

import android.Manifest
import android.app.NotificationManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** H16's finished-download channels are named from string resources (values/, values-ur/), not hard-coded English. */
@RunWith(RobolectricTestRunner::class)
class NotificationOptionChannelNamesTest {
  private val context = RuntimeEnvironment.getApplication()
  private val manager = context.getSystemService(NotificationManager::class.java)

  @Before fun setUp() {
    shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
  }

  private fun finishedNotificationWith(options: NotificationOptions): String {
    NotificationOptions.save(context, options)
    val content = DownloadNotificationContent(
      downloadId = "dl-1",
      title = "Clip",
      text = "Saved",
      percent = null,
      showProgress = false,
      ongoing = false,
      kind = DownloadNotificationContent.Kind.COMPLETED,
      actions = emptyList(),
      target = DownloadNotificationContent.Target.LIBRARY,
    )
    return DownloadNotifications(context).build(content).channelId
  }

  @Test fun englishNames() {
    val silent = finishedNotificationWith(NotificationOptions(silent = true))
    assertEquals(StatusChannel.QUIET.id, silent)
    assertEquals("Finished downloads (silent)", manager.getNotificationChannel(silent).name)
    assertEquals("Tells you when a download finishes or fails.", manager.getNotificationChannel(silent).description)
    val both = finishedNotificationWith(NotificationOptions(sound = true, vibrate = true))
    assertEquals("Finished downloads (sound and vibration)", manager.getNotificationChannel(both).name)
    assertNull("the existing channel has no name of its own here", StatusChannel.EXISTING.nameRes)
  }

  @Config(qualifiers = "ur")
  @Test fun urduNames() {
    val vibrate = finishedNotificationWith(NotificationOptions(sound = false, vibrate = true))
    assertEquals(StatusChannel.VIBRATE_ONLY.id, vibrate)
    assertEquals("مکمل ڈاؤن لوڈز (صرف وائبریشن)", manager.getNotificationChannel(vibrate).name)
  }
}
