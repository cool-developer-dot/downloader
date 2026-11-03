package com.vidorax.web.profiles

/**
 * B20: the WebView profile names VidoraX uses. [DEFAULT] is WebView's own profile, which holds the default browser
 * profile's cookies and site data exactly as before profiles existed; every other browser profile (and guest mode)
 * has `vidorax-<id>`. JS can't name any other profile. vidorax-media's ActiveWebCookies applies the same rule.
 */
internal object WebProfileNames {
  /** androidx.webkit.Profile.DEFAULT_PROFILE_NAME. */
  const val DEFAULT = "Default"

  private val OWN = Regex("^vidorax-[a-z0-9]{1,32}$")

  fun isValid(name: String): Boolean = name == DEFAULT || OWN.matches(name)

  fun isDefault(name: String): Boolean = name == DEFAULT
}
