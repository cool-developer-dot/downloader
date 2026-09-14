package com.anonymous.vidorax.mediadetection

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

/**
 * RN bridge for Android WebView network observation.
 * Observation itself is performed via [MediaNetworkBridge] from WebViewClient.
 */
@ReactModule(name = VidoraMediaNetworkObserverModule.NAME)
class VidoraMediaNetworkObserverModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "VidoraMediaNetworkObserver"
  }

  init {
    MediaNetworkBridge.attach(reactContext)
  }

  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    MediaNetworkBridge.attach(reactContext)
  }

  override fun invalidate() {
    MediaNetworkBridge.detach(reactContext)
    super.invalidate()
  }

  @ReactMethod
  fun setEnabled(enabled: Boolean) {
    MediaNetworkBridge.setEnabled(enabled)
  }

  // Required for NativeEventEmitter
  @ReactMethod
  fun addListener(eventName: String) {
    // No-op — events pushed from MediaNetworkBridge
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // No-op
  }
}
