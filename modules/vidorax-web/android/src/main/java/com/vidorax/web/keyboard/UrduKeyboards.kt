package com.vidorax.web.keyboard

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.inputmethod.InputMethodManager

/**
 * B24 #271 — whether an Urdu keyboard is on: any enabled input method with an enabled Urdu subtype (Gboard, SwiftKey
 * and others list their languages as subtypes). Needs no permission. "Add Urdu keyboard" opens Android's keyboard
 * settings.
 */
internal object UrduKeyboards {
  /** "ur", "ur_PK", "ur-IN", "ur-Arab-PK" … (case ignored); never "urd"-like look-alikes of other codes. */
  fun isUrduTag(tag: String?): Boolean {
    val primary = tag?.trim()?.lowercase()?.split('_', '-')?.firstOrNull() ?: return false
    return primary == "ur"
  }

  fun hasUrduKeyboard(context: Context): Boolean {
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager ?: return false
    return try {
      imm.enabledInputMethodList.any { info ->
        imm.getEnabledInputMethodSubtypeList(info, true).any { subtype ->
          isUrduTag(subtype.languageTag.takeIf { it.isNotEmpty() }) || isUrduTag(@Suppress("DEPRECATION") subtype.locale)
        }
      }
    } catch (_: RuntimeException) {
      false
    }
  }

  fun openKeyboardSettings(activity: Activity?, context: Context): Boolean {
    val intent = Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)
    return try {
      if (activity != null) activity.startActivity(intent) else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: Exception) {
      false
    }
  }
}
