package com.anonymous.vidorax.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Android STREAM_MUSIC volume read/write for the player UI.
 */
@ReactModule(name = VidoraMediaVolumeModule.NAME)
class VidoraMediaVolumeModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "VidoraMediaVolume"
    private const val EVENT_VOLUME_CHANGED = "onMediaVolumeChanged"
  }

  private val audioManager: AudioManager? =
    reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  private var volumeReceiver: BroadcastReceiver? = null

  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    registerVolumeReceiver()
  }

  override fun invalidate() {
    unregisterVolumeReceiver()
    super.invalidate()
  }

  @ReactMethod
  fun getMediaVolume(promise: Promise) {
    try {
      promise.resolve(buildVolumeMap())
    } catch (error: Exception) {
      promise.reject("E_MEDIA_VOLUME", error.message, error)
    }
  }

  @ReactMethod
  fun setMediaVolume(level: Double, promise: Promise) {
    try {
      val manager = audioManager
      if (manager == null) {
        promise.reject("E_MEDIA_VOLUME", "AudioManager unavailable")
        return
      }
      val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      if (max <= 0) {
        promise.reject("E_MEDIA_VOLUME", "Invalid max volume")
        return
      }
      val clamped = level.coerceIn(0.0, 1.0)
      val target = (clamped * max).toInt().coerceIn(0, max)
      manager.setStreamVolume(
        AudioManager.STREAM_MUSIC,
        target,
        0,
      )
      promise.resolve(buildVolumeMap())
    } catch (error: Exception) {
      promise.reject("E_MEDIA_VOLUME", error.message, error)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // NativeEventEmitter contract
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // NativeEventEmitter contract
  }

  private fun buildVolumeMap(): com.facebook.react.bridge.WritableMap {
    val manager = audioManager
    val map = Arguments.createMap()
    if (manager == null) {
      map.putDouble("level", 0.0)
      map.putInt("current", 0)
      map.putInt("max", 0)
      map.putBoolean("available", false)
      return map
    }
    val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    val current = manager.getStreamVolume(AudioManager.STREAM_MUSIC).coerceIn(0, max)
    map.putDouble("level", current.toDouble() / max.toDouble())
    map.putInt("current", current)
    map.putInt("max", max)
    map.putBoolean("available", true)
    return map
  }

  private fun emitVolumeChanged() {
    if (!reactContext.hasActiveReactInstance()) {
      return
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(EVENT_VOLUME_CHANGED, buildVolumeMap())
  }

  private fun registerVolumeReceiver() {
    if (volumeReceiver != null) {
      return
    }
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          if (intent?.action != VOLUME_CHANGED_ACTION) {
            return
          }
          val streamType =
            intent.getIntExtra(EXTRA_VOLUME_STREAM_TYPE, -1)
          if (streamType == AudioManager.STREAM_MUSIC) {
            emitVolumeChanged()
          }
        }
      }
    val filter = IntentFilter(VOLUME_CHANGED_ACTION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      reactContext.registerReceiver(receiver, filter)
    }
    volumeReceiver = receiver
  }

  private fun unregisterVolumeReceiver() {
    val receiver = volumeReceiver ?: return
    try {
      reactContext.unregisterReceiver(receiver)
    } catch (_: IllegalArgumentException) {
      // already unregistered
    }
    volumeReceiver = null
  }
}

private const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
private const val EXTRA_VOLUME_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
