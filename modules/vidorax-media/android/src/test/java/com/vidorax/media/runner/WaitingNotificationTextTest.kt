package com.vidorax.media.runner

import com.vidorax.media.model.WaitReason
import java.util.Calendar
import java.util.TimeZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/** F3: what a held download's notification says, in English and Urdu. */
class WaitingNotificationTextTest {
  private val zone = TimeZone.getTimeZone("Asia/Karachi")

  private fun at(day: Int, hour: Int, minute: Int = 0): Long = Calendar.getInstance(zone).apply {
    clear()
    set(2026, Calendar.OCTOBER, day, hour, minute, 0)
  }.timeInMillis

  @After fun tearDown() {
    DownloadNotificationText.language = "en"
  }

  @Test fun englishLabels() {
    val now = at(12, 21)
    assertEquals("Scheduled for 23:30", DownloadNotificationText.waiting(WaitReason.SCHEDULED, at(12, 23, 30), now, zone))
    assertEquals("Scheduled for Tue 02:00", DownloadNotificationText.waiting(WaitReason.SCHEDULED, at(13, 2), now, zone))
    assertEquals("Outside download hours", DownloadNotificationText.waiting(WaitReason.OUTSIDE_HOURS, at(13, 9), now, zone))
    assertEquals("Paused — roaming", DownloadNotificationText.waiting(WaitReason.ROAMING, null, now, zone))
    assertEquals("Waiting for charging", DownloadNotificationText.waiting(WaitReason.CHARGING, null, now, zone))
    assertEquals("Paused — battery low", DownloadNotificationText.waiting(WaitReason.BATTERY_LOW, null, now, zone))
  }

  @Test fun urduLabels() {
    DownloadNotificationText.language = "ur"
    val now = at(12, 21)
    assertEquals("23:30 کے لیے شیڈول", DownloadNotificationText.waiting(WaitReason.SCHEDULED, at(12, 23, 30), now, zone))
    assertEquals("چارجنگ کا انتظار", DownloadNotificationText.waiting(WaitReason.CHARGING, null, now, zone))
    assertEquals("رکا ہوا — بیٹری کم", DownloadNotificationText.waiting(WaitReason.BATTERY_LOW, null, now, zone))
    assertEquals("رکا ہوا — رومنگ", DownloadNotificationText.waiting(WaitReason.ROAMING, null, now, zone))
    assertEquals("ڈاؤن لوڈ کے اوقات سے باہر", DownloadNotificationText.waiting(WaitReason.OUTSIDE_HOURS, null, now, zone))
  }
}
