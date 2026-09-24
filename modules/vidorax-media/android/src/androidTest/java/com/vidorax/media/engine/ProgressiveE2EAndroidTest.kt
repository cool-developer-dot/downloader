package com.vidorax.media.engine

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vidorax.media.db.MediaDatabase
import com.vidorax.media.library.LibraryStore
import com.vidorax.media.library.MediaInfo
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.LibraryQuery
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.plan.Probe
import com.vidorax.media.transfer.ProgressiveTransfer
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.runner.RunWith
import org.junit.Test

/**
 * On-device end-to-end validation of the REAL progressive download engine: real OkHttp, real SQLite, real
 * MediaMetadataRetriever, real filesystem, running on the connected Android device against an on-device
 * MockWebServer (127.0.0.1). The engine is assembled from the same production collaborators the module wires,
 * with isolated storage. This is not a JVM/Robolectric test — it runs in an Android instrumentation process.
 */
@RunWith(AndroidJUnit4::class)
class ProgressiveE2EAndroidTest {
  private val context: Context get() = InstrumentationRegistry.getInstrumentation().targetContext

  private lateinit var db: MediaDatabase
  private lateinit var paths: StoragePaths
  private lateinit var library: LibraryStore
  private lateinit var store: SqliteDownloadStore
  private lateinit var http: HttpClient
  private lateinit var scope: CoroutineScope
  private lateinit var server: MockWebServer
  private lateinit var media: ByteArray

  private fun newEngine() = DownloadEngine(
    store = store,
    prober = RealProber(Probe(http)),
    transfers = RealTransfers(ProgressiveTransfer(http)),
    verification = RealVerification,
    inspector = RealMediaInspector(MediaInfo(context)),
    library = RealLibraryWriter(library),
    paths = paths,
    scope = scope,
  )

  @Before fun setUp() = runBlocking {
    media = javaClass.getResourceAsStream("/media/av.mp4")!!.use { it.readBytes() }
    db = MediaDatabase(context)
    // Clean, isolated state for each test.
    db.transaction { it.execSQL("DELETE FROM downloads"); it.execSQL("DELETE FROM library") }
    paths = StoragePaths.from(context)
    listOf(paths.libraryDir, paths.workRoot, paths.thumbnailsDir).forEach { it.deleteRecursively() }
    library = LibraryStore(db, paths)
    store = SqliteDownloadStore(db)
    // The fixture server is on-device loopback; production refuses non-public hosts.
    http = HttpClient.create(urlPolicy = UrlPolicy.ALLOW_ALL)
    scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    server = MockWebServer().apply { dispatcher = MediaDispatcher(media); start() }
  }

  @After fun tearDown() {
    runCatching { server.shutdown() }
    scope.cancel()
    db.close()
  }

  // ---------- fresh MP4 ----------

  @Test fun freshMp4CompletesWithVerifiedFileAndLibraryRow() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/progressive.mp4"))
    engine.awaitIdle()

    val row = store.find(rec.id)!!
    assertEquals(DownloadState.COMPLETED, row.state)
    val item = library.get(rec.id)!!
    assertTrue(item.file.exists())
    assertEquals(media.size.toLong(), item.file.length())
    assertEquals("final file must be byte-identical to source", sha256(media), sha256(item.file.readBytes()))
    assertEquals(Container.MP4, item.container)
    assertFalse("work dir cleaned", paths.workDir(rec.id).exists())
    // No .part masquerading as final.
    assertFalse(File(paths.workDir(rec.id), "download.part").exists())
  }

  // ---------- extensionless ----------

  @Test fun extensionlessProgressiveCompletes() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/extensionless"))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.find(rec.id)!!.state)
    val item = library.get(rec.id)!!
    assertEquals(Container.MP4, item.container)
    assertEquals(sha256(media), sha256(item.file.readBytes()))
  }

  // ---------- pause / resume (206) ----------

  @Test fun pauseThenResume206CompletesOnceWithIntegrity() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/throttle.mp4"))
    pollUntil { store.find(rec.id)?.let { it.state == DownloadState.DOWNLOADING && it.bytesDone in 1 until media.size } == true }
    engine.pause(rec.id)

    val paused = store.find(rec.id)!!
    assertEquals(DownloadState.PAUSED, paused.state)
    val part = File(paths.workDir(rec.id), "download.part")
    assertTrue("partial kept", part.exists() && part.length() in 1 until media.size.toLong())

    engine.resume(rec.id)
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.find(rec.id)!!.state)
    val item = library.get(rec.id)!!
    assertEquals(media.size.toLong(), item.file.length())
    assertEquals("resumed file must be byte-identical to source", sha256(media), sha256(item.file.readBytes()))
    // Exactly one library row.
    assertEquals(1, library.list(LibraryQuery()).items.count { it.id == rec.id })
    // The resume issued a byte-offset Range request that the server answered with 206 + Content-Range.
    val ranged = recordedRequests().mapNotNull { it.getHeader("Range") }.any { it.matches(Regex("bytes=[1-9]\\d*-")) }
    assertTrue("resume must send Range: bytes=<partlen>-", ranged)
  }

  // ---------- server ignores Range on resume → safe restart from zero ----------

  @Test fun rangeIgnored200RestartsFromZeroWithoutCorruption() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/range-ignored"))
    pollUntil { store.find(rec.id)?.let { it.state == DownloadState.DOWNLOADING && it.bytesDone in 1 until media.size } == true }
    engine.pause(rec.id)
    assertTrue(File(paths.workDir(rec.id), "download.part").length() in 1 until media.size.toLong())

    engine.resume(rec.id) // sends Range, but the server answers 200 full — engine must restart, never append
    engine.awaitIdle()

    val item = library.get(rec.id)!!
    assertEquals(DownloadState.COMPLETED, store.find(rec.id)!!.state)
    assertEquals("must be exactly source length, not partial+full", media.size.toLong(), item.file.length())
    assertEquals("no corruption from a 200-over-range", sha256(media), sha256(item.file.readBytes()))
  }

  // ---------- 403 ----------

  @Test fun forbiddenFailsWithoutLibrary() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/forbidden"))
    engine.awaitIdle()

    val row = store.find(rec.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.HTTP_403, row.errorCode)
    assertNull(library.get(rec.id))
  }

  // ---------- transfer completes but Verifier rejects ----------

  @Test fun verifierRejectionYieldsNoCompletedAndNoLibrary() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/verifyfail")) // probe sees valid header; transfer delivers same-length garbage
    engine.awaitIdle()

    val row = store.find(rec.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.PROCESSING_FAILED, row.errorCode)
    assertNull("no library item for an unverified file", library.get(rec.id))
    assertFalse(row.state == DownloadState.COMPLETED)
  }

  // ---------- cancel ----------

  @Test fun cancelStopsWorkerAndLeavesNoLibrary() = runBlocking {
    val engine = newEngine()
    val rec = engine.enqueue(request("/throttle.mp4"))
    pollUntil { store.find(rec.id)?.let { it.state == DownloadState.DOWNLOADING && it.bytesDone > 0 } == true }
    engine.cancel(rec.id)
    engine.awaitIdle()

    assertEquals(DownloadState.CANCELLED, store.find(rec.id)!!.state)
    assertNull(library.get(rec.id))
    assertFalse("temp cleaned on cancel", paths.workDir(rec.id).exists())
  }

  // ---------- process/engine restart recovery from a physical .part ----------

  @Test fun restartRecoveryResumesFromPhysicalPart() = runBlocking {
    val engine1 = newEngine()
    val rec = engine1.enqueue(request("/throttle.mp4"))
    pollUntil { store.find(rec.id)?.let { it.state == DownloadState.DOWNLOADING && it.bytesDone in 1 until media.size } == true }
    engine1.pause(rec.id)
    val partLen = File(paths.workDir(rec.id), "download.part").length()
    assertTrue(partLen in 1 until media.size.toLong())

    // Simulate a process death mid-download: the row was DOWNLOADING with a stale byte counter, no live worker.
    store.save(store.find(rec.id)!!.copy(state = DownloadState.DOWNLOADING, bytesDone = 999_999))

    // A brand-new engine on the same persisted store reconciles and resumes from the physical file.
    val engine2 = newEngine()
    engine2.restore()
    engine2.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.find(rec.id)!!.state)
    val item = library.get(rec.id)!!
    assertEquals(media.size.toLong(), item.file.length())
    assertEquals("recovered file must be byte-identical to source", sha256(media), sha256(item.file.readBytes()))
  }

  // ---------- helpers ----------

  private fun request(path: String, title: String = "Clip", site: SiteId = SiteId.WEB): EnqueueRequest =
    EnqueueRequest(
      url = server.url(path).toString(),
      kind = SourceKind.PROGRESSIVE,
      manifestText = null,
      audioUrl = null,
      variant = null,
      request = RequestContext("VidoraX-E2E", null, null, emptyMap(), useCookies = false),
      title = title,
      site = site,
      pageUrl = null,
      thumbnailUrl = null,
      durationMs = null,
      estimatedBytes = null,
      qualityLabel = null,
      saveToGallery = null,
    )

  private suspend fun pollUntil(timeoutMs: Long = 15_000, predicate: suspend () -> Boolean) {
    withTimeout(timeoutMs) { while (!predicate()) delay(40) }
  }

  private fun recordedRequests(): List<RecordedRequest> =
    buildList { while (true) add(server.takeRequest(100, TimeUnit.MILLISECONDS) ?: break) }

  private fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}

/** Serves the fixture with real Range/ETag semantics plus deliberately misbehaving endpoints. */
private class MediaDispatcher(private val media: ByteArray) : Dispatcher() {
  private val verifyFailCalls = AtomicInteger(0)

  override fun dispatch(request: RecordedRequest): MockResponse {
    val path = request.requestUrl?.encodedPath ?: ""
    val hasRange = request.getHeader("Range") != null
    return when {
      path.startsWith("/forbidden") -> MockResponse().setResponseCode(403)
      path.startsWith("/verifyfail") ->
        if (hasRange) rangeResponse(request, throttle = false) // probe sees a valid header
        else MockResponse().setResponseCode(200).setHeader("Content-Type", "video/mp4")
          .also { verifyFailCalls.incrementAndGet() }
          .setBody(Buffer().write(ByteArray(media.size) { 0x11 })) // transfer delivers same-length garbage
      path.startsWith("/range-ignored") -> ok200(throttle = !hasRange) // always 200 full, ignore Range
      else -> if (hasRange) rangeResponse(request, throttle = false) else ok200(throttle = path.startsWith("/throttle"))
    }
  }

  private fun ok200(throttle: Boolean): MockResponse = MockResponse()
    .setResponseCode(200)
    .setHeader("Content-Type", "video/mp4")
    .setHeader("Accept-Ranges", "bytes")
    .setHeader("ETag", ETAG)
    .setBody(Buffer().write(media))
    .apply { if (throttle) throttleBody(THROTTLE_BYTES, THROTTLE_MS, TimeUnit.MILLISECONDS) }

  private fun rangeResponse(request: RecordedRequest, throttle: Boolean): MockResponse {
    val start = request.getHeader("Range")?.removePrefix("bytes=")?.substringBefore("-")?.toIntOrNull() ?: 0
    if (start <= 0 || start >= media.size) {
      return MockResponse().setResponseCode(206)
        .setHeader("Content-Type", "video/mp4").setHeader("Accept-Ranges", "bytes").setHeader("ETag", ETAG)
        .setHeader("Content-Range", "bytes 0-${media.size - 1}/${media.size}")
        .setBody(Buffer().write(media))
        .apply { if (throttle) throttleBody(THROTTLE_BYTES, THROTTLE_MS, TimeUnit.MILLISECONDS) }
    }
    val body = media.copyOfRange(start, media.size)
    return MockResponse().setResponseCode(206)
      .setHeader("Content-Type", "video/mp4").setHeader("Accept-Ranges", "bytes").setHeader("ETag", ETAG)
      .setHeader("Content-Range", "bytes $start-${media.size - 1}/${media.size}")
      .setBody(Buffer().write(body))
  }

  private companion object {
    const val ETAG = "\"vidorax-e2e-v1\""
    const val THROTTLE_BYTES = 700L
    const val THROTTLE_MS = 120L
  }
}
