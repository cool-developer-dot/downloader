package com.vidorax.media.cast

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The cast server over real sockets on the loopback address (a phone binds it to its Wi-Fi address instead). */
class CastFileServerTest {
  private val loopback: InetAddress = InetAddress.getByName("127.0.0.1")
  private val bytes = ByteArray(200_000) { (it % 251).toByte() }
  private val videoToken = "00112233445566778899aabbccddeeff"
  private val subtitleToken = "ffeeddccbbaa99887766554433221100"
  private val vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n".toByteArray()
  private lateinit var server: CastFileServer

  private val file = object : CastServedFile {
    override val length: Long = bytes.size.toLong()
    override val contentType: String = "video/mp4"

    override fun open(offset: Long): InputStream =
      ByteArrayInputStream(bytes, offset.toInt(), bytes.size - offset.toInt())
  }

  @Before fun start() {
    server = CastFileServer(loopback, file, videoToken, vtt, subtitleToken)
    server.start()
  }

  @After fun stop() {
    server.close()
  }

  private class Reply(val code: Int, val headers: Map<String, String>, val body: ByteArray)

  private fun request(method: String, path: String, vararg headers: String): Reply {
    Socket().use { socket ->
      socket.connect(InetSocketAddress(loopback, server.port), 5_000)
      socket.soTimeout = 10_000
      val head = buildString {
        append("$method $path HTTP/1.1\r\nHost: test\r\n")
        headers.forEach { append(it).append("\r\n") }
        append("\r\n")
      }
      socket.getOutputStream().apply {
        write(head.toByteArray(Charsets.ISO_8859_1))
        flush()
      }
      val all = socket.getInputStream().readBytes()
      val split = (0..all.size - 4).first {
        all[it] == '\r'.code.toByte() && all[it + 1] == '\n'.code.toByte() &&
          all[it + 2] == '\r'.code.toByte() && all[it + 3] == '\n'.code.toByte()
      }
      val lines = String(all, 0, split, Charsets.ISO_8859_1).split("\r\n")
      val code = lines.first().split(' ')[1].toInt()
      val parsed = lines.drop(1).associate { line ->
        line.substringBefore(':').trim().lowercase() to line.substringAfter(':').trim()
      }
      return Reply(code, parsed, all.copyOfRange(split + 4, all.size))
    }
  }

  @Test fun servesTheWholeFileWithItsType() {
    val reply = request("GET", "/$videoToken")
    assertEquals(200, reply.code)
    assertEquals("video/mp4", reply.headers["content-type"])
    assertEquals(bytes.size.toString(), reply.headers["content-length"])
    assertEquals("bytes", reply.headers["accept-ranges"])
    assertArrayEquals(bytes, reply.body)
  }

  @Test fun servesARangeAs206() {
    val reply = request("GET", "/$videoToken", "Range: bytes=1000-1999")
    assertEquals(206, reply.code)
    assertEquals("bytes 1000-1999/${bytes.size}", reply.headers["content-range"])
    assertEquals("1000", reply.headers["content-length"])
    assertArrayEquals(bytes.copyOfRange(1000, 2000), reply.body)
  }

  @Test fun servesAnOpenAndASuffixRange() {
    val open = request("GET", "/$videoToken", "Range: bytes=199000-")
    assertEquals(206, open.code)
    assertArrayEquals(bytes.copyOfRange(199_000, bytes.size), open.body)
    val suffix = request("GET", "/$videoToken", "Range: bytes=-10")
    assertEquals(206, suffix.code)
    assertArrayEquals(bytes.copyOfRange(bytes.size - 10, bytes.size), suffix.body)
  }

  @Test fun aRangePastTheEndIs416() {
    val reply = request("GET", "/$videoToken", "Range: bytes=999999-")
    assertEquals(416, reply.code)
    assertEquals("bytes */${bytes.size}", reply.headers["content-range"])
    assertEquals(0, reply.body.size)
  }

  @Test fun headAnswersWithoutABody() {
    val reply = request("HEAD", "/$videoToken")
    assertEquals(200, reply.code)
    assertEquals(bytes.size.toString(), reply.headers["content-length"])
    assertEquals(0, reply.body.size)
  }

  @Test fun servesTheSubtitlesAsWebVtt() {
    val reply = request("GET", "/$subtitleToken.vtt")
    assertEquals(200, reply.code)
    assertEquals(CastFileServer.SUBTITLE_TYPE, reply.headers["content-type"])
    assertEquals("*", reply.headers["access-control-allow-origin"])
    assertArrayEquals(vtt, reply.body)
  }

  @Test fun anyOtherPathOrTokenIs404() {
    val wrong = listOf(
      "/",
      "/index.html",
      "/ffffffffffffffffffffffffffffffff",
      "/${videoToken.uppercase()}",
      "/$videoToken/",
      "/$videoToken.vtt",
      "/$subtitleToken",
      "/../$videoToken",
      "/${videoToken.dropLast(1)}",
      "/x/$videoToken",
    )
    for (path in wrong) {
      val reply = request("GET", path)
      assertEquals(path, 404, reply.code)
      assertEquals(path, 0, reply.body.size)
    }
  }

  @Test fun otherMethodsAre404() {
    assertEquals(404, request("POST", "/$videoToken").code)
    assertEquals(404, request("PUT", "/$videoToken").code)
    assertEquals(404, request("DELETE", "/$videoToken").code)
  }

  @Test fun aPreflightIsAnswered() {
    val reply = request("OPTIONS", "/$subtitleToken.vtt")
    assertEquals(204, reply.code)
    assertTrue(reply.headers["access-control-allow-methods"]!!.contains("GET"))
  }

  @Test fun aQueryStringDoesNotChangeThePath() {
    assertEquals(200, request("HEAD", "/$videoToken?x=1").code)
  }

  @Test fun noSubtitleTokenMeansNoSubtitlePath() {
    server.close()
    server = CastFileServer(loopback, file, videoToken)
    server.start()
    assertEquals(404, request("GET", "/$subtitleToken.vtt").code)
    assertEquals(200, request("HEAD", "/$videoToken").code)
  }

  @Test fun afterCloseNothingListens() {
    val port = server.port
    server.close()
    assertFalse(server.isRunning)
    val refused = runCatching { Socket().use { it.connect(InetSocketAddress(loopback, port), 2_000) } }
    assertTrue(refused.isFailure)
  }

  @Test fun theRequestReaderTakesTheLineAndHeaders() {
    val head = "GET /abc?q=1 HTTP/1.1\r\nRange: bytes=1-2\r\nX-Other:  v \r\n\r\n"
    val request = CastFileServer.readRequest(ByteArrayInputStream(head.toByteArray()))!!
    assertEquals("GET", request.method)
    assertEquals("/abc", request.path)
    assertEquals("bytes=1-2", request.headers["range"])
    assertEquals("v", request.headers["x-other"])
    assertNull(CastFileServer.readRequest(ByteArrayInputStream("nonsense\r\n\r\n".toByteArray())))
    assertNull(CastFileServer.readRequest(ByteArrayInputStream(ByteArray(0))))
  }
}
