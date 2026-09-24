package com.vidorax.media.net

import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.shadows.ShadowNetworkCapabilities

/** Offline must read as offline: that is what makes a download wait for the network instead of failing. */
@RunWith(RobolectricTestRunner::class)
class AndroidNetworkGateTest {
  private val manager = RuntimeEnvironment.getApplication().getSystemService(ConnectivityManager::class.java)

  private fun capabilities(vararg capability: Int): NetworkCapabilities =
    ShadowNetworkCapabilities.newInstance().also { caps ->
      capability.forEach { shadowOf(caps).addCapability(it) }
    }

  @Test fun anUnmeteredInternetConnectionIsUsableEvenWhenWifiOnly() {
    shadowOf(manager).setNetworkCapabilities(
      manager.activeNetwork,
      capabilities(NetworkCapabilities.NET_CAPABILITY_INTERNET, NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
    )
    val status = AndroidNetworkGate.read(manager)
    assertTrue(status.usable(wifiOnly = false))
    assertTrue(status.usable(wifiOnly = true))
  }

  @Test fun mobileDataIsUsableButNotForWifiOnly() {
    shadowOf(manager).setNetworkCapabilities(manager.activeNetwork, capabilities(NetworkCapabilities.NET_CAPABILITY_INTERNET))
    val status = AndroidNetworkGate.read(manager)
    assertTrue(status.usable(wifiOnly = false))
    assertFalse(status.usable(wifiOnly = true))
  }

  @Test fun noActiveNetworkIsOfflineNotAnUnknownThatIsAssumedUsable() {
    shadowOf(manager).setDefaultNetworkActive(false)
    assertEquals(NetworkStatus.OFFLINE, AndroidNetworkGate.read(manager))
    assertFalse(AndroidNetworkGate.read(manager).usable(wifiOnly = false))
  }

  @Test fun losingTheDefaultNetworkWithoutReplacementIsOffline() {
    val lost = manager.activeNetwork!!
    assertEquals(NetworkStatus.OFFLINE, AndroidNetworkGate.afterLost(manager, lost))

    shadowOf(manager).setDefaultNetworkActive(false)
    assertEquals(NetworkStatus.OFFLINE, AndroidNetworkGate.afterLost(manager, ShadowNetwork.newInstance(77)))
  }

  @Test fun losingANetworkThatIsNoLongerTheDefaultKeepsTheReplacement() {
    shadowOf(manager).setNetworkCapabilities(
      manager.activeNetwork,
      capabilities(NetworkCapabilities.NET_CAPABILITY_INTERNET, NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
    )
    val status = AndroidNetworkGate.afterLost(manager, ShadowNetwork.newInstance(4242))
    assertTrue("the old network's loss says nothing about the new default", status.usable(wifiOnly = true))
  }

  @Test fun withoutAConnectivityServiceTheEngineStillTries() {
    assertEquals(NetworkStatus.ASSUMED_USABLE, AndroidNetworkGate.read(null))
  }
}
