package com.vidorax.media.remote

/** Why Remote control stopped (said on the phone's Remote control screen). */
enum class RemoteStopReason(val wire: String) {
  /** The user turned it off. */
  USER("user"),

  /** [RemoteStopPolicy.IDLE_TIMEOUT_MS] with no request. */
  IDLE("idle"),

  /** The Wi-Fi network went away or the phone's address on it changed. */
  WIFI_LOST("wifi_lost"),

  /** VidoraX went to the background with no download running. */
  BACKGROUND("background"),

  /** The server could not keep listening. */
  ERROR("error"),
}

/**
 * When the running server stops by itself. Pure, so the timing rules are unit tested:
 * - the phone is no longer on the network it bound to (Wi-Fi lost, or a new address);
 * - no request for [IDLE_TIMEOUT_MS];
 * - VidoraX has been in the background for [BACKGROUND_GRACE_MS] and no download is running — the server lives only
 *   while the app is open or the existing download runner keeps the process up, so it never needs a service of its own.
 */
object RemoteStopPolicy {
  const val IDLE_TIMEOUT_MS = 30L * 60 * 1000
  const val BACKGROUND_GRACE_MS = 60_000L

  /** How often the running server looks at these rules. */
  const val CHECK_INTERVAL_MS = 10_000L

  fun check(
    now: Long,
    lastRequestAt: Long,
    backgroundSince: Long?,
    hasLiveWork: Boolean,
    boundAddress: String,
    currentLanAddress: String?,
  ): RemoteStopReason? {
    if (currentLanAddress != boundAddress) return RemoteStopReason.WIFI_LOST
    if (now - lastRequestAt >= IDLE_TIMEOUT_MS) return RemoteStopReason.IDLE
    if (backgroundSince != null && now - backgroundSince >= BACKGROUND_GRACE_MS && !hasLiveWork) {
      return RemoteStopReason.BACKGROUND
    }
    return null
  }
}
