package com.vidorax.media.engine

import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadWindow
import com.vidorax.media.model.WaitReason
import java.util.Calendar
import java.util.TimeZone

/** What the device says right now, for the F3 rules. Null battery: the platform gave no answer (never holds). */
internal data class DeviceSnapshot(val batteryPercent: Int?, val charging: Boolean, val roaming: Boolean) {
  companion object {
    /** No information (unit tests, a host without sensors): nothing is held for device reasons. */
    val UNKNOWN = DeviceSnapshot(batteryPercent = null, charging = true, roaming = false)
  }
}

/** A rule holding a download, and when a time rule ends (null: until the device changes). */
internal data class Hold(val reason: WaitReason, val until: Long?)

/**
 * The F3 rules (docs/ARCHITECTURE.md §3.7), pure: a download's own start time, the daily download hours, "Not on
 * roaming", "Only while charging" and "Pause when battery is low". The first rule that holds wins, in that order —
 * time first, so the label says when it will run.
 */
internal object DownloadRules {
  /** "Pause when battery is low": at or below this percent while not charging (Android's own "battery low" level). */
  const val LOW_BATTERY_PERCENT = 15

  fun hold(
    startAt: Long?,
    settings: DownloadSettings,
    device: DeviceSnapshot,
    now: Long,
    zone: TimeZone,
  ): Hold? {
    if (startAt != null && startAt > now) return Hold(WaitReason.SCHEDULED, startAt)
    val window = settings.window
    if (window != null && !isOpen(window, now, zone)) {
      return Hold(WaitReason.OUTSIDE_HOURS, nextOpening(window, now, zone))
    }
    if (settings.notOnRoaming && device.roaming) return Hold(WaitReason.ROAMING, null)
    if (settings.onlyWhileCharging && !device.charging) return Hold(WaitReason.CHARGING, null)
    if (settings.pauseOnLowBattery && !device.charging &&
      device.batteryPercent != null && device.batteryPercent <= LOW_BATTERY_PERCENT
    ) {
      return Hold(WaitReason.BATTERY_LOW, null)
    }
    return null
  }

  /** Whether [window] is open at [now]: inside the hours of a day it starts on (or the day before, past midnight). */
  fun isOpen(window: DownloadWindow, now: Long, zone: TimeZone): Boolean {
    if (window.days.isEmpty()) return false
    val at = calendar(now, zone)
    val minute = minuteOfDay(at)
    val today = isoDay(at)
    val yesterday = if (today == 1) 7 else today - 1
    val start = window.startMinute
    val end = window.endMinute
    return when {
      start == end -> today in window.days // the whole day
      start < end -> today in window.days && minute in start until end
      // Crossing midnight: the evening part belongs to today, the early-morning part to yesterday's window.
      else -> (today in window.days && minute >= start) || (yesterday in window.days && minute < end)
    }
  }

  /** The next moment [window] opens after [now] (epoch ms), or null when it never does (no days). */
  fun nextOpening(window: DownloadWindow, now: Long, zone: TimeZone): Long? {
    if (window.days.isEmpty()) return null
    for (offset in 0..7) {
      val day = calendar(now, zone).apply { add(Calendar.DAY_OF_MONTH, offset) }
      if (isoDay(day) !in window.days) continue
      val opening = atMinute(day, window.startMinute)
      if (opening > now) return opening
    }
    return null
  }

  /** The next moment [window] closes after [now] while it is open (epoch ms); null for a whole-day window. */
  fun nextClosing(window: DownloadWindow, now: Long, zone: TimeZone): Long? {
    if (window.startMinute == window.endMinute || !isOpen(window, now, zone)) return null
    val at = calendar(now, zone)
    val crossesToTomorrow = window.startMinute > window.endMinute && minuteOfDay(at) >= window.startMinute
    if (crossesToTomorrow) at.add(Calendar.DAY_OF_MONTH, 1)
    return atMinute(at, window.endMinute)
  }

  /**
   * When the time part of the rules next changes its answer for a download (its start time arriving, the hours
   * opening or closing), so a waiting or running download is looked at again exactly then. Null: nothing timed.
   */
  fun nextTimeChange(startAt: Long?, settings: DownloadSettings, now: Long, zone: TimeZone): Long? {
    val candidates = mutableListOf<Long>()
    if (startAt != null && startAt > now) candidates += startAt
    settings.window?.let { window ->
      (if (isOpen(window, now, zone)) nextClosing(window, now, zone) else nextOpening(window, now, zone))
        ?.let { candidates += it }
    }
    return candidates.minOrNull()
  }

  private fun calendar(now: Long, zone: TimeZone): Calendar = Calendar.getInstance(zone).apply { timeInMillis = now }

  private fun minuteOfDay(at: Calendar): Int = at.get(Calendar.HOUR_OF_DAY) * 60 + at.get(Calendar.MINUTE)

  /** ISO weekday: Monday = 1 … Sunday = 7 (Calendar counts Sunday = 1). */
  private fun isoDay(at: Calendar): Int = (at.get(Calendar.DAY_OF_WEEK) + 5) % 7 + 1

  /** The epoch ms of [minute] after local midnight on [day]'s date (local wall time, so a DST change is respected). */
  private fun atMinute(day: Calendar, minute: Int): Long = (day.clone() as Calendar).apply {
    set(Calendar.HOUR_OF_DAY, minute / 60)
    set(Calendar.MINUTE, minute % 60)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
  }.timeInMillis
}
