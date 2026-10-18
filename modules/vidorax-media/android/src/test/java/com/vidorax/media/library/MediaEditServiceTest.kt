package com.vidorax.media.library

import android.app.Notification
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Looper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.util.concurrent.TimeUnit

/** H23: long edits run with a foreground service of the right type, with progress and Cancel; short ones need none. */
@RunWith(RobolectricTestRunner::class)
class MediaEditServiceTest {
  @Test fun conversionsAlwaysAndLongTrimsRunInTheForeground() {
    assertTrue(MediaEditForeground.needsForeground(EditKind.MP4, keptMs = 5_000))
    assertTrue(MediaEditForeground.needsForeground(EditKind.AUDIO, keptMs = 5_000))
    assertTrue(MediaEditForeground.needsForeground(EditKind.TRIM, keptMs = MediaEditForeground.LONG_TRIM_MS))
    assertFalse("a short trim finishes in moments", MediaEditForeground.needsForeground(EditKind.TRIM, keptMs = 29_999))
  }

  @Test fun mediaProcessingFromAndroid15DataSyncBeforeNoTypeBelowAndroid10() {
    assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING, MediaEditForeground.serviceType(35))
    assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING, MediaEditForeground.serviceType(36))
    assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC, MediaEditForeground.serviceType(34))
    assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC, MediaEditForeground.serviceType(29))
    assertNull(MediaEditForeground.serviceType(28))
  }

  @Test fun theServiceShowsTheEditWithCancelAndStopsOnceNoEditRuns() {
    val intent = Intent().putExtra(MediaEditForeground.EXTRA_TITLE, "Beach clip (trimmed)")
    val controller = Robolectric.buildService(MediaEditService::class.java, intent).create().startCommand(0, 1)
    val service = controller.get()
    val shadow = shadowOf(service)

    assertEquals(MediaEditForeground.NOTIFICATION_ID, shadow.lastForegroundNotificationId)
    val notification = shadow.lastForegroundNotification
    assertNotNull(notification)
    assertEquals(MediaEditForeground.CHANNEL_ID, notification.channelId)
    assertEquals("Saving the edited video", notification.extras.getCharSequence(Notification.EXTRA_TITLE))
    assertEquals("Beach clip (trimmed)", notification.extras.getCharSequence(Notification.EXTRA_TEXT))
    assertTrue("ongoing while the edit runs", notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
    val cancel = notification.actions.single()
    assertEquals("Cancel", cancel.title.toString())
    assertEquals(MediaEditForeground.ACTION_CANCEL, shadowOf(cancel.actionIntent).savedIntent.action)

    // No edit runs here (MediaEditor.progress() is null): the next look stops the service.
    shadowOf(Looper.getMainLooper()).idleFor(MediaEditForeground.POLL_MS, TimeUnit.MILLISECONDS)
    assertTrue(shadow.isStoppedBySelf)
  }

  @Test fun cancelFromTheNotificationIsHandledWithoutEnteringTheForegroundAgain() {
    val cancel = Intent().setAction(MediaEditForeground.ACTION_CANCEL)
    val service = Robolectric.buildService(MediaEditService::class.java, cancel).create().startCommand(0, 1).get()
    assertNull(shadowOf(service).lastForegroundNotification)
  }
}
