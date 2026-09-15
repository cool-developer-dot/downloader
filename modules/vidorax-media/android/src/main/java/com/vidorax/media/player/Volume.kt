package com.vidorax.media.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import androidx.core.content.ContextCompat
import kotlin.math.roundToInt

/** Media stream volume for the player's volume gesture. */
class Volume(private val context: Context) {
  private val audioManager = context.getSystemService(AudioManager::class.java)
  private var receiver: BroadcastReceiver? = null

  /** 0..1 */
  fun get(): Double {
    val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    return if (max <= 0) 0.0 else audioManager.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max
  }

  fun set(volume: Double) {
    val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    val index = (volume.coerceIn(0.0, 1.0) * max).roundToInt()
    audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, index, 0)
  }

  /** Calls [onChange] whenever the media volume changes: hardware keys, other apps or [set]. */
  fun observe(onChange: (Double) -> Unit) {
    if (receiver != null) return
    var last = get()
    val volumeReceiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        if (intent.getIntExtra(EXTRA_VOLUME_STREAM_TYPE, -1) != AudioManager.STREAM_MUSIC) return
        val current = get()
        if (current != last) {
          last = current
          onChange(current)
        }
      }
    }
    ContextCompat.registerReceiver(
      context,
      volumeReceiver,
      IntentFilter(VOLUME_CHANGED_ACTION),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    receiver = volumeReceiver
  }

  fun stopObserving() {
    receiver?.let(context::unregisterReceiver)
    receiver = null
  }

  private companion object {
    // Framework broadcast without a public constant; the only way to observe stream volume changes.
    const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
    const val EXTRA_VOLUME_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
  }
}
