package com.vidorax.media.cast

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** The server's lifecycle: it runs only between a cast's begin and its end, and never without one. */
class CastServingTest {
  private val loopback: InetAddress = InetAddress.getByName("127.0.0.1")
  private val file = object : CastServedFile {
    override val length: Long = 10
    override val contentType: String = "video/mp4"
    override fun open(offset: Long): InputStream = ByteArrayInputStream(ByteArray(10), offset.toInt(), 10 - offset.toInt())
  }
  private val serving = CastServing({ loopback })

  @After fun end() {
    serving.end()
  }

  private fun listening(url: String): Boolean {
    val uri = URI(url)
    return runCatching { Socket().use { it.connect(InetSocketAddress(uri.host, uri.port), 2_000) } }.isSuccess
  }

  @Test fun nothingRunsBeforeACast() {
    assertFalse(CastServing({ loopback }).isRunning)
  }

  @Test fun aCastStartsTheServerAndItsEndStopsIt() {
    val urls = serving.begin(file, null)
    assertTrue(serving.isRunning)
    assertTrue(listening(urls.video))
    assertNull(urls.subtitle)
    serving.end()
    assertFalse(serving.isRunning)
    assertFalse(listening(urls.video))
  }

  @Test fun theUrlIsTheWifiAddressAndAToken() {
    val urls = serving.begin(file, "WEBVTT\n".toByteArray())
    val video = URI(urls.video)
    assertEquals("http", video.scheme)
    assertEquals("127.0.0.1", video.host)
    assertTrue(CastUrls.isToken(video.path.removePrefix("/")))
    val subtitle = URI(urls.subtitle!!)
    assertEquals(video.port, subtitle.port)
    assertTrue(subtitle.path.endsWith(".vtt"))
    assertNotEquals(video.path.removePrefix("/"), subtitle.path.removePrefix("/").removeSuffix(".vtt"))
  }

  @Test fun theNextVideoReplacesTheServerAndItsTokens() {
    val first = serving.begin(file, null)
    val second = serving.begin(file, null)
    assertNotEquals(first.video, second.video)
    assertTrue(serving.isRunning)
    assertTrue(listening(second.video))
    if (URI(first.video).port != URI(second.video).port) assertFalse(listening(first.video))
  }

  @Test fun endingTwiceOrWithoutACastIsHarmless() {
    serving.end()
    serving.begin(file, null)
    serving.end()
    serving.end()
    assertFalse(serving.isRunning)
  }

  @Test fun withoutWifiNothingStarts() {
    val offline = CastServing({ null })
    assertThrows(CastNoWifiException::class.java) { offline.begin(file, null) }
    assertFalse(offline.isRunning)
  }

  @Test fun aFailedStartLeavesTheEarlierServerStopped() {
    var address: InetAddress? = loopback
    val switching = CastServing({ address })
    val first = switching.begin(file, null)
    address = null
    assertThrows(CastNoWifiException::class.java) { switching.begin(file, null) }
    assertFalse(switching.isRunning)
    assertFalse(listening(first.video))
  }
}
