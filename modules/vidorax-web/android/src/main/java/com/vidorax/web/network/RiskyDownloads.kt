package com.vidorax.web.network

import java.net.URI
import java.net.URLDecoder
import java.util.Locale

/**
 * H17 Dangerous File Warning (#157), native half: a WebView download whose name (its Content-Disposition file name, or
 * the URL's last path segment) or MIME type says it installs an app or runs a program. The lists and rules are those of
 * `src/media-detection/adapters/dangerous-download.ts` — `dangerous-download.native-parity.test.ts` keeps the lists
 * equal — and, as there, a video (by MIME type) is never risky.
 */
internal object RiskyDownloads {
  val EXTENSIONS: Set<String> = setOf("apk", "apks", "xapk", "exe", "msi", "bat", "cmd", "scr", "jar", "vbs", "sh", "dex")

  val MIME_TYPES: Set<String> = setOf(
    "application/vnd.android.package-archive",
    "application/x-msdownload",
    "application/x-ms-dos-executable",
    "application/x-msdos-program",
    "application/x-dosexec",
    "application/x-executable",
    "application/x-msi",
    "application/x-ms-installer",
    "application/x-ole-storage",
    "application/x-bat",
    "application/x-msdos-batch",
    "application/java-archive",
    "application/x-java-archive",
    "application/x-sh",
    "application/x-shellscript",
    "text/x-shellscript",
    "text/x-sh",
    "application/x-vbscript",
    "text/vbscript",
    "application/x-dex",
  )

  private val STREAMING_MANIFEST_TYPES = setOf(
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl",
    "application/dash+xml",
  )

  private val EXTENDED_FILE_NAME = Regex("filename\\*\\s*=\\s*(?:[\\w-]+'[^']*')?(\"?)([^\";]+)\\1", RegexOption.IGNORE_CASE)
  private val PLAIN_FILE_NAME = Regex("filename\\s*=\\s*(?:\"([^\"]*)\"|([^;]+))", RegexOption.IGNORE_CASE)

  fun isRisky(url: String, mimeType: String?, contentDisposition: String?): Boolean {
    val type = mimeType?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT).orEmpty()
    if (type.startsWith("video/") || type in STREAMING_MANIFEST_TYPES) return false
    val names = listOf(fileNameFromContentDisposition(contentDisposition), fileNameFromUrl(url))
    if (names.any { extensionOf(it) in EXTENSIONS }) return true
    return type in MIME_TYPES
  }

  /** `filename*=` (decoded) first, then `filename=`; null when the header names no file. */
  fun fileNameFromContentDisposition(contentDisposition: String?): String? {
    if (contentDisposition.isNullOrBlank()) return null
    EXTENDED_FILE_NAME.find(contentDisposition)?.groupValues?.get(2)?.trim()?.let(::decodePercent)
      ?.takeIf { it.isNotEmpty() }?.let { return it }
    val plain = PLAIN_FILE_NAME.find(contentDisposition) ?: return null
    return (plain.groupValues[1].ifEmpty { plain.groupValues[2] }).trim().ifEmpty { null }
  }

  /** The URL's last path segment, decoded; null when the path has none. */
  fun fileNameFromUrl(url: String): String? {
    val path = runCatching { URI(url).rawPath }.getOrNull()
      ?: url.substringBefore('#').substringBefore('?').substringAfter("://", "").substringAfter('/', "")
    val last = path.split('/').lastOrNull { it.isNotEmpty() } ?: return null
    return decodePercent(last)
  }

  /** `archive.tar.SH` → `sh`; null for no dot, a leading dot only, or a trailing dot. */
  fun extensionOf(name: String?): String? {
    val base = name?.trim()?.split('/', '\\')?.lastOrNull() ?: return null
    val dot = base.lastIndexOf('.')
    if (dot <= 0 || dot == base.length - 1) return null
    return base.substring(dot + 1).lowercase(Locale.ROOT)
  }

  private fun decodePercent(value: String): String =
    runCatching { URLDecoder.decode(value.replace("+", "%2B"), "UTF-8") }.getOrDefault(value)
}

/** Where a WebView download goes (see VidoraWebModule's download hook). */
internal sealed interface WebDownloadRoute {
  /** A video: to the detection pipeline with this hint, as before. */
  data class Detect(val hint: NetworkMediaHint) : WebDownloadRoute

  /** H17: an app or program file: to JavaScript for the warning, then to DownloadManager only if confirmed. */
  data object Warn : WebDownloadRoute

  /** Everything else: Android's DownloadManager directly, exactly as before. */
  data object System : WebDownloadRoute

  companion object {
    /** The hint a [Warn] download is sent to JavaScript with (`WebDownloadEvent.hint`). */
    const val RISKY_HINT = "risky"

    fun of(url: String, mimeType: String?, contentDisposition: String?): WebDownloadRoute {
      NetworkMediaClassifier.classifyDownload(url, mimeType, contentDisposition)?.let { return Detect(it) }
      return if (RiskyDownloads.isRisky(url, mimeType, contentDisposition)) Warn else System
    }
  }
}
