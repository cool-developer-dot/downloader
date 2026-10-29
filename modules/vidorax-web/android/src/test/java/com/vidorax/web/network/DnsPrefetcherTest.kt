package com.vidorax.web.network

import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DnsPrefetcherTest {
  /** Runs tasks on the calling thread. */
  private class DirectExecutor : AbstractExecutorService() {
    override fun execute(command: Runnable) = command.run()
    override fun shutdown() = Unit
    override fun shutdownNow(): MutableList<Runnable> = mutableListOf()
    override fun isShutdown() = false
    override fun isTerminated() = false
    override fun awaitTermination(timeout: Long, unit: TimeUnit) = true
  }

  @Test
  fun onlyDnsNamesArePrefetchable() {
    assertTrue(DnsPrefetcher.isPrefetchableHost("en.wikipedia.org"))
    assertTrue(DnsPrefetcher.isPrefetchableHost("xn--80ak6aa92e.com"))
    assertTrue(DnsPrefetcher.isPrefetchableHost("a-b.co.uk"))
    assertFalse(DnsPrefetcher.isPrefetchableHost("localhost"))
    assertFalse(DnsPrefetcher.isPrefetchableHost("192.168.1.1"))
    assertFalse(DnsPrefetcher.isPrefetchableHost("::1"))
    assertFalse(DnsPrefetcher.isPrefetchableHost("bad_host.com"))
    assertFalse(DnsPrefetcher.isPrefetchableHost("-x.com"))
    assertFalse(DnsPrefetcher.isPrefetchableHost(""))
    assertFalse(DnsPrefetcher.isPrefetchableHost("a".repeat(64) + ".com"))
  }

  @Test
  fun aHostIsLookedUpAtMostOnceAMinuteAndFailuresAreIgnored() {
    val looked = mutableListOf<String>()
    var now = 1_000L
    val prefetcher = DnsPrefetcher(
      resolve = { host ->
        looked += host
        if (host == "fails.example") throw java.net.UnknownHostException(host)
      },
      executor = DirectExecutor(),
      clock = { now },
    )
    assertTrue(prefetcher.prefetch("Example.com."))
    assertFalse(prefetcher.prefetch("example.com"))
    assertTrue(prefetcher.prefetch("fails.example"))
    assertFalse(prefetcher.prefetch("10.0.0.1"))
    now += 60_000L
    assertTrue(prefetcher.prefetch("example.com"))
    assertEquals(listOf("example.com", "fails.example", "example.com"), looked)
  }
}
