package com.vidorax.media.net

import android.annotation.SuppressLint
import android.webkit.CookieManager
import androidx.annotation.MainThread
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewFeature

/**
 * B20: the cookie jar of the browser profile the user is browsing in, so a download carries the session of the
 * profile it was found in. The default profile is WebView's own jar ([CookieManager.getInstance]), as before profiles
 * existed. Set by `VidoraMedia.setCookieProfile` whenever JS switches profiles; the names follow vidorax-web's
 * WebProfileNames (`Default`, or `vidorax-<id>`).
 *
 * A download still running when the user switches profiles uses the new profile's jar for its later requests.
 */
internal object ActiveWebCookies {
  private const val DEFAULT = "Default"
  private val OWN = Regex("^vidorax-[a-z0-9]{1,32}$")

  // Resolved on the main thread (the Profile API's thread); CookieManager itself may be read from any thread.
  @Volatile
  private var profileCookies: CookieManager? = null

  fun current(): CookieManager = profileCookies ?: CookieManager.getInstance()

  /** False (and nothing changes) for a name VidoraX doesn't use. */
  @MainThread
  @SuppressLint("RequiresFeature") // Behind the MULTI_PROFILE check.
  fun use(profileName: String): Boolean {
    if (profileName != DEFAULT && !OWN.matches(profileName)) return false
    profileCookies =
      if (profileName == DEFAULT || !WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
        null
      } else {
        ProfileStore.getInstance().getOrCreateProfile(profileName).cookieManager
      }
    return true
  }
}
