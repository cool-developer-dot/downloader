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

  // Downloads (responses the WebView cannot render): which ones the detection pipeline classifies.
  private val VIDEO_FILE_EXTENSIONS = setOf("mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "3gp", "flv")
  private val HLS_TYPES = setOf("application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl")
  private val GENERIC_BINARY_TYPES = setOf(
    "application/octet-stream", "binary/octet-stream", "application/binary", "application/x-binary",
    "application/force-download", "application/download", "application/x-download", "application/unknown",
  )
  // A script endpoint names no file type: what it serves is unknown until asked.
  private val SCRIPT_EXTENSIONS = setOf("php", "asp", "aspx", "jsp", "cgi", "pl", "do", "action", "ashx")
  private val DISPOSITION_FILE_NAME =
    Regex("filename\\*?\\s*=\\s*(?:[\\w-]+'[\\w-]*')?\"?([^\";]+)\"?", RegexOption.IGNORE_CASE)

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

  /**
   * Decides whether a WebView download — a navigation or link whose response the WebView cannot render, such as a
   * pasted `.mpd`, a `.mov`, or a file served as an attachment — is a video for the detection pipeline to classify,
   * instead of Android's DownloadManager saving it unseen. Decided from the response's MIME type, else the file name
   * (Content-Disposition, then the URL). [NetworkMediaHint.UNKNOWN] is a generic binary with no usable name: JS asks
   * the source and hands anything that is not a video back to DownloadManager. Null: not a video (documents, archives,
   * apps, audio, lone transport segments) — the system download runs exactly as before.
   */
  fun classifyDownload(url: String, mimeType: String?, contentDisposition: String?): NetworkMediaHint? {
    if (url.length > MAX_URL_LENGTH) return null
    val parts = UrlParts.parse(url) ?: return null
    if (isBlockedHost(parts.host)) return null
    val type = mimeType?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT).orEmpty()
    return when {
      type in HLS_TYPES -> NetworkMediaHint.MANIFEST_HLS
      type == "application/dash+xml" -> NetworkMediaHint.MANIFEST_DASH
      type == "video/mp2t" -> null
      type.startsWith("video/") -> NetworkMediaHint.PROGRESSIVE
      type.isEmpty() || type in GENERIC_BINARY_TYPES -> {
        val named = fileExtension(dispositionFileName(contentDisposition)) ?: parts.extension
        when (named) {
          "m3u8" -> NetworkMediaHint.MANIFEST_HLS
          "mpd" -> NetworkMediaHint.MANIFEST_DASH
          in VIDEO_FILE_EXTENSIONS -> NetworkMediaHint.PROGRESSIVE
          null, in SCRIPT_EXTENSIONS -> NetworkMediaHint.UNKNOWN
          else -> null
        }
      }
      else -> null
    }
  }

  private fun dispositionFileName(contentDisposition: String?): String? =
    contentDisposition?.let { DISPOSITION_FILE_NAME.find(it)?.groupValues?.get(1)?.trim() }?.takeIf { it.isNotEmpty() }

  private fun fileExtension(fileName: String?): String? {
    val name = fileName?.substringAfterLast('/') ?: return null
    val dot = name.lastIndexOf('.')
    val extension = if (dot >= 0) name.substring(dot + 1) else return null
    return extension.lowercase(Locale.ROOT).takeIf { it.length in 1..5 && it.all(Char::isLetterOrDigit) }
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
