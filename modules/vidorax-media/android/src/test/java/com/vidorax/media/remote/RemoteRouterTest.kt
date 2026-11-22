package com.vidorax.media.remote

import com.vidorax.media.InvalidStateException
import com.vidorax.media.NotFoundException
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** P6 routing: host/origin checks, token auth, the queue actions, links, the sent list and file tickets. */
class RemoteRouterTest {
  @get:Rule val folder = TemporaryFolder()

  private val host = "192.168.1.20:41234"
  private val auth = RemoteAuth(InMemoryPairedClientStorage())
  private val inbox = LinkInbox(InMemoryPendingLinkStorage())
  private val queue = FakeQueue()
  private var requests = 0
  private val libraryFiles = HashMap<String, SentFile>()
  private val sent = SentList(InMemorySentItemStorage(), resolveFile = { libraryFiles[it] })
  private val router = RemoteRouter(
    auth = auth,
    queue = queue,
    links = inbox,
    sent = sent,
    hosts = RemoteHostPolicy("192.168.1.20", 41234),
    assets = { name -> if (name in RemoteRouter.STATIC_ASSETS) "asset:$name".toByteArray() else null },
    language = { "ur" },
    onRequest = { requests += 1 },
  )

  private class FakeQueue : RemoteQueue {
    val calls = mutableListOf<String>()
    var items = listOf(
      RemoteDownload("d1", "Big Buck Bunny", "downloading", "generic", "360p", 500, 1000, 0.5, 2000, 1, null, 1, 2, listOf("pause", "cancel")),
    )

    override suspend fun list() = items

    override suspend fun pause(id: String) = record("pause:$id")

    override suspend fun resume(id: String) = record("resume:$id")

    override suspend fun retry(id: String) = record("retry:$id")

    override suspend fun cancel(id: String) = record("cancel:$id")

    override suspend fun pauseAll() {
      calls += "pauseAll"
    }

    override suspend fun resumeAll() {
      calls += "resumeAll"
    }

    private fun record(call: String) {
      if (call.endsWith(":missing")) throw NotFoundException("no")
      if (call.endsWith(":done")) throw InvalidStateException("done")
      calls += call
    }
  }

  private fun request(
    method: String,
    path: String,
    body: String? = null,
    token: String? = null,
    headers: Map<String, String> = emptyMap(),
    query: Map<String, String> = emptyMap(),
  ): RemoteResponse = runBlocking {
    val all = HashMap<String, String>()
    all["host"] = host
    if (body != null) all["content-type"] = "application/json"
    if (token != null) all["authorization"] = "Bearer $token"
    headers.forEach { (k, v) -> all[k.lowercase()] = v }
    router.handle(RemoteRequest(method, path, query, all, body?.toByteArray()))
  }

  private fun pair(): String {
    val pin = auth.newPin()
    val response = request("POST", "/api/v1/pair", """{"pin":"$pin","name":"Test"}""")
    assertEquals(200, response.status)
    return JSONObject(response.text()).getString("token")
  }

  private fun json(response: RemoteResponse) = JSONObject(response.text())

  @Test
  fun servesTheWebUiWithoutAToken() {
    val page = request("GET", "/")
    assertEquals(200, page.status)
    assertEquals("asset:index.html", page.text())
    assertTrue(page.headers["Content-Security-Policy"]!!.contains("script-src 'self'"))
    assertEquals("nosniff", page.headers["X-Content-Type-Options"])
    assertEquals(200, request("GET", "/app.mjs").status)
    assertTrue(request("GET", "/app.mjs").contentType.startsWith("text/javascript"))
    assertEquals(404, request("GET", "/../secret").status)
    assertEquals(404, request("GET", "/android/AndroidManifest.xml").status)
  }

  @Test
  fun refusesOtherHostNamesSoDnsRebindingFails() {
    val rebound = request("GET", "/api/v1/info", headers = mapOf("Host" to "evil.example:41234"))
    assertEquals(421, rebound.status)
    val noHost = runBlocking { router.handle(RemoteRequest("GET", "/", headers = emptyMap())) }
    assertEquals(421, noHost.status)
    // The LAN listener does not take loopback names; only the loopback listener does.
    assertEquals(421, request("GET", "/", headers = mapOf("Host" to "localhost:8080")).status)
    assertEquals(0, requests)
  }

  @Test
  fun theLoopbackListenerTakesAnyAdbForwardPort() {
    val policy = RemoteHostPolicy("127.0.0.1", 41234, acceptLoopbackNames = true)
    assertTrue(policy.allowsHost("localhost:8080"))
    assertTrue(policy.allowsHost("127.0.0.1:18080"))
    assertFalse(policy.allowsHost("192.168.1.20:41234"))
    assertFalse(policy.allowsHost("localhost.evil.example:8080"))
  }

  @Test
  fun refusesRequestsFromOtherWebPages() {
    val token = pair()
    val foreign = request(
      "POST",
      "/api/v1/queue/pause-all",
      "{}",
      token,
      headers = mapOf("Origin" to "https://evil.example"),
    )
    assertEquals(403, foreign.status)
    assertEquals("forbidden_origin", json(foreign).getString("error"))
    assertTrue(queue.calls.isEmpty())
    val nullOrigin = request("GET", "/api/v1/downloads", token = token, headers = mapOf("Origin" to "null"))
    assertEquals(403, nullOrigin.status)
  }

  @Test
  fun answersTheWebUiItselfWithoutCors() {
    val token = pair()
    val same = request("GET", "/api/v1/downloads", token = token, headers = mapOf("Origin" to "http://$host"))
    assertEquals(200, same.status)
    assertNull(same.headers["Access-Control-Allow-Origin"])
  }

  @Test
  fun allowsBrowserExtensionsWithCors() {
    val origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    val preflight = request(
      "OPTIONS",
      "/api/v1/downloads",
      headers = mapOf("Origin" to origin, "Access-Control-Request-Private-Network" to "true"),
    )
    assertEquals(204, preflight.status)
    assertEquals(origin, preflight.headers["Access-Control-Allow-Origin"])
    assertEquals("true", preflight.headers["Access-Control-Allow-Private-Network"])
    assertTrue(preflight.headers["Access-Control-Allow-Headers"]!!.contains("Authorization"))
    val token = pair()
    val list = request("GET", "/api/v1/downloads", token = token, headers = mapOf("Origin" to "moz-extension://1234-abcd"))
    assertEquals(200, list.status)
    assertEquals("moz-extension://1234-abcd", list.headers["Access-Control-Allow-Origin"])
    // A preflight from a web page gets nothing.
    assertEquals(403, request("OPTIONS", "/api/v1/downloads", headers = mapOf("Origin" to "https://evil.example")).status)
  }

  @Test
  fun infoIsOpenAndSaysTheLanguage() {
    val info = json(request("GET", "/api/v1/info"))
    assertEquals("VidoraX", info.getString("name"))
    assertEquals(1, info.getInt("api"))
    assertEquals("ur", info.getString("language"))
  }

  @Test
  fun everyOtherApiRouteNeedsAToken() {
    listOf(
      "GET" to "/api/v1/downloads",
      "POST" to "/api/v1/downloads",
      "POST" to "/api/v1/downloads/d1/pause",
      "POST" to "/api/v1/queue/pause-all",
      "GET" to "/api/v1/sent",
      "GET" to "/api/v1/links/abc",
    ).forEach { (method, path) ->
      val body = if (method == "POST") "{}" else null
      assertEquals("$method $path", 401, request(method, path, body).status)
      assertEquals("$method $path", 401, request(method, path, body, token = "x".repeat(43)).status)
    }
    assertTrue(queue.calls.isEmpty())
  }

  @Test
  fun pairingRejectsAWrongPinAndLocks() {
    val pin = auth.newPin()
    val wrong = if (pin == "000000") "111111" else "000000"
    val first = request("POST", "/api/v1/pair", """{"pin":"$wrong"}""")
    assertEquals(401, first.status)
    assertEquals(4, json(first).getInt("attemptsLeft"))
    repeat(3) { request("POST", "/api/v1/pair", """{"pin":"$wrong"}""") }
    val locked = request("POST", "/api/v1/pair", """{"pin":"$wrong"}""")
    assertEquals(429, locked.status)
    assertEquals("30", locked.headers["Retry-After"])
    assertEquals(429, request("POST", "/api/v1/pair", """{"pin":"$pin"}""").status)
    assertEquals(400, request("POST", "/api/v1/pair", """{"pin":"12ab"}""").status)
  }

  @Test
  fun postsMustBeJson() {
    val pin = auth.newPin()
    val form = request("POST", "/api/v1/pair", headers = mapOf("Content-Type" to "text/plain"))
    assertEquals(415, form.status)
    val bad = runBlocking {
      router.handle(
        RemoteRequest("POST", "/api/v1/pair", headers = mapOf("host" to host, "content-type" to "application/json"), body = "not json".toByteArray()),
      )
    }
    assertEquals(400, bad.status)
    assertTrue(auth.pinState().pin == pin)
  }

  @Test
  fun listsTheQueueAsJsonAndTsv() {
    val token = pair()
    val list = json(request("GET", "/api/v1/downloads", token = token))
    val item = list.getJSONArray("downloads").getJSONObject(0)
    assertEquals("d1", item.getString("id"))
    assertEquals(0.5, item.getDouble("fraction"), 0.0)
    assertEquals("pause", item.getJSONArray("actions").getString(0))
    assertFalse(list.toString().contains("http"))
    val tsv = request("GET", "/api/v1/downloads", token = token, query = mapOf("format" to "tsv"))
    assertEquals("ID\tSTATE\tPROGRESS\tTITLE\nd1\tdownloading\t50%\tBig Buck Bunny\n", tsv.text())
  }

  @Test
  fun queueActionsCallTheEngine() {
    val token = pair()
    assertEquals(200, request("POST", "/api/v1/downloads/d1/pause", "{}", token).status)
    assertEquals(200, request("POST", "/api/v1/downloads/d1/resume", "{}", token).status)
    assertEquals(200, request("POST", "/api/v1/downloads/d1/retry", "{}", token).status)
    assertEquals(200, request("POST", "/api/v1/downloads/d1/cancel", "{}", token).status)
    assertEquals(200, request("POST", "/api/v1/queue/pause-all", "{}", token).status)
    assertEquals(200, request("POST", "/api/v1/queue/resume-all", "{}", token).status)
    assertEquals(listOf("pause:d1", "resume:d1", "retry:d1", "cancel:d1", "pauseAll", "resumeAll"), queue.calls)
    assertEquals(404, request("POST", "/api/v1/downloads/missing/pause", "{}", token).status)
    assertEquals(409, request("POST", "/api/v1/downloads/done/pause", "{}", token).status)
    assertEquals(404, request("POST", "/api/v1/downloads/d1/explode", "{}", token).status)
    assertEquals(405, request("GET", "/api/v1/downloads/d1/pause", token = token).status)
  }

  @Test
  fun anAddedLinkWaitsForTheAppAndReportsItsOutcome() {
    val token = pair()
    val url = "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4"
    val added = request("POST", "/api/v1/downloads", """{"url":"$url","source":"cli"}""", token)
    assertEquals(202, added.status)
    val requestId = json(added).getString("requestId")
    assertEquals(LinkRequest.WAITING_FOR_APP, json(added).getString("status"))
    assertEquals(LinkSource.CLI, inbox.pending().single().source)
    inbox.report(requestId, "added", "Big Buck Bunny", "d9", "ENQUEUED")
    val status = json(request("GET", "/api/v1/links/$requestId", token = token))
    assertEquals("added", status.getString("status"))
    assertEquals("d9", status.getString("downloadId"))
    assertEquals(404, request("GET", "/api/v1/links/nope", token = token).status)
  }

  @Test
  fun onlyHttpLinksAreAccepted() {
    val token = pair()
    listOf("javascript:alert(1)", "file:///sdcard/x.mp4", "intent://x", "", "https://", "https://a b.com/x").forEach { url ->
      val body = JSONObject().put("url", url).toString()
      assertEquals(url, 400, request("POST", "/api/v1/downloads", body, token).status)
    }
    val tooLong = JSONObject().put("url", "https://example.com/" + "a".repeat(LinkRules.MAX_URL_LENGTH)).toString()
    assertEquals(400, request("POST", "/api/v1/downloads", tooLong, token).status)
  }

  @Test
  fun unpairForgetsTheCaller() {
    val token = pair()
    assertEquals(200, request("POST", "/api/v1/unpair", "{}", token).status)
    assertEquals(401, request("GET", "/api/v1/downloads", token = token).status)
  }

  @Test
  fun sentFilesAreDownloadedThroughAShortLivedTicket() {
    val token = pair()
    val video = folder.newFile("Big Buck Bunny.mp4").apply { writeBytes(ByteArray(1000) { it.toByte() }) }
    libraryFiles["lib1"] = SentFile(video, video.name, "video/mp4")
    val item = sent.add("Big Buck Bunny", "https://example.com/watch/1", "lib1", 1000)!!
    sent.add("Only a link", "https://example.com/page", null, null)
    val list = json(request("GET", "/api/v1/sent", token = token)).getJSONArray("items")
    assertEquals(2, list.length())
    assertEquals("Only a link", list.getJSONObject(0).getString("title"))
    assertFalse(list.getJSONObject(0).getBoolean("hasFile"))
    assertTrue(list.getJSONObject(1).getBoolean("hasFile"))
    assertFalse(list.toString().contains(video.path))

    val ticket = json(request("POST", "/api/v1/sent/${item.id}/ticket", "{}", token)).getString("href")
    assertTrue(ticket.matches(Regex("^/files/[0-9a-f]{48}/Big%20Buck%20Bunny\\.mp4$")))
    val whole = request("GET", ticket)
    assertEquals(200, whole.status)
    assertEquals("video/mp4", whole.contentType)
    assertTrue(whole.headers["Content-Disposition"]!!.startsWith("attachment;"))
    val body = whole.body as RemoteBody.FileRange
    assertEquals(0L, body.offset)
    assertEquals(1000L, body.length)

    val part = request("GET", ticket, headers = mapOf("Range" to "bytes=100-199"))
    assertEquals(206, part.status)
    assertEquals("bytes 100-199/1000", part.headers["Content-Range"])
    assertEquals(100L, (part.body as RemoteBody.FileRange).length)
    assertEquals(416, request("GET", ticket, headers = mapOf("Range" to "bytes=5000-")).status)

    assertEquals(404, request("GET", "/files/" + "0".repeat(48) + "/x.mp4").status)
    assertEquals(404, request("POST", "/api/v1/sent/${list.getJSONObject(0).getString("id")}/ticket", "{}", token).status)
    assertEquals(200, request("DELETE", "/api/v1/sent/${item.id}", token = token).status)
    assertEquals(404, request("GET", ticket).status)
  }

  @Test
  fun parsesByteRanges() {
    assertEquals(0L..99L, RemoteRouter.parseRange("bytes=0-99", 1000))
    assertEquals(900L..999L, RemoteRouter.parseRange("bytes=900-", 1000))
    assertEquals(900L..999L, RemoteRouter.parseRange("bytes=-100", 1000))
    assertEquals(990L..999L, RemoteRouter.parseRange("bytes=990-5000", 1000))
    assertNull(RemoteRouter.parseRange("bytes=1000-", 1000))
    assertNull(RemoteRouter.parseRange("bytes=5-1", 1000))
    assertNull(RemoteRouter.parseRange("bytes=0-1,5-6", 1000))
    assertNull(RemoteRouter.parseRange("items=0-1", 1000))
  }

  @Test
  fun everyAcceptedRequestCountsForTheIdleTimer() {
    request("GET", "/")
    request("GET", "/api/v1/info")
    assertEquals(2, requests)
  }
}
