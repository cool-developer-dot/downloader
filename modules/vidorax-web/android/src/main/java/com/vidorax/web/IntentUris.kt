package com.vidorax.web

import android.content.Intent
import java.net.URISyntaxException
import java.util.Locale

/**
 * Turns an `intent:` URI from a web page into an Intent that is safe to start. Like Chrome, the result can only reach
 * browsable activities, cannot name a component or selector, and cannot carry URI permission grants or local data.
 */
internal object IntentUris {
  private val BLOCKED_SCHEMES = setOf("javascript", "file", "content", "data", "blob", "view-source")

  private const val URI_GRANT_FLAGS =
    Intent.FLAG_GRANT_READ_URI_PERMISSION or
      Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
      Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
      Intent.FLAG_GRANT_PREFIX_URI_PERMISSION

  fun isIntentUri(uri: String): Boolean = uri.trimStart().startsWith("intent:", ignoreCase = true)

  fun isBlockedScheme(scheme: String?): Boolean = scheme != null && scheme.lowercase(Locale.ROOT) in BLOCKED_SCHEMES

  fun withoutUriGrants(flags: Int): Int = flags and URI_GRANT_FLAGS.inv()

  fun toSafeIntent(uri: String): Intent? {
    if (!isIntentUri(uri)) {
      return null
    }
    val intent = try {
      Intent.parseUri(uri.trim(), Intent.URI_INTENT_SCHEME)
    } catch (_: URISyntaxException) {
      return null
    } catch (_: IllegalArgumentException) {
      return null
    }
    if (isBlockedScheme(intent.scheme)) {
      return null
    }
    return intent.apply {
      component = null
      selector = null
      flags = withoutUriGrants(flags)
      if (action.isNullOrBlank()) {
        action = Intent.ACTION_VIEW
      }
      addCategory(Intent.CATEGORY_BROWSABLE)
    }
  }
}
