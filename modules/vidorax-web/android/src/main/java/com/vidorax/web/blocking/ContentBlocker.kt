package com.vidorax.web.blocking

import com.vidorax.web.network.NetworkMediaClassifier
import java.util.Locale

/**
 * B14 #121 / #114 — whether a WebView request is an ad or a tracker to block. Pure (strings in, verdict out) so it is
 * tested on the JVM; called from the interceptRequest hook on WebView network threads, where it reads only the
 * immutable [Rules] snapshot JS set ahead of time and the bundled lists.
 *
 * Never blocked, in this order:
 * 1. The page itself (`isForMainFrame`) — site blocking (#276–#278) is decided in the app before a page loads.
 * 2. Anything video detection or downloads use: every request NetworkMediaClassifier reports (progressive files,
 *    HLS / DASH manifests, segments, byte ranges, video / audio Accept), whatever its host.
 * 3. Non-http(s) addresses, and the page's own site (same registrable domain, approximately) — a site is never cut off
 *    from its own servers.
 * 4. A site on the "Allow ads on this site" list (ads and trackers both load there).
 * Then: the ad list (when Ad blocker is on), the tracker list (when Tracker blocker is on).
 */
internal object ContentBlocker {
  enum class Verdict { ALLOW, AD, TRACKER }

  /** The switches and the allowed sites (lowercase, as `siteKey` gives them: no `www.`). */
  data class Rules(val ads: Boolean, val trackers: Boolean, val allowedSites: Set<String>) {
    val enabled: Boolean get() = ads || trackers

    companion object {
      val OFF = Rules(ads = false, trackers = false, allowedSites = emptySet())
    }
  }

  fun decide(
    url: String,
    method: String?,
    isMainFrame: Boolean,
    accept: String?,
    hasRange: Boolean,
    pageHost: String?,
    rules: Rules,
    adList: BlockList?,
    trackerList: BlockList?,
  ): Verdict {
    if (!rules.enabled || isMainFrame) return Verdict.ALLOW
    val target = RequestTarget.parse(url) ?: return Verdict.ALLOW
    if (NetworkMediaClassifier.classify(url, method ?: "GET", false, accept, hasRange) != null) return Verdict.ALLOW
    if (pageHost != null) {
      val page = pageHost.lowercase(Locale.ROOT)
      if (sameSite(target.host, page)) return Verdict.ALLOW
      if (rules.allowedSites.any { coversHost(it, page) }) return Verdict.ALLOW
    }
    if (rules.ads && adList?.matches(target.host, target.pathAndQuery) == true) return Verdict.AD
    if (rules.trackers && trackerList?.matches(target.host, target.pathAndQuery) == true) return Verdict.TRACKER
    return Verdict.ALLOW
  }

  /** Whether [site] (a host, no `www.`) covers [host]: the same host or a subdomain of it. */
  fun coversHost(site: String, host: String): Boolean {
    val bare = host.removePrefix("www.")
    return bare == site || bare.endsWith(".$site")
  }

  /**
   * Same site, approximately (no Public Suffix List natively): the last two labels match, or the last three where the
   * second-level label is a common registry one under a two-letter country code (`bbc.co.uk`, `dawn.com.pk`).
   */
  fun sameSite(a: String, b: String): Boolean = a == b || siteOf(a) == siteOf(b)

  private val SECOND_LEVEL = setOf("co", "com", "net", "org", "gov", "edu", "ac", "gob", "or", "ne", "go", "web")

  fun siteOf(host: String): String {
    val labels = host.split('.')
    if (labels.size <= 2) return host
    val tld = labels[labels.size - 1]
    val second = labels[labels.size - 2]
    val take = if (tld.length == 2 && second in SECOND_LEVEL) 3 else 2
    return labels.takeLast(take).joinToString(".")
  }
}

/** The host and path of an http(s) URL, split by index (android.net.Uri isn't available in JVM tests). */
internal class RequestTarget(val host: String, val pathAndQuery: String) {
  companion object {
    fun parse(url: String): RequestTarget? {
      val start = when {
        url.startsWith("https://", ignoreCase = true) -> 8
        url.startsWith("http://", ignoreCase = true) -> 7
        else -> return null
      }
      val end = url.indexOf('#', start).let { if (it < 0) url.length else it }
      var authorityEnd = end
      for (i in start until end) {
        val c = url[i]
        if (c == '/' || c == '?') {
          authorityEnd = i
          break
        }
      }
      val host = url.substring(start, authorityEnd).substringAfterLast('@').substringBefore(':').lowercase(Locale.ROOT)
      if (host.isEmpty()) return null
      val rest = url.substring(authorityEnd, end)
      return RequestTarget(host, if (rest.startsWith('/')) rest else "/$rest")
    }
  }
}
