package com.anonymous.vidorax.mediadetection

import android.webkit.CookieManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Secure cookie bridge — reads WebView cookie jar for same-session download handoff.
 * Cookie values are returned to JS only; native layer never logs them.
 */
class VidoraCookieBridgeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "VidoraCookieBridge"

  @ReactMethod
  fun getCookiesForUrl(url: String, promise: Promise) {
    try {
      val cookieManager = CookieManager.getInstance()
      val cookies = cookieManager.getCookie(url)
      if (cookies.isNullOrBlank()) {
        promise.resolve(null)
      } else {
        promise.resolve(cookies)
      }
    } catch (error: Exception) {
      promise.reject("COOKIE_ERROR", error.message, error)
    }
  }

  @ReactMethod
  fun hasCookiesForUrl(url: String, promise: Promise) {
    try {
      val cookieManager = CookieManager.getInstance()
      val cookies = cookieManager.getCookie(url)
      promise.resolve(!cookies.isNullOrBlank())
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }
}
