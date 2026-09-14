/**
 * Android native Intent launcher — Intent.parseUri + resolveActivity.
 * Never logs URI contents that may contain tokens.
 */
package com.anonymous.vidorax.intent

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class VidoraIntentLauncherModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "VidoraIntentLauncher"

  @ReactMethod
  fun canHandleIntentUri(uri: String, promise: Promise) {
    try {
      val intent = buildSafeIntent(uri) ?: run {
        promise.resolve(false)
        return
      }
      val pm = reactContext.packageManager
      val resolved = pm?.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
      promise.resolve(resolved != null)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun openIntentUri(uri: String, promise: Promise) {
    try {
      val intent = buildSafeIntent(uri) ?: run {
        promise.resolve(false)
        return
      }
      val pm = reactContext.packageManager
      val resolved = pm?.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
      if (resolved == null) {
        promise.resolve(false)
        return
      }

      // Prefer activity context; fall back to NEW_TASK on application context.
      val activity = reactContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactContext.startActivity(intent)
      }
      promise.resolve(true)
    } catch (_: Exception) {
      // Never reject with raw URI / stack — callers treat false as blocked.
      promise.resolve(false)
    }
  }

  /**
   * Parse URI_INTENT_SCHEME, strip explicit component/selector, block dangerous schemes.
   */
  private fun buildSafeIntent(uri: String): Intent? {
    val trimmed = uri.trim()
    if (trimmed.isEmpty()) {
      return null
    }
    if (!trimmed.startsWith("intent:", ignoreCase = true)) {
      return null
    }

    val intent = Intent.parseUri(trimmed, Intent.URI_INTENT_SCHEME)

    // Never honor attacker-controlled explicit components.
    intent.component = null
    intent.selector = null

    val data: Uri? = intent.data
    val scheme = (data?.scheme ?: intent.scheme)?.lowercase()
    if (scheme != null && DANGEROUS_SCHEMES.contains(scheme)) {
      return null
    }

    // Ensure VIEW + BROWSABLE for http(s) / market-style handoffs.
    if (intent.action.isNullOrBlank()) {
      intent.action = Intent.ACTION_VIEW
    }
    intent.addCategory(Intent.CATEGORY_BROWSABLE)

    return intent
  }

  companion object {
    private val DANGEROUS_SCHEMES = setOf(
      "javascript",
      "file",
      "data",
      "blob",
      "content",
      "view-source",
    )
  }
}
