package com.vidorax.web.privacy

/**
 * B12 #130: pure rules for clearing one site's data. WebView can't list or delete cookies by site, so a site's
 * cookies are expired by name: for its host and each parent domain above the registrable one's suffix, at path `/`.
 * A cookie set on a deeper path is left (WebView reports no paths); the user can still clear all site data.
 */
internal object SiteDataRules {
  private val ORIGIN = Regex("^https?://[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?/?$")
  private val COOKIE_NAME = Regex("^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$")

  /** `https://host[:port]` / `http://…` only: what WebStorage calls an origin (it reports them with a final `/`). */
  fun isWebOrigin(origin: String): Boolean = ORIGIN.matches(origin)

  /** A web origin as the app shows and passes it: without the final `/`. */
  fun normalizeOrigin(origin: String): String = origin.removeSuffix("/")

  fun hostOf(origin: String): String = origin.substringAfter("://").substringBefore(':').lowercase()

  /** The cookie names in a `Cookie` header value (`a=1; b=2`); invalid names are skipped. */
  fun cookieNames(header: String?): List<String> =
    header.orEmpty().split(';')
      .map { it.substringBefore('=').trim() }
      .filter { COOKIE_NAME.matches(it) }
      .distinct()

  /** The host and its parent domains with at least two labels (`a.b.example.com` → itself, `b.example.com`, `example.com`). */
  fun domainsFor(host: String): List<String> {
    val labels = host.lowercase().trim('.').split('.').filter { it.isNotEmpty() }
    if (labels.size < 2 || labels.all { part -> part.all(Char::isDigit) }) return listOf(host.lowercase())
    return (0..labels.size - 2).map { labels.drop(it).joinToString(".") }
  }

  /** Set-Cookie values that expire `name` (host-only, and on each domain). */
  fun expiryHeaders(name: String, host: String): List<String> {
    val past = "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/"
    return listOf("$name=; $past") + domainsFor(host).map { "$name=; $past; Domain=$it" }
  }
}
