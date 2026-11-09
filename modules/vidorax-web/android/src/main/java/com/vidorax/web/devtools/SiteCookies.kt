package com.vidorax.web.devtools

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.annotation.MainThread
import androidx.webkit.WebViewCompat
import com.vidorax.web.profiles.IncognitoProfiles
import com.vidorax.web.profiles.WebProfiles

/**
 * B19 #230 — the cookies of the page a tab shows, read from **that tab's own profile**: the live incognito session's
 * jar for an incognito tab, the WebView's own profile (B20) otherwise, the default jar without profile support.
 *
 * `CookieManager.getCookie` gives only `name=value` pairs (no domain, path or expiry), so deleting one cookie expires it
 * for the page's host and each parent domain, on `/` and each prefix of the page's path, host-only and with a Domain —
 * the places it most likely lives. A cookie set for another path or a sibling domain can survive (documented).
 */
internal object SiteCookies {
  data class Cookie(val name: String, val value: String)

  /** "a=1; b=2" → cookies (a cookie without '=' has an empty name, as browsers treat it). */
  fun parse(header: String?): List<Cookie> =
    header.orEmpty().split(';').mapNotNull { part ->
      val trimmed = part.trim()
      if (trimmed.isEmpty()) return@mapNotNull null
      val eq = trimmed.indexOf('=')
      if (eq < 0) Cookie("", trimmed) else Cookie(trimmed.substring(0, eq).trim(), trimmed.substring(eq + 1).trim())
    }

  /** The Set-Cookie values that expire [name] for [url]'s host and path. */
  fun expiryHeaders(name: String, url: String): List<String> {
    val uri = Uri.parse(url)
    val host = uri.host?.lowercase() ?: return emptyList()
    val domains = mutableListOf<String?>(null)
    val labels = host.split('.')
    for (i in 0 until labels.size - 1) domains += labels.drop(i).joinToString(".")
    val paths = linkedSetOf("/")
    val segments = uri.path.orEmpty().split('/').filter { it.isNotEmpty() }
    for (i in 1..segments.size) paths += "/" + segments.take(i).joinToString("/")
    val expired = "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"
    return domains.flatMap { domain ->
      paths.map { path -> "$name=; $expired; Path=$path" + (domain?.let { "; Domain=$it" } ?: "") }
    }
  }

  enum class Source { INCOGNITO, PROFILE, DEFAULT, NONE }

  /** Which jar [webView]'s page uses. NONE: an incognito WebView whose session has ended — never another jar. */
  @MainThread
  fun sourceFor(webView: WebView, profilesSupported: Boolean = WebProfiles.isSupported()): Source {
    val incognito = IncognitoProfiles.nameOf(webView)
    if (incognito != null) return if (IncognitoProfiles.liveCookies(incognito) != null) Source.INCOGNITO else Source.NONE
    return if (profilesSupported) Source.PROFILE else Source.DEFAULT
  }

  /** The tab's jar, or null for an ended incognito session. */
  @MainThread
  @SuppressLint("RequiresFeature") // getProfile is behind WebProfiles.isSupported().
  fun jarFor(webView: WebView): CookieManager? {
    when (sourceFor(webView)) {
      Source.NONE -> return null
      Source.INCOGNITO -> return IncognitoProfiles.liveCookies(IncognitoProfiles.nameOf(webView))
      Source.DEFAULT -> return CookieManager.getInstance()
      Source.PROFILE -> Unit
    }
    run {
      try {
        return WebViewCompat.getProfile(webView).cookieManager
      } catch (_: RuntimeException) {
        // Fall back to the default jar below.
      }
    }
    return CookieManager.getInstance()
  }

  @MainThread
  fun read(jar: CookieManager, url: String): List<Cookie> = parse(jar.getCookie(url))

  /** Expires one cookie (or every cookie with [name] null); returns how many names are left. */
  @MainThread
  fun delete(jar: CookieManager, url: String, name: String?): Int {
    val names = if (name != null) listOf(name) else read(jar, url).map { it.name }
    for (n in names) for (header in expiryHeaders(n, url)) jar.setCookie(url, header)
    jar.flush()
    return read(jar, url).size
  }
}
