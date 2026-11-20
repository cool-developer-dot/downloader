package com.vidorax.media.remote

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.net.Socket

/** P6: the NanoHTTPD adapter over a real socket — bodies, limits, ranges and the router behind it. */
@RunWith(RobolectricTestRunner::class)
class RemoteServerTest {
  @get:Rule val folder = TemporaryFolder()

  private val auth = RemoteAuth(InMemoryPairedClientStorage())
  private val inbox = LinkInbox(InMemoryPendingLinkStorage())
  private val files = HashMap<String, SentFile>()
  private val sent = SentList(InMemorySentItemStorage(), resolveFile = { files[it] })
  private lateinit var server: RemoteServer
  private val client = OkHttpClient()
  private val json = "application/json".toMediaType()

  private object EmptyQueue : RemoteQueue {
    override suspend fun list() = emptyList<RemoteDownload>()
    override suspend fun pause(id: String) = Unit
    override suspend fun resume(id: String) = Unit
    override suspend fun retry(id: String) = Unit
    override suspend fun cancel(id: String) = Unit
    override suspend fun pauseAll() = Unit
    override suspend fun resumeAll() = Unit
  }

  private val base get() = "http://127.0.0.1:${server.listeningPort}"

  @Before
  fun setUp() {
    val router = RemoteRouter(
      auth = auth,
      queue = EmptyQueue,
      links = inbox,
      sent = sent,
      hosts = RemoteHostPolicy("127.0.0.1", 0, acceptLoopbackNames = true),
      assets = { name -> if (name == "index.html") "<!doctype html><title>VidoraX</title>".toByteArray() else null },
    )
    server = RemoteServer("127.0.0.1", 0, router)
    server.start(5_000, true)
  }

  @After
  fun tearDown() {
    server.stop()
  }

  @Test
  fun pairsAddsALinkAndListsOverHttp() {
    val pin = auth.newPin()
    val paired = client.newCall(
      Request.Builder().url("$base/api/v1/pair").post("""{"pin":"$pin","name":"curl"}""".toRequestBody(json)).build(),
    ).execute()
    assertEquals(200, paired.code)
    val token = JSONObject(paired.body!!.string()).getString("token")

    val added = client.newCall(
      Request.Builder().url("$base/api/v1/downloads").header("Authorization", "Bearer $token")
        .post("""{"url":"https://example.com/v.mp4"}""".toRequestBody(json)).build(),
    ).execute()
    assertEquals(202, added.code)
    assertEquals("https://example.com/v.mp4", inbox.pending().single().url)

    val list = client.newCall(Request.Builder().url("$base/api/v1/downloads").header("Authorization", "Bearer $token").build()).execute()
    assertEquals(200, list.code)
    assertEquals("{\"downloads\":[]}", list.body!!.string())
    assertEquals("no-store", list.header("Cache-Control"))
  }

  @Test
  fun servesThePageWithItsSecurityHeaders() {
    val page = client.newCall(Request.Builder().url("$base/").build()).execute()
    assertEquals(200, page.code)
    assertTrue(page.body!!.string().contains("VidoraX"))
    assertTrue(page.header("Content-Security-Policy")!!.contains("frame-ancestors 'none'"))
    assertEquals("DENY", page.header("X-Frame-Options"))
  }

  @Test
  fun refusesAnOversizedBodyWithoutReadingIt() {
    val big = "{\"pin\":\"" + "1".repeat(RemoteRouter.MAX_BODY_BYTES) + "\"}"
    val response = client.newCall(Request.Builder().url("$base/api/v1/pair").post(big.toRequestBody(json)).build()).execute()
    assertEquals(413, response.code)
  }

  @Test
  fun refusesAWrongHostHeader() {
    Socket("127.0.0.1", server.listeningPort).use { socket ->
      socket.getOutputStream().write("GET /api/v1/info HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n".toByteArray())
      val reply = socket.getInputStream().readBytes().toString(Charsets.UTF_8)
      assertTrue(reply, reply.startsWith("HTTP/1.1 421"))
    }
  }

  @Test
  fun downloadsASentFileWithRanges() {
    val video = folder.newFile("clip.mp4").apply { writeBytes(ByteArray(4096) { (it % 251).toByte() }) }
    files["lib"] = SentFile(video, "clip.mp4", "video/mp4")
    val item = sent.add("Clip", null, "lib", 4096)!!
    val pin = auth.newPin()
    val token = JSONObject(
      client.newCall(Request.Builder().url("$base/api/v1/pair").post("""{"pin":"$pin"}""".toRequestBody(json)).build())
        .execute().body!!.string(),
    ).getString("token")
    val href = JSONObject(
      client.newCall(
        Request.Builder().url("$base/api/v1/sent/${item.id}/ticket").header("Authorization", "Bearer $token")
          .post("{}".toRequestBody(json)).build(),
      ).execute().body!!.string(),
    ).getString("href")

    val whole = client.newCall(Request.Builder().url("$base$href").build()).execute()
    assertEquals(200, whole.code)
    assertEquals(4096, whole.body!!.bytes().size)
    assertEquals("bytes", whole.header("Accept-Ranges"))

    val part = client.newCall(Request.Builder().url("$base$href").header("Range", "bytes=1000-1009").build()).execute()
    assertEquals(206, part.code)
    val bytes = part.body!!.bytes()
    assertEquals(10, bytes.size)
    assertEquals((1000 % 251).toByte(), bytes[0])
  }
}
