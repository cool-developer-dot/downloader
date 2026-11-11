package com.vidorax.media.runner

import android.Manifest
import android.app.NotificationManager
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

/** Notification Sound / Vibrate / Silent Mode: which channel a finished download uses, and that defaults change nothing. */
@RunWith(RobolectricTestRunner::class)
class NotificationOptionsTest {
  private val context = RuntimeEnvironment.getApplication()
  private val manager = context.getSystemService(NotificationManager::class.java)
  private lateinit var notifications: DownloadNotifications

  private fun content(
    id: String = "dl-1",
    kind: DownloadNotificationContent.Kind = DownloadNotificationContent.Kind.COMPLETED,
  ) = DownloadNotificationContent(
    downloadId = id,
    title = "Beach clip",
    text = "Download complete",
    percent = null,
    showProgress = kind == DownloadNotificationContent.Kind.ACTIVE,
    ongoing = kind == DownloadNotificationContent.Kind.ACTIVE,
    kind = kind,
    actions = emptyList(),
    target = DownloadNotificationContent.Target.LIBRARY,
  )

  private fun postedChannel(id: String = "dl-1"): String? =
    shadowOf(manager).getNotification(notificationIdFor(id))?.channelId

  @Before
  fun setUp() {
    shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    context.getSharedPreferences("vidorax_notification_options", 0).edit().clear().commit()
    notifications = DownloadNotifications(context)
  }

  @Test
  fun `the defaults are today's behaviour on today's channel`() {
    val defaults = NotificationOptions.DEFAULT
    assertTrue(defaults.sound)
    assertFalse(defaults.vibrate)
    assertFalse(defaults.silent)
    assertTrue(defaults.isDefault)
    assertEquals(StatusChannel.EXISTING, NotificationOptions.statusChannelFor(defaults))
    assertEquals(DownloadNotifications.CHANNEL_STATUS, StatusChannel.EXISTING.id)
  }

  @Test
  fun `every combination maps to one channel and silent overrides the rest`() {
    fun channel(sound: Boolean, vibrate: Boolean, silent: Boolean) =
      NotificationOptions.statusChannelFor(NotificationOptions(sound, vibrate, silent))

    assertEquals(StatusChannel.EXISTING, channel(sound = true, vibrate = false, silent = false))
    assertEquals(StatusChannel.SOUND_VIBRATE, channel(sound = true, vibrate = true, silent = false))
    assertEquals(StatusChannel.VIBRATE_ONLY, channel(sound = false, vibrate = true, silent = false))
    assertEquals(StatusChannel.QUIET, channel(sound = false, vibrate = false, silent = false))
    for (sound in listOf(true, false)) {
      for (vibrate in listOf(true, false)) {
        assertEquals(StatusChannel.QUIET, channel(sound, vibrate, silent = true))
      }
    }
  }

  @Test
  fun `new channel ids never reuse an existing one`() {
    val ids = StatusChannel.values().map { it.id }
    assertEquals(ids.size, ids.toSet().size)
    for (channel in StatusChannel.values()) {
      if (channel != StatusChannel.EXISTING) {
        assertFalse(channel.id == DownloadNotifications.CHANNEL_STATUS)
        assertFalse(channel.id == DownloadNotifications.CHANNEL_PROGRESS)
      }
    }
  }

  @Test
  fun `a field JavaScript did not send keeps the saved value`() {
    val saved = NotificationOptions(sound = false, vibrate = true, silent = false)
    assertEquals(saved, NotificationOptions.merged(saved, null, null, null))
    assertEquals(
      NotificationOptions(sound = false, vibrate = true, silent = true),
      NotificationOptions.merged(saved, null, null, true),
    )
  }

  @Test
  fun `nothing sent means nothing saved`() {
    NotificationOptions.saveFromJs(context, null, null, null)
    assertEquals(NotificationOptions.DEFAULT, NotificationOptions.load(context))

    NotificationOptions.saveFromJs(context, sound = false, vibrate = true, silent = false)
    assertEquals(NotificationOptions(sound = false, vibrate = true, silent = false), NotificationOptions.load(context))
  }

  @Test
  fun `with the defaults a finished download uses the existing channel and no new channel is created`() {
    notifications.show(content())

    assertEquals(DownloadNotifications.CHANNEL_STATUS, postedChannel())
    for (channel in StatusChannel.values()) {
      if (channel != StatusChannel.EXISTING) {
        assertNull(manager.getNotificationChannel(channel.id))
      }
    }
  }

  @Test
  fun `silent mode routes finished and failed downloads to a channel without sound or vibration`() {
    NotificationOptions.save(context, NotificationOptions(sound = true, vibrate = true, silent = true))

    notifications.show(content(id = "done"))
    notifications.show(content(id = "failed", kind = DownloadNotificationContent.Kind.FAILED))

    assertEquals(StatusChannel.QUIET.id, postedChannel("done"))
    assertEquals(StatusChannel.QUIET.id, postedChannel("failed"))
    val channel = manager.getNotificationChannel(StatusChannel.QUIET.id)
    assertNotNull(channel)
    assertNull(channel.sound)
    assertFalse(channel.shouldVibrate())
  }

  @Test
  fun `sound and vibration routes to a channel that vibrates and keeps the default sound`() {
    NotificationOptions.save(context, NotificationOptions(sound = true, vibrate = true, silent = false))

    notifications.show(content())

    assertEquals(StatusChannel.SOUND_VIBRATE.id, postedChannel())
    val channel = manager.getNotificationChannel(StatusChannel.SOUND_VIBRATE.id)
    assertNotNull(channel.sound)
    assertTrue(channel.shouldVibrate())
  }

  @Test
  fun `vibration only routes to a channel with no sound that vibrates`() {
    NotificationOptions.save(context, NotificationOptions(sound = false, vibrate = true, silent = false))

    notifications.show(content())

    assertEquals(StatusChannel.VIBRATE_ONLY.id, postedChannel())
    val channel = manager.getNotificationChannel(StatusChannel.VIBRATE_ONLY.id)
    assertNull(channel.sound)
    assertTrue(channel.shouldVibrate())
  }

  @Test
  fun `progress notifications never change channel`() {
    NotificationOptions.save(context, NotificationOptions(sound = false, vibrate = true, silent = true))

    notifications.show(content(kind = DownloadNotificationContent.Kind.ACTIVE))

    assertEquals(DownloadNotifications.CHANNEL_PROGRESS, postedChannel())
  }

  @Test
  fun `the existing channels are unchanged`() {
    NotificationOptions.save(context, NotificationOptions(sound = false, vibrate = true, silent = false))
    notifications.show(content())

    val status = manager.getNotificationChannel(DownloadNotifications.CHANNEL_STATUS)
    assertNotNull(status)
    assertEquals(NotificationManager.IMPORTANCE_DEFAULT, status.importance)
    assertFalse(status.shouldVibrate())
    assertNotNull(manager.getNotificationChannel(DownloadNotifications.CHANNEL_PROGRESS))
  }
}
