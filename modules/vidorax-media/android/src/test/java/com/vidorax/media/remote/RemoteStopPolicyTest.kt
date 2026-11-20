package com.vidorax.media.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** P6: the server stops after 30 idle minutes, on Wi-Fi loss, and in the background with nothing downloading. */
class RemoteStopPolicyTest {
  private val start = 10_000_000L
  private val address = "192.168.1.20"

  private fun check(
    now: Long,
    lastRequestAt: Long = start,
    backgroundSince: Long? = null,
    hasLiveWork: Boolean = false,
    current: String? = address,
  ) = RemoteStopPolicy.check(now, lastRequestAt, backgroundSince, hasLiveWork, address, current)

  @Test
  fun keepsRunningWhileUsed() {
    assertNull(check(start + 1000))
    assertNull(check(start + RemoteStopPolicy.IDLE_TIMEOUT_MS - 1))
  }

  @Test
  fun stopsAfterThirtyMinutesWithoutARequest() {
    assertEquals(RemoteStopReason.IDLE, check(start + RemoteStopPolicy.IDLE_TIMEOUT_MS))
  }

  @Test
  fun aRequestResetsTheIdleTimer() {
    val later = start + RemoteStopPolicy.IDLE_TIMEOUT_MS - 1000
    assertNull(check(later + 5 * 60 * 1000, lastRequestAt = later))
  }

  @Test
  fun stopsWhenWifiIsLostOrTheAddressChanges() {
    assertEquals(RemoteStopReason.WIFI_LOST, check(start + 1, current = null))
    assertEquals(RemoteStopReason.WIFI_LOST, check(start + 1, current = "10.0.0.7"))
  }

  @Test
  fun stopsAMinuteAfterTheAppLeavesTheScreenUnlessDownloadsRun() {
    val left = start + 1000
    assertNull(check(left + RemoteStopPolicy.BACKGROUND_GRACE_MS - 1, backgroundSince = left))
    assertEquals(
      RemoteStopReason.BACKGROUND,
      check(left + RemoteStopPolicy.BACKGROUND_GRACE_MS, backgroundSince = left, lastRequestAt = left),
    )
    assertNull(check(left + RemoteStopPolicy.BACKGROUND_GRACE_MS * 10, backgroundSince = left, hasLiveWork = true, lastRequestAt = left))
  }

  @Test
  fun idleStillAppliesWhileDownloadsRun() {
    assertEquals(
      RemoteStopReason.IDLE,
      check(start + RemoteStopPolicy.IDLE_TIMEOUT_MS, backgroundSince = start, hasLiveWork = true),
    )
  }
}
