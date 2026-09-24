package com.vidorax.media.net

import com.vidorax.media.model.ProbeFailure
import java.io.IOException
import java.net.InetAddress
import okhttp3.HttpUrl

/**
 * Whether the downloader may send a request to a URL. Checked for the enqueued URL, before every redirect hop and
 * for every HLS playlist, segment and init-segment URL: a public page or playlist must not be able to point the
 * downloader at the user's own network.
 */
internal fun interface UrlPolicy {
  fun allows(url: HttpUrl): Boolean

  companion object {
    /** Production rule: public http(s) hosts only. */
    val PUBLIC_ONLY = UrlPolicy { UrlSafety.isPublicHttpUrl(it) }

    /** Unit and instrumented tests serve their fixtures from a loopback MockWebServer. */
    val ALLOW_ALL = UrlPolicy { true }
  }
}

/**
 * The page detector's SSRF rule (`isPrivateOrLocalHostname` in src/media-detection/utils/url.ts), applied natively.
 * Literal addresses are classified without any DNS lookup; numeric host spellings that a resolver would turn into
 * an address (`2130706433`, `0x7f.1`) are refused outright because they only ever exist to slip past this check.
 */
internal object UrlSafety {
  private val METADATA_HOSTS = setOf(
    "metadata.google.internal",
    "metadata.goog",
    "metadata",
    "instance-data",
    "kubernetes.default",
    "kubernetes.default.svc",
  )

  private val DOTTED_QUAD = Regex("""^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$""")
  private val IPV6_LITERAL = Regex("""^[0-9a-f:.]+$""")
  private val NUMERIC_LABEL = Regex("""^(0x[0-9a-f]*|[0-9]+)$""")

  fun isPublicHttpUrl(url: HttpUrl): Boolean =
    (url.scheme == "http" || url.scheme == "https") && !isPrivateOrLocalHost(url.host)

  fun isPrivateOrLocalHost(hostname: String): Boolean {
    val host = hostname.trim().lowercase().removePrefix("[").removeSuffix("]").removeSuffix(".")
    if (host.isEmpty()) return true
    if (host in METADATA_HOSTS || host.endsWith(".internal")) return true
    if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true

    if (host.contains(':')) return !IPV6_LITERAL.matches(host) || isPrivateAddress(host)

    DOTTED_QUAD.matchEntire(host)?.let { match ->
      val octets = match.groupValues.drop(1).map { it.toInt() }
      if (octets.any { it > 255 }) return true
      // A leading zero is an octal spelling to a resolver: `010.0.0.1` is 8.0.0.1. Never guess — refuse.
      if (match.groupValues.drop(1).any { it.length > 1 && it.startsWith('0') }) return true
      return isPrivateAddress(host)
    }

    // WHATWG: a host whose last label is numeric is an IPv4 address in some other spelling (decimal, hex, octal,
    // fewer than four parts). Real host names always end in an alphabetic label.
    val lastLabel = host.substringAfterLast('.')
    return NUMERIC_LABEL.matches(lastLabel)
  }

  /** Classifies a literal IPv4/IPv6 address. Only called with literals, so no DNS query is ever made. */
  private fun isPrivateAddress(literal: String): Boolean {
    val address = runCatching { InetAddress.getByName(literal) }.getOrNull() ?: return true
    if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
      address.isSiteLocalAddress || address.isMulticastAddress
    ) {
      return true
    }
    val bytes = address.address
    if (bytes.size == 4) {
      val a = bytes[0].toInt() and 0xFF
      val b = bytes[1].toInt() and 0xFF
      return a == 0 || (a == 100 && b in 64..127) || (a == 198 && (b == 18 || b == 19))
    }
    // IPv6 unique-local fc00::/7, and IPv4-mapped/compatible forms of a private IPv4 address.
    val first = bytes[0].toInt() and 0xFF
    if (first and 0xFE == 0xFC) return true
    if (bytes.copyOfRange(0, 10).all { it == 0.toByte() }) {
      val mapped = (bytes[10].toInt() and 0xFF == 0xFF && bytes[11].toInt() and 0xFF == 0xFF) ||
        (bytes[10] == 0.toByte() && bytes[11] == 0.toByte())
      if (mapped) {
        val v4 = bytes.copyOfRange(12, 16).joinToString(".") { (it.toInt() and 0xFF).toString() }
        return isPrivateAddress(v4)
      }
    }
    return false
  }
}

/**
 * A permanent refusal made before or during an exchange (a non-public redirect target, a redirect loop, a stream
 * shape the product refuses). It is never retried as a network error; [reason] is the classification to report.
 */
internal class MediaRefusedException(val reason: ProbeFailure, message: String) : IOException(message)
