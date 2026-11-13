package com.vidorax.web.apps

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

/**
 * B22 #273 — "Open in app" for a few apps, detected through the app manifest's `<queries>` package entries (never
 * QUERY_ALL_PACKAGES). JS asks by app id; only these packages can be named.
 */
internal object AppLinks {
  val PACKAGES: Map<String, List<String>> = mapOf(
    "youtube" to listOf("com.google.android.youtube"),
    "instagram" to listOf("com.instagram.android"),
    "facebook" to listOf("com.facebook.katana", "com.facebook.lite"),
    "tiktok" to listOf("com.zhiliaoapp.musically", "com.ss.android.ugc.trill"),
    "x" to listOf("com.twitter.android"),
    "maps" to listOf("com.google.android.apps.maps"),
  )

  /** The installed package for [app], or null. */
  fun installedPackage(app: String, isInstalled: (String) -> Boolean): String? =
    PACKAGES[app]?.firstOrNull(isInstalled)

  fun isInstalled(context: Context, pkg: String): Boolean =
    try {
      context.packageManager.getPackageInfo(pkg, 0)
      true
    } catch (_: PackageManager.NameNotFoundException) {
      false
    }

  /** The https address in [app]'s own app; false when it isn't installed or won't take it. */
  fun open(context: Context, app: String, url: String): Boolean {
    if (!url.startsWith("https://", ignoreCase = true)) return false
    val pkg = installedPackage(app) { isInstalled(context, it) } ?: return false
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      context.startActivity(intent)
      true
    } catch (_: RuntimeException) {
      false
    }
  }
}
