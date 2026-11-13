package com.vidorax.media.net

import android.annotation.SuppressLint
import android.webkit.CookieManager
import androidx.annotation.MainThread
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewFeature

/**
 * B11 — the cookie jar of the live incognito session (vidorax-web's IncognitoProfiles, `vidorax-incog<session>`), so
 * a download started in an incognito tab carries that session's cookies and never the active profile's
 * ([ActiveWebCookies]). Resolved on the main thread when the session starts (the Profile API's thread) and read from
 * download threads; [jarFor] answers only for the live name, so a download whose session has ended (or whose name was
 * stored before a restart) gets no cookies at all. Never creates a profile.
 */
internal object IncognitoWebCookies {
  private val NAME = Regex("^vidorax-incog[a-z0-9]{1,27}$")

  @Volatile
  private var live: Pair<String, CookieManager>? = null

  fun isIncognitoName(name: String?): Boolean = name != null && NAME.matches(name)

  /** Null ends the session; a name not yet created by vidorax-web leaves no jar. */
  @MainThread
  @SuppressLint("RequiresFeature") // Behind the MULTI_PROFILE check.
  fun use(name: String?, lookup: (String) -> CookieManager? = ::existingJar): Boolean {
    if (name == null) {
      live = null
      return true
    }
    if (!isIncognitoName(name)) return false
    val jar = lookup(name)
    live = jar?.let { name to it }
    return jar != null
  }

  /** The jar for [name] while it is the live session, else null (never another profile's). */
  fun jarFor(name: String): CookieManager? = live?.takeIf { it.first == name }?.second

  @SuppressLint("RequiresFeature")
  private fun existingJar(name: String): CookieManager? =
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) null
    else ProfileStore.getInstance().getProfile(name)?.cookieManager
}
