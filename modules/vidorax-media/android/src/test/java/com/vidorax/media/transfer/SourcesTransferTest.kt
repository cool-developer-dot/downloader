package com.vidorax.media.transfer

import com.vidorax.media.model.RequestContext
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.MultiNetworkPolicy
import com.vidorax.media.net.UrlPolicy
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * #347 mirrors and #446 a second network: parts spread across checked mirrors and across two HTTP clients, and a
 * mirror that is not the same file, or fails or answers wrong bytes mid-download, is dropped while the main link
 * finishes the file.
 */
class SourcesTransferTest {
  @get:Rule val tmp = TemporaryFolder()

  private val context = RequestContext("VidoraX-Test-UA", null, null, emptyMap(), useCookies = false)
  private val http = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)
  private val servers = ArrayList<MockWebServer>()
  private val noDelay: suspend (Long) -> Unit = {}

  /** One server holding [bytes] with real Range semantics, and the faults a test asks for. */
  private inner class FileServer(var bytes: ByteArray, val etag: String) {
    val requests = CopyOnWriteArrayList<RecordedRequest>()
    /** After the 64 KiB mirror check: every bounded range fails with this status. */
    var failAfterCheck: Int? = null
    /** After the mirror check: claim another total length (a server now serving another file). */
    var wrongTotalAfterCheck = false
    /** Bounded ranges after the check slowed (bytes per 10 ms), so the others still have work when it fails. */
    var throttle: Int? = null
    val checked = AtomicBoolean(false)
    val server = MockWebServer().apply {
      dispatcher = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse = respond(request)
      }
      start()
      servers += this
    }

    fun url(): String = server.url("/video.mp4").toString()

    fun respond(request: RecordedRequest): MockResponse {
      requests += request
      val range = request.getHeader("Range")?.removePrefix("bytes=")
        ?: return MockResponse().setResponseCode(200).setHeader("ETag", etag).setBody(Buffer().write(bytes))
      val start = range.substringBefore('-').toLong()
      val endText = range.substringAfter('-')
      val end = if (endText.isEmpty()) bytes.size - 1L else minOf(endText.toLong(), bytes.size - 1L)
      val isCheck = start == 0L && end == MirrorCheck.CHECK_BYTES - 1L
      if (!isCheck && endText.isNotEmpty() && checked.get()) {
        failAfterCheck?.let { return MockResponse().setResponseCode(it) }
      }
      if (isCheck) checked.set(true)
      val total = if (!isCheck && wrongTotalAfterCheck && checked.get()) bytes.size + 1 else bytes.size
      val response = MockResponse().setResponseCode(206).setHeader("ETag", etag)
        .setHeader("Content-Range", "bytes $start-$end/$total")
        .setBody(Buffer().write(bytes.copyOfRange(start.toInt(), end.toInt() + 1)))
      if (!isCheck) throttle?.let { response.throttleBody(it.toLong(), 10, TimeUnit.MILLISECONDS) }
      return response
    }

    /** Requests for the file's bytes, not the 64 KiB check. */
    fun partRequests(): List<RecordedRequest> = requests.filter {
      val r = it.getHeader("Range") ?: return@filter true
      r != "bytes=0-${MirrorCheck.CHECK_BYTES - 1}"
    }
  }

  @After fun tearDown() {
    servers.forEach { runCatching { it.shutdown() } }
  }

  private fun source(size: Int, salt: Int = 0) = ByteArray(size) { (((it + salt) * 31) xor (it ushr 9)).toByte() }

  private fun part() = File(tmp.root, "download.part")

  private val reports = CopyOnWriteArrayList<RouteReport>()

  private fun spec(main: FileServer, connections: Int, mirrors: List<String> = emptyList(), second: HttpClient? = null) =
    TransferSpec(
      url = main.url(),
      context = context,
      partFile = part(),
      connections = connections,
      mirrors = mirrors,
      secondNetwork = second,
      onRoutes = { reports += it },
    )

  @Test fun anAcceptedMirrorSharesTheParts() = runBlocking {
    val bytes = source(MB17)
    val main = FileServer(bytes, "\"main\"")
    val mirror = FileServer(bytes, "\"mirror-etag\"")

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(main, 2, listOf(mirror.url())))

    assertArrayEquals(bytes, part().readBytes())
    assertTrue("the mirror served parts of the file", mirror.partRequests().isNotEmpty())
    // Each server is asked with its own validator (another host's ETag differs).
    assertTrue(mirror.partRequests().all { it.getHeader("If-Range") == "\"mirror-etag\"" })
    val report = reports.single()
    assertEquals(1, report.mirrorsAccepted)
    assertTrue(report.bytesByRoute.getValue("mirror1") > 0)
    assertEquals(MB17.toLong(), report.bytesByRoute.values.sum())
    assertTrue(report.dropped.isEmpty())
  }

  @Test fun withOneConnectionPerFileAMirrorStillAddsItsOwnConnection() = runBlocking {
    val bytes = source(MB17)
    val main = FileServer(bytes, "\"main\"")
    val mirror = FileServer(bytes, "\"m\"")
    // The main link is slow, so splitting its part for the mirror's connection pays off.
    main.throttle = 64 * 1024

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(main, 1, listOf(mirror.url())))

    assertArrayEquals(bytes, part().readBytes())
    assertTrue(reports.single().bytesByRoute.getValue("mirror1") > 0)
  }

  @Test fun aMirrorWithOtherFirstBytesIsNeverUsed() = runBlocking {
    val bytes = source(MB17)
    val main = FileServer(bytes, "\"main\"")
    // Same length, another file: its first 64 KiB differ.
    val other = FileServer(source(MB17, salt = 7), "\"other\"")

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(main, 3, listOf(other.url())))

    assertArrayEquals(bytes, part().readBytes())
    assertTrue("only the check reached it", other.partRequests().isEmpty())
    assertEquals(0, reports.single().mirrorsAccepted)
    assertEquals(1, reports.single().mirrorsRejected)
  }

  @Test fun aMirrorOfAnotherLengthIsNeverUsed() = runBlocking {
    val bytes = source(MB17)
    val main = FileServer(bytes, "\"main\"")
    // Same first bytes, one byte longer.
    val longer = FileServer(bytes + byteArrayOf(1), "\"longer\"")

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(main, 3, listOf(longer.url())))

    assertArrayEquals(bytes, part().readBytes())
    assertTrue(longer.partRequests().isEmpty())
    assertEquals(1, reports.single().mirrorsRejected)
  }

  @Test fun aMirrorThatFailsIsDroppedAndItsPartsGoBackToTheOthers() = runBlocking {
    val bytes = source(MB17)
    val main = FileServer(bytes, "\"main\"")
    val dying = FileServer(bytes, "\"dying\"")
    dying.failAfterCheck = 503

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(main, 2, listOf(dying.url())))

    assertArrayEquals(bytes, part().readBytes())
    val report = reports.single()
    assertEquals(listOf("mirror1"), report.dropped)
    assertEquals(0L, report.bytesByRoute.getValue("mirror1"))
    assertEquals(MB17.toLong(), report.bytesByRoute.getValue("main"))
  }

  @Test fun aMirrorThatAnswersOtherBytesMidDownloadIsDropped() = runBlocking {
    val bytes = source(MB17)
    val main = FileServer(bytes, "\"main\"")
    val wrong = FileServer(bytes, "\"wrong\"")
    // Passed the check, then claims another file length: those are not this file's bytes.
    wrong.wrongTotalAfterCheck = true

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(main, 2, listOf(wrong.url())))

    assertArrayEquals(bytes, part().readBytes())
    assertEquals(listOf("mirror1"), reports.single().dropped)
  }

  @Test fun theSecondNetworkCarriesSomeParts() = runBlocking {
    val bytes = source(MB17)
    val main = FileServer(bytes, "\"main\"")
    val mobileCalls = AtomicInteger()
    // Stands in for the client bound to mobile data (net/MultiNetwork): same server, its own client.
    val mobile = HttpClient(
      OkHttpClient.Builder()
        .addInterceptor(Interceptor { chain ->
          mobileCalls.incrementAndGet()
          chain.proceed(chain.request().newBuilder().header("X-Network", "mobile").build())
        })
        .build(),
      UrlPolicy.ALLOW_ALL,
    )

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(main, 3, second = mobile))

    assertArrayEquals(bytes, part().readBytes())
    assertTrue("some parts went over the second network", mobileCalls.get() > 0)
    assertTrue(main.requests.any { it.getHeader("X-Network") == "mobile" })
    assertTrue(main.requests.any { it.getHeader("X-Network") == null })
    val report = reports.single()
    assertTrue(report.bytesByRoute.getValue("main+mobile") > 0)
    assertTrue(report.bytesByRoute.getValue("main") > 0)
    // Every byte is the download's own progress, whichever network brought it (it counts toward the data limit).
    assertEquals(MB17.toLong(), report.bytesByRoute.values.sum())
  }

  @Test fun aLostSecondNetworkIsDroppedAndWifiFinishes() = runBlocking {
    val bytes = source(MB17)
    val main = FileServer(bytes, "\"main\"")
    val gone = HttpClient(
      OkHttpClient.Builder()
        .addInterceptor(Interceptor { throw java.io.IOException("network lost") })
        .build(),
      UrlPolicy.ALLOW_ALL,
    )

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(main, 2, second = gone))

    assertArrayEquals(bytes, part().readBytes())
    assertEquals(listOf("main+mobile"), reports.single().dropped)
  }

  @Test fun mirrorsAndTwoNetworksTogether() = runBlocking {
    val bytes = source(MB17)
    val main = FileServer(bytes, "\"main\"")
    val mirror = FileServer(bytes, "\"m\"")
    val mobile = HttpClient(OkHttpClient.Builder().build(), UrlPolicy.ALLOW_ALL)

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(main, 4, listOf(mirror.url()), mobile))

    assertArrayEquals(bytes, part().readBytes())
    assertEquals(setOf("main", "mirror1", "main+mobile", "mirror1+mobile"), reports.single().bytesByRoute.keys)
  }

  @Test fun noRoutesMeansNoReportAndTodaysTransfer() = runBlocking {
    val bytes = source(MB17)
    val main = FileServer(bytes, "\"main\"")

    ProgressiveTransfer(http, retryDelay = noDelay).transfer(spec(main, 3))

    assertArrayEquals(bytes, part().readBytes())
    assertTrue(reports.isEmpty())
  }

  @Test fun theSecondNetworkIsChosenOnlyWhenEveryRuleAllowsIt() {
    // On Wi-Fi, setting on, several connections, mobile data allowed: yes.
    assertTrue(MultiNetworkPolicy.wants(multiNetwork = true, downloadWifiOnly = false, connections = 3, onUnmetered = true))
    // The setting is off by default.
    assertFalse(MultiNetworkPolicy.wants(multiNetwork = false, downloadWifiOnly = false, connections = 3, onUnmetered = true))
    // "Wi-Fi only" (the app's or the download's own) keeps every byte on Wi-Fi.
    assertFalse(MultiNetworkPolicy.wants(multiNetwork = true, downloadWifiOnly = true, connections = 3, onUnmetered = true))
    // One connection: nothing to split across networks.
    assertFalse(MultiNetworkPolicy.wants(multiNetwork = true, downloadWifiOnly = false, connections = 1, onUnmetered = true))
    // Already on mobile data: there is no second network to add.
    assertFalse(MultiNetworkPolicy.wants(multiNetwork = true, downloadWifiOnly = false, connections = 3, onUnmetered = false))
  }

  private companion object {
    const val MB17 = 17 * 1024 * 1024
  }
}
