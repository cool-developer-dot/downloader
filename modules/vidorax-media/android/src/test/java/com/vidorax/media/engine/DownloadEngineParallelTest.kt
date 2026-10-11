package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.transfer.PartWriter
import com.vidorax.media.transfer.PartsCheckpoint
import com.vidorax.media.transfer.ProgressiveTransfer
import com.vidorax.media.transfer.StorageWriteException
import com.vidorax.media.verify.VerifyResult
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * "Connections per file" through the engine: the setting reaches the transfer and changes how many connections a
 * file uses; progress, pause, restart, cancel and a full disk behave as for one connection.
 */
class DownloadEngineParallelTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private lateinit var server: MockWebServer
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)
  private val requests = CopyOnWriteArrayList<RecordedRequest>()
  private val http = HttpClient.create(cookies = { null }, urlPolicy = UrlPolicy.ALLOW_ALL)
  private val bytes = ByteArray(SIZE) { ((it * 7) xor (it ushr 11)).toByte() }
  @Volatile private var throttle: Int? = null

  @Before fun setUp() {
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
    server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        requests += request
        val range = request.getHeader("Range")?.removePrefix("bytes=")
          ?: return MockResponse().setHeader("ETag", "\"e\"").setBody(Buffer().write(bytes))
        val start = range.substringBefore('-').toInt()
        val end = range.substringAfter('-').takeIf { it.isNotEmpty() }?.toInt() ?: (SIZE - 1)
        return MockResponse().setResponseCode(206).setHeader("ETag", "\"e\"")
          .setHeader("Content-Range", "bytes $start-$end/$SIZE")
          .setBody(Buffer().write(bytes.copyOfRange(start, end + 1)))
          .apply { throttle?.let { throttleBody(it.toLong(), 10, TimeUnit.MILLISECONDS) } }
      }
    }
    server.start()
  }

  @After fun tearDown() {
    runCatching { server.shutdown() }
    dispatcher.close()
  }

  private fun engine(
    settings: DownloadSettings = DownloadSettings.DEFAULT,
    writerFor: (File) -> PartWriter = PartWriter.FILE,
  ) = DownloadEngine(
    store = store,
    prober = Prober {
      ProbeResult.Success(
        kind = SourceKind.PROGRESSIVE, finalUrl = server.url("/big.mp4").toString(), contentType = "video/mp4",
        container = Container.MP4, sizeBytes = SIZE.toLong(), resumable = true, variants = emptyList(),
        audioTracks = emptyList(), durationMs = null,
      )
    },
    transfers = RealTransfers(ProgressiveTransfer(http, writerFor = writerFor, retryDelay = {})),
    verification = { _, _ -> VerifyResult.Valid },
    inspector = MediaInspector {
      MediaMetadata(
        durationMs = 10_000, width = 1920, height = 1080, bitrate = null, hasVideo = true, hasAudio = true,
        videoCodec = "video/avc", audioCodec = "audio/mp4a-latm", containerMimeType = "video/mp4",
      )
    },
    library = library,
    paths = paths,
    scope = scope,
    initialSettings = settings,
    retryDelay = {},
    idFactory = { "par-${ids.incrementAndGet()}" },
  )

  private fun request() = EnqueueRequest(
    url = server.url("/big.mp4").toString(), kind = SourceKind.PROGRESSIVE, manifestText = null, audioUrl = null,
    variant = null, request = RequestContext("UA", null, null, emptyMap(), useCookies = false), title = "Big",
    site = SiteId.WEB, pageUrl = null, thumbnailUrl = null, durationMs = null, estimatedBytes = null,
    qualityLabel = null, saveToGallery = null,
  )

  private fun sha256(data: ByteArray) = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

  private fun rangedRequests() = requests.count { it.getHeader("Range") != null }

  private suspend fun waitFor(timeoutMs: Long = 20_000, predicate: suspend () -> Boolean) {
    withTimeout(timeoutMs) { while (!predicate()) delay(20) }
  }

  @Test fun theSettingDecidesHowManyConnectionsAFileUses() = runBlocking {
    val single = engine(DownloadSettings.DEFAULT.copy(connectionsPerFile = 1))
    val first = single.enqueue(request())
    single.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(first.id)!!.state)
    assertEquals("one plain request", listOf<String?>(null), requests.map { it.getHeader("Range") })
    assertEquals(sha256(bytes), sha256(library.items[first.id]!!.file.readBytes()))

    requests.clear()
    library.items.clear()
    single.setDownloadSettings(DownloadSettings.DEFAULT.copy(connectionsPerFile = 3))
    // The same video again would be a duplicate: a second file of the same bytes elsewhere.
    val second = single.enqueue(request().copy(url = server.url("/big.mp4?copy=2").toString()))
    single.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(second.id)!!.state)
    assertTrue("bytes=0- and the other parts as ranges: ${requests.map { it.getHeader("Range") }}", rangedRequests() >= 3)
    assertEquals(sha256(bytes), sha256(library.items[second.id]!!.file.readBytes()))
  }

  @Test fun progressIsTheCombinedBytesOfAllPartsAndEndsAtTheTotal() = runBlocking {
    val engine = engine(DownloadSettings.DEFAULT.copy(connectionsPerFile = 4))
    val events = CopyOnWriteArrayList<DownloadProgress>()
    val collector = launch { engine.progress.collect { events += it } }
    val record = engine.enqueue(request())
    engine.awaitIdle()
    collector.cancel()

    val download = events.filter { it.id == record.id }
    assertTrue(download.isNotEmpty())
    assertEquals(SIZE.toLong(), download.last().bytesDone)
    assertEquals(SIZE.toLong(), download.last().totalBytes)
    assertEquals("never backwards", download.map { it.bytesDone }, download.map { it.bytesDone }.sorted())
  }

  @Test fun aPausedParallelDownloadKeepsItsRealBytesAcrossARestartAndCompletes() = runBlocking {
    throttle = 32 * 1024
    val first = engine()
    val record = first.enqueue(request())
    val part = File(paths.workDir(record.id), DownloadEngine.PART_NAME)
    waitFor { (PartsCheckpoint.read(part)?.bytesDone ?: 0) > 1024 * 1024 }
    first.pause(record.id)
    val onDisk = PartsCheckpoint.read(part)!!.bytesDone
    assertEquals("pre-sized to the whole file", SIZE.toLong(), part.length())

    // A new process: the row's byte count is whatever was persisted last; restore() trusts the disk.
    store.save(store.current(record.id)!!.copy(bytesDone = 1))
    throttle = null
    val second = engine()
    second.restore()
    assertEquals(DownloadState.PAUSED, store.current(record.id)!!.state)
    assertEquals("the parts' bytes, not the pre-sized file's length", onDisk, store.current(record.id)!!.bytesDone)

    second.resume(record.id)
    second.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals(sha256(bytes), sha256(library.items[record.id]!!.file.readBytes()))
  }

  @Test fun cancelRemovesThePartAndItsCheckpoint() = runBlocking {
    throttle = 16 * 1024
    val engine = engine()
    val record = engine.enqueue(request())
    val part = File(paths.workDir(record.id), DownloadEngine.PART_NAME)
    waitFor { PartsCheckpoint.read(part) != null }

    engine.cancel(record.id)

    assertEquals(DownloadState.CANCELLED, store.current(record.id)!!.state)
    assertFalse(paths.workDir(record.id).exists())
    assertTrue(library.items.isEmpty())
  }

  @Test fun aDiskThatFillsUpMidWriteFailsAsNoSpace() = runBlocking {
    val written = AtomicLong()
    val engine = engine(
      writerFor = { file ->
        val real = PartWriter.FILE(file)
        object : PartWriter by real {
          override fun write(position: Long, bytes: ByteArray, offset: Int, length: Int) {
            if (written.addAndGet(length.toLong()) > 4L * 1024 * 1024) {
              throw StorageWriteException(IOException("write failed: ENOSPC (No space left on device)"))
            }
            real.write(position, bytes, offset, length)
          }
        }
      },
    )
    val record = engine.enqueue(request())
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.NO_SPACE, row.errorCode)
    assertTrue("the written parts stay for a retry once there is room", (PartsCheckpoint.read(File(paths.workDir(record.id), DownloadEngine.PART_NAME))?.bytesDone ?: 0) > 0)
  }

  private companion object {
    const val SIZE = 18 * 1024 * 1024 + 7
  }
}
