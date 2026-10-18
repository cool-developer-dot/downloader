package com.vidorax.media.transfer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The speed limiter on a fake clock: downloads read 64 KiB chunks as fast as the limiter lets them (no network of their
 * own unless a test gives one), and the measured rates are compared with the limits.
 */
class BandwidthLimiterTest {
  private var now = 0L
  private val limiter = BandwidthLimiter(nanoTime = { now })

  private class Reader(val id: String, val chunk: Int = CHUNK, val linkBps: Long? = null) {
    var nextAt = 0L
    var bytes = 0L
  }

  /** Runs [readers] for [seconds] of fake time; returns bytes per second per reader id. */
  private fun run(seconds: Int, vararg readers: Reader, during: (Long) -> Unit = {}): Map<String, Double> {
    val start = now
    val end = start + seconds * NS
    readers.forEach { it.nextAt = maxOf(it.nextAt, start); it.bytes = 0 }
    while (true) {
      val reader = readers.minByOrNull { it.nextAt }!!
      if (reader.nextAt >= end) break
      now = reader.nextAt
      during(now - start)
      val wait = limiter.reserve(reader.id, reader.chunk)
      reader.bytes += reader.chunk
      // A reader's own link (the network or the server) takes chunk / link seconds per chunk.
      val link = reader.linkBps?.let { reader.chunk * NS / it } ?: 0L
      reader.nextAt = now + maxOf(wait, link, 1L)
    }
    now = end
    return readers.associate { it.id to it.bytes.toDouble() / seconds }
  }

  private fun assertRate(expected: Long, actual: Double, tolerance: Double = 0.05) {
    assertTrue("expected ~$expected B/s, got ${actual.toLong()}", actual in expected * (1 - tolerance)..expected * (1 + tolerance))
  }

  @Test fun offMeansNoWaiting() {
    repeat(100) { assertEquals(0L, limiter.reserve("a", CHUNK)) }
  }

  @Test fun aGlobalLimitHoldsItsRateOverAMinute() {
    limiter.setGlobalLimit(512 * KIB)
    val rates = run(60, Reader("a"))
    assertRate(512 * KIB, rates.getValue("a"), tolerance = 0.02)
  }

  @Test fun theGlobalLimitIsSharedByEveryDownload() {
    limiter.setGlobalLimit(1024 * KIB)
    val rates = run(30, Reader("a"), Reader("b"), Reader("c"))
    assertRate(1024 * KIB, rates.values.sum(), tolerance = 0.02)
    rates.values.forEach { assertRate(1024 * KIB / 3, it, tolerance = 0.15) }
  }

  @Test fun aShortBurstAfterIdleThenTheRate() {
    limiter.setGlobalLimit(256 * KIB)
    // The bucket starts full: a quarter second of the rate (64 KiB) goes without waiting, the next chunk waits.
    assertEquals(0L, limiter.reserve("a", 64 * 1024))
    val wait = limiter.reserve("a", 64 * 1024)
    assertTrue("wait $wait", wait in 248_000_000L..252_000_000L)
    // Idle for a while refills only up to the burst, never more.
    now += 10 * NS
    assertEquals(0L, limiter.reserve("a", 64 * 1024))
    assertTrue(limiter.reserve("a", 64 * 1024) > 0)
  }

  @Test fun aPerDownloadLimitSitsInsideTheGlobalOne() {
    limiter.setGlobalLimit(1024 * KIB)
    limiter.setDownloadLimit("slow", 256 * KIB)
    val rates = run(30, Reader("slow"), Reader("free"))
    assertRate(256 * KIB, rates.getValue("slow"))
    assertRate(768 * KIB, rates.getValue("free"), tolerance = 0.06)
    assertRate(1024 * KIB, rates.values.sum(), tolerance = 0.02)
  }

  @Test fun aPerDownloadLimitWithoutAGlobalOneLimitsOnlyThatDownload() {
    limiter.setDownloadLimit("slow", 256 * KIB)
    val rates = run(20, Reader("slow"), Reader("free", linkBps = 2048 * KIB))
    assertRate(256 * KIB, rates.getValue("slow"))
    assertRate(2048 * KIB, rates.getValue("free"))
  }

  @Test fun thePriorityDownloadGetsMostOfTheGlobalLimit() {
    limiter.setGlobalLimit(1024 * KIB)
    limiter.setPriority("first")
    val rates = run(30, Reader("first"), Reader("b"), Reader("c"))
    val others = rates.getValue("b") + rates.getValue("c")
    assertRate(1024 * KIB, rates.values.sum(), tolerance = 0.03)
    assertTrue("priority ${rates.getValue("first")} vs others $others", rates.getValue("first") >= 0.72 * 1024 * KIB)
    assertTrue(others <= 0.28 * 1024 * KIB)
  }

  @Test fun withoutAGlobalLimitTheOthersGetAQuarterOfWhatThePriorityDownloadGets() {
    limiter.setPriority("first")
    // The priority download's link gives it 1 MiB/s; the other one could take 4 MiB/s.
    val rates = run(30, Reader("first", linkBps = 1024 * KIB), Reader("other", linkBps = 4096 * KIB))
    assertRate(1024 * KIB, rates.getValue("first"))
    assertRate(256 * KIB, rates.getValue("other"), tolerance = 0.1)
  }

  @Test fun whenThePriorityDownloadStopsTheOthersGetFullSpeedAgain() {
    limiter.setPriority("first")
    run(5, Reader("first", linkBps = 1024 * KIB), Reader("other", linkBps = 4096 * KIB))
    // "first" pauses: after the active window the other download is no longer held back.
    now += BandwidthLimiter.PRIORITY_ACTIVE_NS + NS
    val rates = run(10, Reader("other", linkBps = 4096 * KIB))
    assertRate(4096 * KIB, rates.getValue("other"))
  }

  @Test fun changingALimitMidTransferAppliesAtOnce() {
    limiter.setGlobalLimit(1024 * KIB)
    val reader = Reader("a")
    val fast = run(10, reader)
    limiter.setGlobalLimit(256 * KIB)
    val slow = run(10, reader)
    limiter.setGlobalLimit(null)
    val off = run(1, Reader("a", linkBps = 8192 * KIB))
    assertRate(1024 * KIB, fast.getValue("a"))
    assertRate(256 * KIB, slow.getValue("a"), tolerance = 0.1)
    assertRate(8192 * KIB, off.getValue("a"))
  }

  @Test fun forgettingADownloadDropsItsLimitAndPriority() {
    limiter.setDownloadLimit("a", 64 * KIB)
    limiter.setPriority("a")
    limiter.forget("a")
    repeat(50) { assertEquals(0L, limiter.reserve("a", CHUNK)) }
    repeat(50) { assertEquals(0L, limiter.reserve("b", CHUNK)) }
  }

  private companion object {
    const val NS = 1_000_000_000L
    const val KIB = 1024L
    const val CHUNK = 64 * 1024
  }
}
