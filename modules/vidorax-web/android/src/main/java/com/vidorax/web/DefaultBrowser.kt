package com.vidorax.web

import android.app.Activity
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/**
 * Whether VidoraX is the device's browser, and how to ask. The ask is always the system's own dialog or
 * settings screen — this never changes a system setting by itself.
 */
internal object DefaultBrowser {
  private const val REQUEST_CODE = 0x5644

  fun isHeld(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val roles = context.getSystemService(RoleManager::class.java)
      if (roles != null) {
        return runCatching { roles.isRoleHeld(RoleManager.ROLE_BROWSER) }.getOrDefault(false)
      }
    }
    // Before the role API, "default browser" is whatever resolves a plain web link.
    val resolved = runCatching {
      context.packageManager.resolveActivity(Intent(Intent.ACTION_VIEW, Uri.parse("http://example.com")), 0)
    }.getOrNull()
    return resolved?.activityInfo?.packageName == context.packageName
  }

  fun canRequest(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    val roles = context.getSystemService(RoleManager::class.java) ?: return false
    return runCatching {
      roles.isRoleAvailable(RoleManager.ROLE_BROWSER) && !roles.isRoleHeld(RoleManager.ROLE_BROWSER)
    }.getOrDefault(false)
  }

  /** Shows the system's own chooser. Returns false when the device offers no way to ask. */
  fun request(activity: Activity?, context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && activity != null) {
      val roles = context.getSystemService(RoleManager::class.java)
      val intent = runCatching { roles?.createRequestRoleIntent(RoleManager.ROLE_BROWSER) }.getOrNull()
      if (intent != null) {
        return runCatching {
          activity.startActivityForResult(intent, REQUEST_CODE)
          true
        }.getOrDefault(false)
      }
    }
    // Fall back to the settings page where the default apps live.
    val settings = Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
    val target = activity ?: context
    if (activity == null) settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return runCatching {
      target.startActivity(settings)
      true
    }.getOrDefault(false)
  }
}
