package com.vidorax.media.engine

import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.delay

/**
 * #506 "Cooldown between files": after a download from a site ends, that site's next download waits this long before
 * it starts, so a server that blocks rapid-fire requests is not hit back to back. Other sites are not held up beyond
 * the slot the waiting download occupies. Sites are compared by host without a leading `www.`.
 */
internal class Cooldown(private val now: () -> Long = System::currentTimeMillis) {
  private val endedAt = ConcurrentHashMap<String, Long>()

  /** Waits until [seconds] after [site]'s last download ended; returns at once with no cooldown or no earlier end. */
  suspend fun await(site: String?, seconds: Int) {
    if (site == null || seconds <= 0) return
    val last = endedAt[site] ?: return
    val wait = last + seconds * 1_000L - now()
    if (wait > 0) delay(wait)
  }

  fun ended(site: String?) {
    if (site != null) endedAt[site] = now()
  }

  companion object {
    fun siteOf(url: String): String? = runCatching { URI(url).host?.lowercase()?.removePrefix("www.") }.getOrNull()
  }
}
