package com.vidorax.media.net

import android.webkit.CookieManager
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Where a download's session cookies come from: the WebView's own cookie jar, which is the session the user
 * actually browsed with. Behind an interface so the policy can be tested without Android.
 */
internal fun interface CookieSource {
  /** The `Cookie` header value for this exact URL, or null when there is nothing to send. */
  fun cookiesFor(url: String): String?
}

/** The real source. `VidoraWeb` flushes the WebView jar, so this reads what the browsing session holds. */
internal object WebViewCookieSource : CookieSource {
  override fun cookiesFor(url: String): String? =
    runCatching { CookieManager.getInstance().getCookie(url) }.getOrNull()?.ifBlank { null }
}

/**
 * Attaches the browsing session's cookies to a download that needs one.
 *
 * Session-bound media (a signed CDN URL that only answers to the session that was issued it) is refused
 * outright without this, which is what made those downloads fail with HTTP 403 after verifying cleanly.
 * The contract has always said cookies come from `CookieManager` at request time; this is where that happens.
 *
 * Deliberate properties:
 * - Read per request, and per redirect hop, so each host gets its own cookies and a retry picks up a
 *   refreshed session instead of replaying a stale one.
 * - Only when the enqueue said `useCookies`; a public download never carries the user's session.
 * - Never logged, never persisted, never put in a diagnostic — the value only exists on the wire.
 * - Cookies the server itself set during this download ([ResponseCookieJar], already on the request) are kept
 *   and win over a same-named browser cookie: they are the newer value for this exchange.
 */
internal class SessionCookieInterceptor(private val source: CookieSource) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    if (request.header(MARKER) == null) {
      return chain.proceed(request)
    }
    val builder = request.newBuilder().removeHeader(MARKER)
    val merged = mergeCookieHeaders(source.cookiesFor(request.url.toString()), request.header("Cookie"))
    if (merged != null) builder.header("Cookie", merged) else builder.removeHeader("Cookie")
    return chain.proceed(builder.build())
  }

  companion object {
    /** Internal-only marker header; removed before the request leaves the app. */
    const val MARKER = "X-Vidorax-Session"

    /** `a=1; b=2` headers merged by cookie name, [override]'s values winning; null when both are empty. */
    fun mergeCookieHeaders(base: String?, override: String?): String? {
      val merged = LinkedHashMap<String, String>()
      for (header in listOf(base, override)) {
        header?.split(';')?.forEach { pair ->
          val trimmed = pair.trim()
          if (trimmed.isEmpty()) return@forEach
          val name = trimmed.substringBefore('=').trim()
          if (name.isNotEmpty()) merged[name] = trimmed
        }
      }
      return merged.values.joinToString("; ").ifBlank { null }
    }
  }
}

/**
 * Cookies set by the servers a download talks to — a CDN that issues a token cookie on its playlist response and
 * requires it on every segment, or a redirect that sets a cookie the next hop checks. OkHttp's [Cookie.matches]
 * applies the domain/path/secure rules, so a cookie only ever returns to the site that set it. Memory only and
 * bounded: nothing here outlives the process or reaches disk, a log or JavaScript.
 */
internal class ResponseCookieJar(private val maxCookies: Int = 300) : CookieJar {
  private val cookies = LinkedHashMap<String, Cookie>()

  @Synchronized
  override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
    val now = System.currentTimeMillis()
    for (cookie in cookies) {
      val key = "${cookie.domain}|${cookie.path}|${cookie.name}"
      this.cookies.remove(key)
      if (cookie.expiresAt > now) this.cookies[key] = cookie
    }
    while (this.cookies.size > maxCookies) {
      this.cookies.remove(this.cookies.keys.first())
    }
  }

  @Synchronized
  override fun loadForRequest(url: HttpUrl): List<Cookie> {
    val now = System.currentTimeMillis()
    this.cookies.values.removeAll { it.expiresAt <= now }
    return this.cookies.values.filter { it.matches(url) }
  }
}
