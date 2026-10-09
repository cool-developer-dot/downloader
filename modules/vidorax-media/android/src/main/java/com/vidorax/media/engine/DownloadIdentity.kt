package com.vidorax.media.engine

import com.vidorax.media.library.ContentHash
import com.vidorax.media.model.VariantChoice
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * The identity of the video a download is for, used to refuse a second download of the same video. It is a SHA-256
 * over the canonical source, never a URL, so the database holds no link or token because of it.
 *
 * Canonical source: host (without `www.`), the case-sensitive path and the query without the fields a CDN rotates
 * when it re-signs the same file (tokens, signatures, expiry). The chosen HLS/DASH variant is part of it: another
 * quality of the same video is another file. When signature fields were removed, the page the video was offered on
 * is added — a generic path such as `/stream?token=…` then never makes two different videos look like one. A
 * re-signed link of the same file, offered by the same page, keeps its identity.
 *
 * The identity decides only what is certain from the request. The same bytes reached through another link are caught
 * after the download by comparing the finished file's content (DownloadEngine, finalization).
 */
internal object DownloadIdentity {
  private const val VERSION = "v1"
  private const val MAX_VARIANT_ID = 256

  /** Query fields that rotate within one file on signed CDNs (the same list as the page detector's identity). */
  private val CREDENTIAL_FIELD = Regex(
    "^(?:token|tok|sig|signature|expires|expire|exp|oe|oh|policy|key-pair-id|x-amz-.+|x-goog-.+|__gda__|hdnea|hdnts)$",
    RegexOption.IGNORE_CASE,
  )

  /** Page query fields that say how the page was reached, not which video it shows. */
  private val PAGE_NOISE_FIELD = Regex(
    "^(?:utm_.+|fbclid|gclid|dclid|msclkid|igshid|igsh|mibextid|si|feature|ref|ref_src|ref_url|source|share.*|" +
      "t|start|autoplay|muted|__tn__|__cft__.*|_nc_.+)$",
    RegexOption.IGNORE_CASE,
  )

  /** Null when [url] is not an http(s) URL: such a request has no identity and is never treated as a duplicate. */
  fun of(url: String, variant: VariantChoice?, pageUrl: String?): String? {
    val resource = canonical(url.trim().toHttpUrlOrNull() ?: return null, CREDENTIAL_FIELD)
    val parts = mutableListOf(VERSION, resource.key)
    variant?.videoId?.let { id ->
      parts += "v=" + (id.toHttpUrlOrNull()?.let { canonical(it, CREDENTIAL_FIELD).key } ?: id.take(MAX_VARIANT_ID))
    }
    variant?.maxHeight?.let { parts += "h=$it" }
    if (resource.stripped) {
      parts += "p=" + (pageUrl?.trim()?.toHttpUrlOrNull()?.let { canonical(it, PAGE_NOISE_FIELD).key } ?: "")
    }
    return ContentHash.sha256(parts.joinToString("|"))
  }

  private class Canonical(val key: String, val stripped: Boolean)

  private fun canonical(url: HttpUrl, dropped: Regex): Canonical {
    val host = url.host.lowercase().removePrefix("www.")
    val port = if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"
    val fields = (0 until url.querySize).map { url.queryParameterName(it) to (url.queryParameterValue(it) ?: "") }
    val kept = fields.filterNot { (name, _) -> dropped.matches(name) }
      .sortedWith(compareBy<Pair<String, String>> { it.first }.thenBy { it.second })
    val query = kept.joinToString("&") { (name, value) -> "$name=$value" }
    val path = url.encodedPath.let { if (it.length > 1) it.trimEnd('/') else it }
    return Canonical(
      key = "$host$port$path${if (query.isEmpty()) "" else "?$query"}",
      stripped = kept.size != fields.size,
    )
  }
}
