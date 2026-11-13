package com.vidorax.media.engine

import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadWindow
import com.vidorax.media.model.WaitReason
import java.util.Calendar
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** F3 rules on a fake clock (Pakistan time, no DST), a fake battery and a fake network. */
class DownloadRulesTest {
  private val zone = TimeZone.getTimeZone("Asia/Karachi")
  private val plugged = DeviceSnapshot(batteryPercent = 80, charging = true, roaming = false)
  private val onBattery = DeviceSnapshot(batteryPercent = 80, charging = false, roaming = false)

  /** 2026-10-12 is a Monday. */
  private fun at(day: Int, hour: Int, minute: Int = 0): Long = Calendar.getInstance(zone).apply {
    clear()
    set(2026, Calendar.OCTOBER, day, hour, minute, 0)
  }.timeInMillis

  private val weekdays = setOf(1, 2, 3, 4, 5)
  private val nineToFive = DownloadWindow(9 * 60, 17 * 60, weekdays)

  private fun hold(
    settings: DownloadSettings = DownloadSettings.DEFAULT,
    device: DeviceSnapshot = plugged,
    now: Long = at(12, 12),
    startAt: Long? = null,
  ) = DownloadRules.hold(startAt, settings, device, now, zone)

  @Test fun noRulesHoldNothing() {
    assertNull(hold(device = DeviceSnapshot(batteryPercent = 3, charging = false, roaming = true)))
  }

  @Test fun aStartTimeHoldsUntilItArrives() {
    assertEquals(Hold(WaitReason.SCHEDULED, at(12, 14)), hold(startAt = at(12, 14)))
    assertNull(hold(startAt = at(12, 11)))
    assertNull(hold(startAt = at(12, 12)))
  }

  @Test fun downloadHoursOnWeekdays() {
    val settings = DownloadSettings.DEFAULT.copy(window = nineToFive)
    assertNull(hold(settings, now = at(12, 9)))
    assertNull(hold(settings, now = at(12, 16, 59)))
    assertEquals(Hold(WaitReason.OUTSIDE_HOURS, at(12, 9)), hold(settings, now = at(12, 8, 30)))
    assertEquals("after five: tomorrow at nine", Hold(WaitReason.OUTSIDE_HOURS, at(13, 9)), hold(settings, now = at(12, 17)))
    // Saturday 17th: next Monday the 19th.
    assertEquals(Hold(WaitReason.OUTSIDE_HOURS, at(19, 9)), hold(settings, now = at(17, 12)))
  }

  @Test fun aWindowAcrossMidnightBelongsToTheDayItStarts() {
    // Friday nights only: 22:00 → 06:00.
    val window = DownloadWindow(22 * 60, 6 * 60, setOf(5))
    val friday = 16
    assertTrue(DownloadRules.isOpen(window, at(friday, 23), zone))
    assertTrue("Saturday 03:00 is still Friday's window", DownloadRules.isOpen(window, at(friday + 1, 3), zone))
    assertFalse(DownloadRules.isOpen(window, at(friday + 1, 6), zone))
    assertFalse("Saturday night is not Friday", DownloadRules.isOpen(window, at(friday + 1, 23), zone))
    assertFalse("Friday 03:00 belongs to Thursday's (absent) window", DownloadRules.isOpen(window, at(friday, 3), zone))
    assertEquals(at(friday + 7, 22), DownloadRules.nextOpening(window, at(friday + 1, 23), zone))
    assertEquals(at(friday + 1, 6), DownloadRules.nextClosing(window, at(friday, 23), zone))
    assertEquals(at(friday + 1, 6), DownloadRules.nextClosing(window, at(friday + 1, 2), zone))
  }

  @Test fun equalStartAndEndIsTheWholeDayOfThoseDays() {
    val mondays = DownloadWindow(0, 0, setOf(1))
    assertTrue(DownloadRules.isOpen(mondays, at(12, 0), zone))
    assertTrue(DownloadRules.isOpen(mondays, at(12, 23, 59), zone))
    assertFalse(DownloadRules.isOpen(mondays, at(13, 10), zone))
    assertEquals(at(19, 0), DownloadRules.nextOpening(mondays, at(13, 10), zone))
    assertNull(DownloadRules.nextClosing(mondays, at(12, 10), zone))
  }

  @Test fun roamingChargingAndBattery() {
    val roaming = plugged.copy(roaming = true)
    assertEquals(
      Hold(WaitReason.ROAMING, null),
      hold(DownloadSettings.DEFAULT.copy(notOnRoaming = true), device = roaming),
    )
    assertNull(hold(DownloadSettings.DEFAULT.copy(notOnRoaming = true), device = plugged))
    assertEquals(
      Hold(WaitReason.CHARGING, null),
      hold(DownloadSettings.DEFAULT.copy(onlyWhileCharging = true), device = onBattery),
    )
    assertNull(hold(DownloadSettings.DEFAULT.copy(onlyWhileCharging = true), device = plugged))
    val lowRule = DownloadSettings.DEFAULT.copy(pauseOnLowBattery = true)
    assertEquals(Hold(WaitReason.BATTERY_LOW, null), hold(lowRule, device = onBattery.copy(batteryPercent = 15)))
    assertEquals(Hold(WaitReason.BATTERY_LOW, null), hold(lowRule, device = onBattery.copy(batteryPercent = 10)))
    assertNull("16 % is not low", hold(lowRule, device = onBattery.copy(batteryPercent = 16)))
    assertNull("low but charging", hold(lowRule, device = plugged.copy(batteryPercent = 5)))
    assertNull("no battery reading never holds", hold(lowRule, device = onBattery.copy(batteryPercent = null)))
  }

  @Test fun combinedRulesReportTheTimeFirstThenRoamingChargingBattery() {
    val all = DownloadSettings.DEFAULT.copy(
      window = nineToFive,
      notOnRoaming = true,
      onlyWhileCharging = true,
      pauseOnLowBattery = true,
    )
    val worst = DeviceSnapshot(batteryPercent = 5, charging = false, roaming = true)
    assertEquals(WaitReason.SCHEDULED, hold(all, worst, now = at(12, 20), startAt = at(13, 10))?.reason)
    assertEquals(WaitReason.OUTSIDE_HOURS, hold(all, worst, now = at(12, 20))?.reason)
    assertEquals(WaitReason.ROAMING, hold(all, worst, now = at(12, 12))?.reason)
    assertEquals(WaitReason.CHARGING, hold(all, worst.copy(roaming = false), now = at(12, 12))?.reason)
    // Only while charging covers the battery rule (low while plugged in is fine): nothing holds once plugged.
    assertNull(hold(all, worst.copy(roaming = false, charging = true), now = at(12, 12)))
    assertEquals(
      WaitReason.BATTERY_LOW,
      hold(all.copy(onlyWhileCharging = false), worst.copy(roaming = false), now = at(12, 12))?.reason,
    )
  }

  @Test fun theNextTimeChangeIsTheEarliestOfTheStartTimeAndTheHoursOpeningOrClosing() {
    val settings = DownloadSettings.DEFAULT.copy(window = nineToFive)
    assertEquals("open: when it closes", at(12, 17), DownloadRules.nextTimeChange(null, settings, at(12, 12), zone))
    assertEquals("closed: when it opens", at(13, 9), DownloadRules.nextTimeChange(null, settings, at(12, 18), zone))
    assertEquals(at(12, 13), DownloadRules.nextTimeChange(at(12, 13), settings, at(12, 12), zone))
    assertNull(DownloadRules.nextTimeChange(null, DownloadSettings.DEFAULT, at(12, 12), zone))
  }

  @Test fun aRuleChangedWhileWaitingIsAnsweredAtOnce() {
    val waiting = hold(DownloadSettings.DEFAULT.copy(window = nineToFive), now = at(12, 20))
    assertEquals(WaitReason.OUTSIDE_HOURS, waiting?.reason)
    // The user widens the hours to the whole day: the same moment is now allowed.
    assertNull(hold(DownloadSettings.DEFAULT.copy(window = DownloadWindow(0, 0, (1..7).toSet())), now = at(12, 20)))
  }
}
