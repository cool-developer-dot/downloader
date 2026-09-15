package com.vidorax.web.network

import java.util.Locale

/** Values of NetworkMediaHint in modules/vidorax-web/src/VidoraWeb.types.ts. */
internal enum class NetworkMediaHint(val value: String) {
  MANIFEST_HLS("manifest-hls"),
  MANIFEST_DASH("manifest-dash"),
  PROGRESSIVE("progressive"),
  SEGMENT("segment"),
  RANGE_MEDIA("range-media"),
  UNKNOWN("unknown"),
}

/**
 * Decides whether a WebView request is media evidence worth reporting. It runs on WebView network threads for every
 * request, so it only does string checks and rejects static assets and documents first.
 */
internal object NetworkMediaClassifier {
  private const val MAX_URL_LENGTH = 8192

  private val PROGRESSIVE_EXTENSIONS = setOf("mp4", "webm", "mov", "m4v", "m4a")
  // .aac is HLS packed audio far more often than a standalone file.
  private val SEGMENT_EXTENSIONS = setOf("ts", "m4s", "aac")
  private val NON_MEDIA_EXTENSIONS = setOf(
    "html", "htm", "js", "mjs", "css", "json", "map", "wasm", "txt", "vtt", "srt",
    "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp",
    "woff", "woff2", "ttf", "otf", "eot",
  )

  // YouTube is unsupported (docs/ARCHITECTURE.md, section 1); its streams must never become candidates.
  private val BLOCKED_HOSTS = listOf("youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com")

  private val BYTE_RANGE_PARAMS = setOf("bytestart", "byteend", "range", "rn", "rbuf")

  // Init segments and numbered segments that use a progressive extension: init.mp4, seg-12-v1-a1.mp4, chunk3.mp4.
  private val SEGMENT_FILE_STEM =
    Regex("(?:^|[-_.])(?:init|seg|segment|chunk|frag|fragment)(?:\\d|[-_.]|$)", RegexOption.IGNORE_CASE)

  fun classify(url: String, method: String, isMainFrame: Boolean, accept: String?, hasRange: Boolean): NetworkMediaHint? {
    if (url.length > MAX_URL_LENGTH) return null
    if (!method.equals("GET", ignoreCase = true) && !method.equals("HEAD", ignoreCase = true)) return null
    val parts = UrlParts.parse(url) ?: return null
    if (isBlockedHost(parts.host)) return null
    val extension = parts.extension
    if (extension in NON_MEDIA_EXTENSIONS) return null

    val hasMediaExtension = extension == "m3u8" || extension == "mpd" ||
      extension in SEGMENT_EXTENSIONS || extension in PROGRESSIVE_EXTENSIONS
    if (!hasMediaExtension && (isMainFrame || isNonMediaAccept(accept))) return null

    return when {
      extension == "m3u8" || accept.containsIgnoreCase("mpegurl") -> NetworkMediaHint.MANIFEST_HLS
      extension == "mpd" || accept.containsIgnoreCase("dash+xml") -> NetworkMediaHint.MANIFEST_DASH
      extension in SEGMENT_EXTENSIONS -> NetworkMediaHint.SEGMENT
      extension in PROGRESSIVE_EXTENSIONS && SEGMENT_FILE_STEM.containsMatchIn(parts.fileStem) -> NetworkMediaHint.SEGMENT
      queryParam(parts.query, "bytestart") != null || queryParam(parts.query, "byteend") != null ->
        NetworkMediaHint.RANGE_MEDIA
      extension in PROGRESSIVE_EXTENSIONS || hasMediaMimeParam(parts.query) -> NetworkMediaHint.PROGRESSIVE
      url.contains(".m3u8", ignoreCase = true) -> NetworkMediaHint.MANIFEST_HLS
      url.contains(".mpd", ignoreCase = true) -> NetworkMediaHint.MANIFEST_DASH
      hasRange -> NetworkMediaHint.RANGE_MEDIA
      accept.containsIgnoreCase("video/") || accept.containsIgnoreCase("audio/") -> NetworkMediaHint.UNKNOWN
      else -> null
    }
  }

  /** The URL without its fragment and byte-range query parameters: every range request of one file shares it. */
  fun dedupeKey(url: String): String {
    val withoutFragment = url.substringBefore('#')
    val queryStart = withoutFragment.indexOf('?')
    if (queryStart < 0) return withoutFragment
    val kept = withoutFragment.substring(queryStart + 1).split('&').filter { param ->
      param.isNotEmpty() && param.substringBefore('=').lowercase(Locale.ROOT) !in BYTE_RANGE_PARAMS
    }
    val base = withoutFragment.substring(0, queryStart)
    return if (kept.isEmpty()) base else kept.joinToString("&", prefix = "$base?")
  }

  /** First byte offset of a `Range: bytes=start-end` header; null for suffix ranges and anything unparsable. */
  fun rangeStart(range: String?): Long? {
    val spec = range?.trim() ?: return null
    if (!spec.startsWith("bytes=", ignoreCase = true)) return null
    return spec.substring("bytes=".length).substringBefore(',').substringBefore('-').trim().toLongOrNull()
  }

  private fun isBlockedHost(host: String) = BLOCKED_HOSTS.any { blocked ->
    host == blocked || (host.endsWith(blocked) && host[host.length - blocked.length - 1] == '.')
  }

  private fun isNonMediaAccept(accept: String?) = accept != null &&
    (accept.contains("text/html", ignoreCase = true) ||
      accept.startsWith("image/", ignoreCase = true) ||
      accept.startsWith("text/css", ignoreCase = true))

  private fun hasMediaMimeParam(query: String): Boolean {
    val mime = queryParam(query, "mime") ?: queryParam(query, "mime_type") ?: return false
    return mime.startsWith("video", ignoreCase = true) || mime.startsWith("audio", ignoreCase = true)
  }

  /** Raw (undecoded) value of the first [name] parameter of [query]. */
  private fun queryParam(query: String, name: String): String? {
    var start = 0
    while (start < query.length) {
      val end = query.indexOf('&', start).let { if (it < 0) query.length else it }
      val separator = start + name.length
      if (separator < end && query[separator] == '=' && query.regionMatches(start, name, 0, name.length, ignoreCase = true)) {
        return query.substring(separator + 1, end)
      }
      start = end + 1
    }
    return null
  }

  private fun String?.containsIgnoreCase(part: String) = this != null && contains(part, ignoreCase = true)
}

/** The parts of an http(s) URL the classifier needs, split by index (android.net.Uri is not available in JVM tests). */
internal class UrlParts(val host: String, val fileStem: String, val extension: String?, val query: String) {
  companion object {
    fun parse(url: String): UrlParts? {
      val authorityStart = when {
        url.startsWith("https://", ignoreCase = true) -> "https://".length
        url.startsWith("http://", ignoreCase = true) -> "http://".length
        else -> return null
      }
      val end = url.indexOf('#', authorityStart).let { if (it < 0) url.length else it }
      val queryStart = url.indexOf('?', authorityStart).let { if (it < 0 || it > end) end else it }
      val pathStart = url.indexOf('/', authorityStart).let { if (it < 0 || it > queryStart) queryStart else it }

      val host = url.substring(authorityStart, pathStart).substringAfterLast('@').substringBefore(':')
      val fileName = url.substring(pathStart, queryStart).substringAfterLast('/')
      val dot = fileName.lastIndexOf('.')
      val extension = if (dot >= 0) fileName.substring(dot + 1) else ""
      val hasExtension = extension.length in 1..5 && extension.all(Char::isLetterOrDigit)
      return UrlParts(
        host = host.lowercase(Locale.ROOT),
        fileStem = if (hasExtension) fileName.substring(0, dot) else fileName,
        extension = if (hasExtension) extension.lowercase(Locale.ROOT) else null,
        query = if (queryStart < end) url.substring(queryStart + 1, end) else "",
      )
    }
  }
}
