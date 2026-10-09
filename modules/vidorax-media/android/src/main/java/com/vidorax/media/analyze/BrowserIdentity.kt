package com.vidorax.media.analyze

import android.content.Context
import android.os.LocaleList
import android.webkit.WebSettings

/**
 * How the browser tab introduces itself, so a page fetched for analysis gets the answer the tab would get: the stock
 * system WebView User-Agent (mobile tabs never override it) and the device's language preferences.
 */
internal object BrowserIdentity {
  @Volatile
  private var userAgent: String? = null

  fun userAgent(context: Context): String? =
    userAgent ?: runCatching { WebSettings.getDefaultUserAgent(context) }.getOrNull()?.ifBlank { null }
      ?.also { userAgent = it }

  /** `en-US,en;q=0.9` style, from the device locales (at most three), English last as the common fallback. */
  fun acceptLanguage(): String = acceptLanguage(
    runCatching { LocaleList.getDefault().toLanguageTags() }.getOrNull().orEmpty().split(',').filter { it.isNotBlank() },
  )

  fun acceptLanguage(tags: List<String>): String {
    val ordered = LinkedHashSet<String>()
    for (tag in tags.take(3)) {
      ordered += tag
      ordered += tag.substringBefore('-')
    }
    ordered += "en"
    return ordered.filter { it.isNotBlank() }.take(6).mapIndexed { index, tag ->
      if (index == 0) tag else "$tag;q=${"%.1f".format(java.util.Locale.ROOT, maxOf(0.1, 1.0 - index * 0.1))}"
    }.joinToString(",").ifBlank { PageFetcher.DEFAULT_ACCEPT_LANGUAGE }
  }
}
