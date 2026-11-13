package com.vidorax.web.privacy

import android.annotation.SuppressLint
import android.net.http.SslCertificate
import android.os.Build
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.annotation.MainThread
import androidx.webkit.ProfileStore
import androidx.webkit.WebStorageCompat
import androidx.webkit.WebViewFeature
import com.vidorax.web.profiles.WebProfileNames
import com.vidorax.web.profiles.WebProfiles
import java.security.MessageDigest

/**
 * B12 privacy controls, for the browser profile in use (B20): its cookie jar (block all cookies), its site storage
 * (#130 View site data: list, clear one site, clear all) and the certificate of the page a tab shows (#125). Main
 * thread, like WebView.
 */
// The profile's storage is used only when WebProfiles says profiles are supported; the newer delete only where
// WebViewFeature has it.
@SuppressLint("RequiresFeature")
internal object SitePrivacy {
  private fun storage(): WebStorage {
    val name = WebProfiles.activeName
    if (!WebProfileNames.isDefault(name) && WebProfiles.isSupported()) {
      ProfileStore.getInstance().getProfile(name)?.webStorage?.let { return it }
    }
    return WebStorage.getInstance()
  }

  /** #112: all cookies on or off for the active profile (WebView keeps this only while the app runs; JS re-applies). */
  @MainThread
  fun setCookiesEnabled(enabled: Boolean) {
    WebProfiles.cookies().setAcceptCookie(enabled)
  }

  /** #125: the certificate of the page in this WebView, or null (no page, or not HTTPS). */
  @MainThread
  fun certificate(webView: WebView?): Map<String, Any?>? {
    val cert: SslCertificate = webView?.certificate ?: return null
    val fingerprint =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        cert.x509Certificate?.encoded?.let { bytes ->
          MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(":") { "%02X".format(it) }
        }
      } else {
        null
      }
    return mapOf(
      "issuedToName" to cert.issuedTo?.cName?.takeIf { it.isNotBlank() },
      "issuedToOrganization" to cert.issuedTo?.oName?.takeIf { it.isNotBlank() },
      "issuedByName" to cert.issuedBy?.cName?.takeIf { it.isNotBlank() },
      "issuedByOrganization" to cert.issuedBy?.oName?.takeIf { it.isNotBlank() },
      "validFrom" to cert.validNotBeforeDate?.time?.toDouble(),
      "validUntil" to cert.validNotAfterDate?.time?.toDouble(),
      "sha256" to fingerprint,
    )
  }

  /** #130: the sites that keep storage (localStorage, IndexedDB, caches…) and how much. */
  @MainThread
  fun listOrigins(done: (List<Map<String, Any>>) -> Unit) {
    storage().getOrigins { origins ->
      val list = origins.orEmpty().values.mapNotNull { value ->
        val origin = value as? WebStorage.Origin ?: return@mapNotNull null
        if (!SiteDataRules.isWebOrigin(origin.origin)) return@mapNotNull null
        mapOf(
          "origin" to SiteDataRules.normalizeOrigin(origin.origin),
          "usage" to origin.usage.toDouble(),
          "quota" to origin.quota.toDouble(),
        )
      }
      done(list)
    }
  }

  /**
   * WebView's newer delete covers everything a site keeps, Cache Storage and service workers included; the older
   * WebStorage calls leave those (a PWA's offline cache stays). Used where WebView has it.
   */
  private fun canDeleteBrowsingData(): Boolean = WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)

  /** #130: one site's storage and the cookies WebView reports for it. False for anything but a web origin. */
  @MainThread
  fun clearOrigin(origin: String, done: (Boolean) -> Unit) {
    if (!SiteDataRules.isWebOrigin(origin)) {
      done(false)
      return
    }
    val host = SiteDataRules.hostOf(origin)
    if (canDeleteBrowsingData()) {
      // The whole site (its registrable domain), as WebView defines one.
      WebStorageCompat.deleteBrowsingDataForSite(storage(), host) {
        expireCookies(host)
        done(true)
      }
      return
    }
    storage().deleteOrigin(origin)
    expireCookies(host)
    done(true)
  }

  private fun expireCookies(host: String) {
    val cookies = WebProfiles.cookies()
    for (scheme in listOf("https", "http")) {
      val url = "$scheme://$host/"
      for (name in SiteDataRules.cookieNames(cookies.getCookie(url))) {
        for (header in SiteDataRules.expiryHeaders(name, host)) cookies.setCookie(url, header)
      }
    }
    cookies.flush()
  }

  /** #130 / Hamza's B11: every site's cookies and storage in the active profile. */
  @MainThread
  fun clearAll(done: () -> Unit) {
    val cookies = WebProfiles.cookies()
    val removeCookies = {
      cookies.removeAllCookies {
        cookies.flush()
        done()
      }
    }
    if (canDeleteBrowsingData()) {
      WebStorageCompat.deleteBrowsingData(storage()) { removeCookies() }
      return
    }
    storage().deleteAllData()
    removeCookies()
  }

  /** How many cookies WebView would send to this address. */
  fun cookieCount(url: String): Int = SiteDataRules.cookieNames(WebProfiles.cookies().getCookie(url)).size
}
