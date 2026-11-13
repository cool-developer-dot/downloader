package com.vidorax.web.window

/**
 * B20 #16: what a separate browser window does with a link. It only shows web pages (http, https and about:blank);
 * every other link, and every download, goes to the main window, where the browser's own rules (intent: handling,
 * app links, download checks, YouTube and DRM refusals) apply. Script and local-file URLs are never followed.
 */
internal object WindowUrlPolicy {
  enum class Decision { STAY, OPEN_IN_APP, BLOCK }

  private val BLOCKED_SCHEMES = setOf("javascript", "file", "content", "data", "blob", "filesystem")

  fun decide(url: String): Decision {
    val trimmed = url.trim()
    if (trimmed.equals("about:blank", ignoreCase = true)) return Decision.STAY
    val scheme = trimmed.substringBefore(':', missingDelimiterValue = "").lowercase()
    return when {
      scheme.isEmpty() -> Decision.BLOCK
      scheme == "http" || scheme == "https" -> Decision.STAY
      scheme in BLOCKED_SCHEMES -> Decision.BLOCK
      else -> Decision.OPEN_IN_APP
    }
  }

  /** A window opens only on a web page. */
  fun canOpen(url: String): Boolean {
    val scheme = url.trim().substringBefore(':', missingDelimiterValue = "").lowercase()
    return (scheme == "http" || scheme == "https") && url.length <= MAX_URL_LENGTH
  }

  const val MAX_URL_LENGTH = 8192
}
