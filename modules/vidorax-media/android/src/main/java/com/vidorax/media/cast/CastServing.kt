package com.vidorax.media.cast

import java.net.InetAddress

/** No Wi-Fi address to serve from: a local file can't reach the TV. */
class CastNoWifiException : IllegalStateException("No Wi-Fi network")

/**
 * P13 #667: when the local server runs. It is started only by [begin] (a cast of a local file starts or moves to the
 * next video) and stopped by [end]: the cast stopped, the Cast session ended or dropped, or the app is destroyed.
 * Loading another video replaces the server and its tokens, so an old URL stops working at once. With nothing cast,
 * no server and no open port exist.
 */
class CastServing(
  /** The phone's Wi-Fi address, or null without Wi-Fi ([WifiAddress] on a phone, loopback in tests). */
  private val wifiAddress: () -> InetAddress?,
  private val newToken: () -> String = { CastUrls.newToken() },
) {
  data class Urls(val video: String, val subtitle: String?)

  private var server: CastFileServer? = null

  val isRunning: Boolean
    @Synchronized get() = server?.isRunning == true

  /** Serves [video] (and [subtitleVtt], when there is one) from a new server; any earlier one stops first. */
  @Synchronized
  fun begin(video: CastServedFile, subtitleVtt: ByteArray?): Urls {
    end()
    val address = wifiAddress() ?: throw CastNoWifiException()
    val videoToken = newToken()
    val subtitleToken = subtitleVtt?.let { newToken() }
    val started = CastFileServer(address, video, videoToken, subtitleVtt, subtitleToken)
    started.start()
    server = started
    val host = address.hostAddress ?: throw CastNoWifiException()
    return Urls(
      video = CastUrls.url(host, started.port, CastUrls.videoPath(videoToken)),
      subtitle = subtitleToken?.let { CastUrls.url(host, started.port, CastUrls.subtitlePath(it)) },
    )
  }

  /** Stops the server, if one runs. Safe to call any number of times. */
  @Synchronized
  fun end() {
    server?.close()
    server = null
  }
}
