package com.vidorax.media.net

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.BatteryManager
import com.vidorax.media.engine.DeviceConditions
import com.vidorax.media.engine.DeviceSnapshot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * F3: the device facts the download rules need — battery level, charging, roaming — kept current from the battery
 * broadcast and the default network's capabilities. Registered once for the process. Every reading that fails keeps
 * the last known value: a failing sensor must never hold a download.
 */
internal class AndroidDeviceConditions(context: Context) : DeviceConditions {
  private val app = context.applicationContext
  private val connectivity = app.getSystemService(ConnectivityManager::class.java)
  private val state = MutableStateFlow(DeviceSnapshot.UNKNOWN)

  override val changes: StateFlow<DeviceSnapshot> = state

  override fun current(): DeviceSnapshot = state.value

  init {
    runCatching {
      val battery = app.registerReceiver(
        object : BroadcastReceiver() {
          override fun onReceive(context: Context, intent: Intent) {
            state.value = withBattery(state.value, intent)
          }
        },
        IntentFilter(Intent.ACTION_BATTERY_CHANGED),
      )
      // ACTION_BATTERY_CHANGED is sticky: the registration hands back the current reading at once.
      if (battery != null) state.value = withBattery(state.value, battery)
    }
    runCatching {
      connectivity?.activeNetwork?.let { network ->
        connectivity.getNetworkCapabilities(network)?.let { state.value = state.value.copy(roaming = isRoaming(it)) }
      }
      connectivity?.registerDefaultNetworkCallback(
        object : ConnectivityManager.NetworkCallback() {
          override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            state.value = state.value.copy(roaming = isRoaming(capabilities))
          }

          // No network: nothing to roam on (Wi-Fi-only and offline waits are the network gate's business).
          override fun onLost(network: Network) {
            state.value = state.value.copy(roaming = false)
          }
        },
      )
    }
  }

  internal companion object {
    fun isRoaming(capabilities: NetworkCapabilities): Boolean =
      !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING)

    /** Level and plug state from a battery broadcast; an incomplete one keeps what was known. */
    fun withBattery(previous: DeviceSnapshot, intent: Intent): DeviceSnapshot {
      val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
      val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
      val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
      val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
      val percent = if (level >= 0 && scale > 0) level * 100 / scale else previous.batteryPercent
      val charging = when {
        plugged > 0 -> true
        status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL -> true
        plugged == 0 -> false
        else -> previous.charging
      }
      return previous.copy(batteryPercent = percent, charging = charging)
    }
  }
}
