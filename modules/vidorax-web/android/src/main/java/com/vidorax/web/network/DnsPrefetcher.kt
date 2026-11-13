package com.vidorax.web.network

import java.net.InetAddress
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * B6 #55 Page preloading: looks a host up ahead of the page load the user is about to start (the top address-bar
 * suggestion), so Android's resolver cache already has it when the WebView asks. One lookup at a time, at most once
 * a minute per host; failures are ignored. Nothing is sent but the DNS query itself.
 */
internal class DnsPrefetcher(
  private val resolve: (String) -> Unit = { host -> InetAddress.getAllByName(host) },
  private val executor: ExecutorService = Executors.newSingleThreadExecutor(),
  private val clock: () -> Long = System::currentTimeMillis,
) {
  private val recent = RecentKeys(PREFETCH_WINDOW_MS)

  /** True when a lookup was queued. */
  fun prefetch(host: String): Boolean {
    val name = host.trim().lowercase().removeSuffix(".")
    if (!isPrefetchableHost(name)) return false
    synchronized(recent) {
      if (!recent.add(name, clock())) return false
    }
    executor.execute {
      try {
        resolve(name)
      } catch (_: Exception) {
        // Unknown host or no network: the page load will report it.
      }
    }
    return true
  }

  companion object {
    private const val PREFETCH_WINDOW_MS = 60_000L
    private val LABEL = Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")

    /** A DNS name with at least two labels; never an IP address (nothing to look up) or `localhost`. */
    fun isPrefetchableHost(host: String): Boolean {
      if (host.isEmpty() || host.length > 253) return false
      val labels = host.split('.')
      if (labels.size < 2 || labels.any { !LABEL.matches(it) }) return false
      if (labels.all { label -> label.all(Char::isDigit) }) return false
      return !labels.last().all(Char::isDigit)
    }
  }
}
