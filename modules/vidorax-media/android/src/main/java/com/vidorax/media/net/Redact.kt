package com.vidorax.media.net

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Diagnostics must never leak the secrets that ride on media URLs and headers: signed-CDN query tokens
 * (`?Signature=`, `?token=`, `?Expires=`), userinfo, or `Cookie`/`Authorization` values. Everything that can
 * appear in a log line or an exception message passes through here first.
 */
internal object Redact {
  /** `scheme://host[:port]/path` only. Query, fragment and userinfo (where signed-URL secrets live) are dropped. */
  fun url(raw: String): String {
    val parsed = raw.toHttpUrlOrNull() ?: return "<url>"
    val port = if (parsed.port == HttpUrl_defaultPort(parsed.scheme)) "" else ":${parsed.port}"
    return "${parsed.scheme}://${parsed.host}$port${parsed.encodedPath}"
  }

  private fun HttpUrl_defaultPort(scheme: String): Int = if (scheme == "https") 443 else 80
}
