package com.vidorax.web.devtools

import android.webkit.WebView
import androidx.annotation.MainThread

/**
 * B19 #228 — remote debugging of the app's pages (chrome://inspect over USB): `WebView.setWebContentsDebuggingEnabled`,
 * which is process-wide. Only JS turns it on, from Browser settings → Developer, after a warning; nothing remembers it,
 * so a new app process starts with it off (release builds never turn it on by themselves; react-native-webview's debug
 * builds do, for every WebView).
 */
internal object RemoteDebugging {
  @Volatile
  var enabled: Boolean = false
    private set

  @MainThread
  fun set(on: Boolean, apply: (Boolean) -> Unit = WebView::setWebContentsDebuggingEnabled): Boolean {
    apply(on)
    enabled = on
    return enabled
  }

  /** Tests only. */
  internal fun resetForTests() {
    enabled = false
  }
}
