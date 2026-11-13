package com.vidorax.web.profiles

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.annotation.MainThread
import androidx.webkit.ProfileStore
import java.util.WeakHashMap

/**
 * B11 #104 / #109 — the temporary WebView profile of the incognito session (Faran's rules):
 *
 * - One per session, named `vidorax-incog<session>` by JS ([isIncognitoName]); a name is never used twice, so data
 *   WebView hasn't finished deleting can never reappear in a later session.
 * - Never made active ([WebProfiles.setActive] is global: it moves the cookie jar downloads and privacy use). An
 *   incognito WebView joins it on its own through [WebProfiles.applyNamed], from beforeWebViewSetupInProfile — the
 *   only moment a WebView's profile can be chosen.
 * - Only the session JS started ([start]) is applied; any other name is refused and the WebView stays in the active
 *   profile, which JS detects ([nameOf]) and then closes the tab (fail closed).
 * - Deleted by JS (profile-service.ts) after the session's WebViews are gone; WebView wipes its cookies, storage,
 *   cache and service workers with it.
 *
 * Main thread, like the Profile API, except [liveCookies] which CookieManager allows on any thread.
 */
@SuppressLint("RequiresFeature") // Every Profile API call is behind the supported() check.
internal object IncognitoProfiles {
  private val NAME = Regex("^vidorax-incog[a-z0-9]{1,27}$")

  @Volatile
  var liveName: String? = null
    private set

  @Volatile
  private var liveJar: CookieManager? = null

  // Each incognito WebView and its profile name (weak: a destroyed WebView drops out).
  private val views = WeakHashMap<WebView, String>()

  fun isIncognitoName(name: String?): Boolean = name != null && NAME.matches(name) && WebProfileNames.isValid(name)

  /**
   * Starts (or confirms) the session [name]: its profile is created, and its jar follows the browser's cookie setting
   * ([acceptCookies], B12). False without WebView profile support — then there is no incognito at all.
   */
  @MainThread
  fun start(
    name: String,
    acceptCookies: Boolean,
    supported: () -> Boolean = WebProfiles::isSupported,
    jarOf: (String) -> CookieManager? = { ProfileStore.getInstance().getOrCreateProfile(it).cookieManager },
  ): Boolean {
    if (!isIncognitoName(name) || !supported()) return false
    val jar = jarOf(name) ?: return false
    jar.setAcceptCookie(acceptCookies)
    liveName = name
    liveJar = jar
    return true
  }

  /** The session ended (its WebViews are being removed); the profile itself is deleted by [WebProfiles.delete]. */
  @MainThread
  fun end(name: String) {
    if (liveName == name) {
      liveName = null
      liveJar = null
    }
  }

  /** beforeWebViewSetupInProfile: true when [webView] joined the live session's profile. */
  @MainThread
  fun apply(webView: WebView, name: String, join: (WebView, String) -> Unit = WebProfiles::applyNamed): Boolean {
    if (name != liveName || !isIncognitoName(name)) return false
    join(webView, name)
    views[webView] = name
    return true
  }

  /** The incognito session [webView] belongs to, or null for a normal WebView. */
  @MainThread
  fun nameOf(webView: WebView): String? = views[webView]

  /** The live session's cookie jar (downloads from an incognito tab), or null. */
  fun liveCookies(name: String?): CookieManager? = if (name != null && name == liveName) liveJar else null

  /** B12 "Block all cookies" changed while a session is live. */
  fun setAcceptCookies(accept: Boolean) {
    liveJar?.setAcceptCookie(accept)
  }

  /** Tests only. */
  internal fun resetForTests() {
    liveName = null
    liveJar = null
    views.clear()
  }
}
