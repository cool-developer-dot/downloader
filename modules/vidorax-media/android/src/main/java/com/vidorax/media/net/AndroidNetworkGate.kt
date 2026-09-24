package com.vidorax.media.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import com.vidorax.media.engine.NetworkGate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first

/** What the engine needs to know about the device's connection. */
internal data class NetworkStatus(val connected: Boolean, val unmetered: Boolean) {
  fun usable(wifiOnly: Boolean): Boolean = connected && (!wifiOnly || unmetered)

  companion object {
    /** The platform gave no answer (no ConnectivityManager, a failing query): let the transfer report the truth. */
    val ASSUMED_USABLE = NetworkStatus(connected = true, unmetered = true)

    /** A definite answer: there is no network. Downloads wait instead of failing. */
    val OFFLINE = NetworkStatus(connected = false, unmetered = false)

    fun of(capabilities: NetworkCapabilities): NetworkStatus = NetworkStatus(
      connected = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
      unmetered = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
    )
  }
}

/**
 * Connectivity as the download engine sees it: is there a usable network at all, and is it unmetered. Registered
 * once for the process; a Wi-Fi ⇄ mobile switch just moves the state, which is what lets a waiting download
 * continue by itself instead of failing.
 */
internal class AndroidNetworkGate(context: Context) : NetworkGate {
  private val manager = context.getSystemService(ConnectivityManager::class.java)
  private val status = MutableStateFlow(read(manager))

  init {
    runCatching {
      manager?.registerDefaultNetworkCallback(
        object : ConnectivityManager.NetworkCallback() {
          override fun onAvailable(network: Network) {
            status.value = read(manager)
          }

          // The default network is gone. Offline unless another network is already the default (a replacement also
          // arrives as onAvailable; the order of the two callbacks is not something to rely on).
          override fun onLost(network: Network) {
            status.value = afterLost(manager, network)
          }

          override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            status.value = NetworkStatus.of(capabilities)
          }
        },
      )
    }
  }

  override fun isUsable(wifiOnly: Boolean): Boolean = status.value.usable(wifiOnly)

  override suspend fun awaitUsable(wifiOnly: Boolean) {
    status.first { it.usable(wifiOnly) }
  }

  override suspend fun awaitUnusable(wifiOnly: Boolean) {
    status.first { !it.usable(wifiOnly) }
  }

  internal companion object {
    /**
     * The current status. No active network is an answer — offline — not a missing one: treating it as "assume
     * usable" is what made an offline download burn its retries and fail with "network error" instead of waiting.
     * Only when the platform cannot answer at all does the engine assume it can work.
     */
    fun read(manager: ConnectivityManager?): NetworkStatus {
      manager ?: return NetworkStatus.ASSUMED_USABLE
      return try {
        val network = manager.activeNetwork ?: return NetworkStatus.OFFLINE
        val capabilities = manager.getNetworkCapabilities(network) ?: return NetworkStatus.OFFLINE
        NetworkStatus.of(capabilities)
      } catch (e: RuntimeException) {
        NetworkStatus.ASSUMED_USABLE
      }
    }

    /** The status after [lost] stopped being the default network: never that network's stale capabilities. */
    fun afterLost(manager: ConnectivityManager?, lost: Network): NetworkStatus {
      val active = runCatching { manager?.activeNetwork }.getOrNull()
      return if (active == null || active == lost) NetworkStatus.OFFLINE else read(manager)
    }
  }
}
