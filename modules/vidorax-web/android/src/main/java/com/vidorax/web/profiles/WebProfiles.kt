package com.vidorax.web.profiles

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.WebView
import androidx.annotation.MainThread
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.vidorax.web.network.ServiceWorkerRequests

/**
 * B20: the WebView profile new browser WebViews join. With WebView's profile support (WebViewFeature.MULTI_PROFILE)
 * each browser profile has its own cookies, site storage, cache and service workers; without it every profile shares
 * WebView's default jar, and JS says so in Browser settings (see [isSupported]).
 *
 * A WebView's profile can only be chosen before it is used, so [apply] runs from RNCWebViewHooks.beforeWebViewSetup,
 * and JS switches the active profile before it mounts the new profile's tabs. Main thread, like the Profile API.
 */
@SuppressLint("RequiresFeature") // Every Profile API call is behind isSupported().
internal object WebProfiles {
  @Volatile
  var activeName: String = WebProfileNames.DEFAULT
    private set

  // Resolved on the main thread when the profile changes; CookieManager itself may be read from any thread.
  @Volatile
  private var activeCookies: CookieManager? = null

  fun isSupported(): Boolean = WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)

  /** False (and nothing changes) for a name VidoraX doesn't use. */
  @MainThread
  fun setActive(name: String): Boolean {
    if (!WebProfileNames.isValid(name)) return false
    activeName = name
    activeCookies =
      if (WebProfileNames.isDefault(name) || !isSupported()) {
        null
      } else {
        ProfileStore.getInstance().getOrCreateProfile(name).cookieManager
      }
    return true
  }

  /** Puts a new WebView in the active profile; RNCWebViewHooks.beforeWebViewSetup, before anything else uses it. */
  @MainThread
  fun apply(webView: WebView) {
    applyNamed(webView, activeName)
  }

  /** The same for a separate browser window (B20 #16), whose tab's profile may not be the active one. */
  @MainThread
  fun applyNamed(webView: WebView, name: String) {
    if (!WebProfileNames.isValid(name) || WebProfileNames.isDefault(name) || !isSupported()) return
    WebViewCompat.setProfile(webView, name)
    ServiceWorkerRequests.installFor(name)
  }

  /** The WebView profiles that exist with a VidoraX name (none without profile support). */
  @MainThread
  fun names(): List<String> =
    if (!isSupported()) emptyList() else ProfileStore.getInstance().allProfileNames.filter(WebProfileNames::isValid)

  /** The active profile's cookie jar (any thread). */
  fun cookies(): CookieManager = activeCookies ?: CookieManager.getInstance()

  /**
   * Deletes a profile's cookies, storage and cache with the profile itself. False while one of its WebViews still
   * exists (JS tries again at the next start) or for the default profile, which is never deleted.
   */
  @MainThread
  fun delete(name: String): Boolean {
    if (!WebProfileNames.isValid(name) || WebProfileNames.isDefault(name)) return false
    if (name == activeName) return false
    if (!isSupported()) return true
    return try {
      val store = ProfileStore.getInstance()
      val deleted = store.getProfile(name) == null || store.deleteProfile(name)
      if (deleted) ServiceWorkerRequests.forget(name)
      deleted
    } catch (_: IllegalStateException) {
      false
    } catch (_: IllegalArgumentException) {
      false
    }
  }
}
