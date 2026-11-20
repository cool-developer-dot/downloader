package com.vidorax.media.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.vidorax.media.engine.SecondNetwork
import com.vidorax.media.engine.SecondNetworkLease
import java.net.InetAddress
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Dns

/**
 * #446 "Experimental: use Wi-Fi and mobile data together": when the setting is on, a multi-connection download on
 * Wi-Fi asks Android for the mobile-data network as well (`requestNetwork(TRANSPORT_CELLULAR)`, which needs only the
 * normal permission CHANGE_NETWORK_STATE) and puts some of its parts on an OkHttp client bound to it
 * ([HttpClient.boundTo] with `Network.socketFactory` and the network's own DNS). The request is held only while such a
 * download runs, and given back when the last one ends, so the radio is not kept up for nothing.
 */
internal object MultiNetworkPolicy {
  /**
   * Whether a download uses a second network now: the setting is on, the download may use mobile data (neither the
   * app's nor its own "Wi-Fi only"), it uses several connections, and the device is on an unmetered network (Wi-Fi) —
   * on mobile data alone there is no second network to add.
   */
  fun wants(multiNetwork: Boolean, downloadWifiOnly: Boolean, connections: Int, onUnmetered: Boolean): Boolean =
    multiNetwork && !downloadWifiOnly && connections > 1 && onUnmetered
}

/** The Android implementation of [SecondNetwork]: mobile data, requested on demand and released when unused. */
internal class AndroidMobileData(
  context: Context,
  private val base: HttpClient,
  /** How long a first download waits for the mobile network to come up before it runs on Wi-Fi alone. */
  private val waitMs: Long = 4_000L,
) : SecondNetwork {
  private val manager = context.getSystemService(ConnectivityManager::class.java)
  private val network = MutableStateFlow<Network?>(null)
  private val lock = Any()
  private var callback: ConnectivityManager.NetworkCallback? = null
  private var users = 0
  private var cached: Pair<Network, HttpClient>? = null

  override suspend fun acquire(): SecondNetworkLease? {
    val manager = manager ?: return null
    synchronized(lock) {
      users += 1
      if (callback == null && !request(manager)) {
        users -= 1
        return null
      }
    }
    val up = withTimeoutOrNull(waitMs) { network.first { it != null } }
    if (up == null) {
      release()
      return null
    }
    return SecondNetworkLease(clientFor(up)) { release() }
  }

  /** Registers the request; false when Android refused it (no permission, too many requests). */
  private fun request(manager: ConnectivityManager): Boolean = runCatching {
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(available: Network) {
        network.value = available
      }

      override fun onLost(lost: Network) {
        if (network.value == lost) network.value = null
      }
    }
    manager.requestNetwork(
      NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR)
        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .build(),
      cb,
    )
    callback = cb
  }.isSuccess

  private fun release() {
    synchronized(lock) {
      users = (users - 1).coerceAtLeast(0)
      if (users > 0) return
      callback?.let { cb -> runCatching { manager?.unregisterNetworkCallback(cb) } }
      callback = null
      cached = null
      network.value = null
    }
  }

  private fun clientFor(on: Network): HttpClient = synchronized(lock) {
    cached?.takeIf { it.first == on }?.second ?: base.boundTo(on.socketFactory, NetworkDns(on)).also { cached = on to it }
  }

  /** Names resolved on that network itself: a Wi-Fi resolver may answer with addresses only Wi-Fi can reach. */
  private class NetworkDns(private val on: Network) : Dns {
    override fun lookup(hostname: String): List<InetAddress> = try {
      on.getAllByName(hostname).toList()
    } catch (e: java.net.UnknownHostException) {
      throw e
    } catch (e: Exception) {
      throw java.net.UnknownHostException("$hostname: ${e.javaClass.simpleName}")
    }
  }
}
