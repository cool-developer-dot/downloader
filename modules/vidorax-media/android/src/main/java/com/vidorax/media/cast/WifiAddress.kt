package com.vidorax.media.cast

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address
import java.net.InetAddress

/**
 * P13 #667: the phone's IPv4 address on Wi-Fi — the only address the cast server binds to. Never mobile data, a VPN,
 * Ethernet or loopback: a Chromecast is on the same Wi-Fi as the phone.
 */
object WifiAddress {
  @Suppress("DEPRECATION")
  fun find(context: Context): InetAddress? {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return null
    for (network in manager.allNetworks) {
      val caps = manager.getNetworkCapabilities(network) ?: continue
      if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
        continue
      }
      val address = manager.getLinkProperties(network)?.linkAddresses
        ?.map { it.address }
        ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress && !it.isLinkLocalAddress && !it.isAnyLocalAddress }
      if (address != null) return address
    }
    return null
  }
}
