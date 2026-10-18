package com.vidorax.media.engine

import com.vidorax.media.InvalidRequestException
import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * H4 in the engine: which waiting download gets the next slot. Nothing set is today's first-come order; the user's
 * order and queues decide otherwise; a held queue's downloads wait, even for a free slot, until it is resumed.
 */
class DownloadEngineQueueOrderTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)

  /** Transfers in the order they started (by title), and a gate per title the test opens. */
  private val started = Collections.synchronizedList(mutableListOf<String>())
  private val gates = ConcurrentHashMap<String, CompletableDeferred<Unit>>()

  @Before fun setUp() {
    // One worker thread: workers reach the slot line in the order they were started, as on a quiet device.
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
  }

  @After fun tearDown() { dispatcher.close() }

  private fun gate(title: String) = gates.getOrPut(title) { CompletableDeferred() }

  /** Each transfer waits for its title's gate; the URL carries the title. */
  private val transfers = FakeTransfers { _, spec, onProgress ->
    val title = spec.url.substringAfterLast("/")
    started += title
    gate(title).await()
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(ByteArray(100))
    onProgress(100, 100)
    TransferOutcome.Completed(100, 100, null, spec.url)
  }

  private suspend fun waitFor(timeoutMs: Long = 3_000, predicate: suspend () -> Boolean) {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      if (predicate()) return
      delay(10)
    }
    throw AssertionError("condition not reached within ${timeoutMs}ms")
  }

  /** Lets queued workers reach the slot line (they read the row and check the network first). */
  private suspend fun settle() = delay(150)

  private suspend fun DownloadEngine.start(title: String): String = enqueue(request(title)).id

  private suspend fun finish(title: String) {
    gate(title).complete(Unit)
  }

  @Test fun withNothingSetTheNextSlotGoesFirstComeAsToday() = runBlocking {
    val engine = engine()
    engine.start("a")
    waitFor { started == listOf("a") }
    engine.start("b")
    engine.start("c")
    engine.start("d")
    settle()
    finish("a")
    waitFor { started.size == 2 }
    finish("b")
    waitFor { started.size == 3 }
    finish("c")
    waitFor { started.size == 4 }
    finish("d")
    engine.awaitIdle()
    assertEquals(listOf("a", "b", "c", "d"), started.toList())
    assertTrue(engine.downloadQueues().isDefault)
  }

  @Test fun theUsersOrderDecidesWhichWaitingDownloadStartsNext() = runBlocking {
    val engine = engine()
    engine.start("a")
    waitFor { started == listOf("a") }
    val b = engine.start("b")
    val c = engine.start("c")
    val d = engine.start("d")
    settle()
    engine.setDownloadOrder(listOf(d, b))
    for (title in listOf("a", "d", "b")) {
      finish(title)
      waitFor { started.size == listOf("a", "d", "b", "c").indexOf(title) + 2 }
    }
    finish("c")
    engine.awaitIdle()
    assertEquals(listOf("a", "d", "b", "c"), started.toList())
    assertFalse("finished downloads leave the order", engine.downloadQueues().order.any { it in setOf(b, c, d) })
  }

  @Test fun queuesRunInTheirOrderAndAHeldQueueWaitsUntilResumed() = runBlocking {
    val engine = engine()
    engine.start("a")
    waitFor { started == listOf("a") }
    val b = engine.start("b")
    val c = engine.start("c")
    settle()
    engine.setDownloadQueues(listOf(DownloadQueue(QueueOrder.MAIN_ID, "Main"), DownloadQueue("night", "Night", held = true)))
    engine.moveDownloadsToQueue(listOf(b), "night")
    assertTrue(engine.isQueueHeld(b))
    finish("a")
    waitFor { started == listOf("a", "c") }
    finish("c")
    waitFor { store.current(c)?.state == DownloadState.COMPLETED }
    settle()
    assertEquals("a free slot, but b's queue is held", listOf("a", "c"), started.toList())
    assertEquals(DownloadState.QUEUED, store.current(b)!!.state)

    engine.setDownloadQueues(listOf(DownloadQueue(QueueOrder.MAIN_ID, "Main"), DownloadQueue("night", "Night", held = false)))
    waitFor { started == listOf("a", "c", "b") }
    finish("b")
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(b)!!.state)
  }

  @Test fun aQueueListedFirstStartsBeforeMain() = runBlocking {
    val engine = engine()
    engine.start("a")
    waitFor { started == listOf("a") }
    engine.start("b")
    val c = engine.start("c")
    settle()
    engine.setDownloadQueues(listOf(DownloadQueue("first", "First"), DownloadQueue(QueueOrder.MAIN_ID, "Main")))
    engine.moveDownloadsToQueue(listOf(c), "first")
    finish("a")
    waitFor { started.size == 2 }
    assertEquals("c", started[1])
    finish("c")
    waitFor { started.size == 3 }
    finish("b")
    engine.awaitIdle()
  }

  @Test fun deletingAHeldQueueSendsItsDownloadsToMainAndStartsThem() = runBlocking {
    val engine = engine()
    engine.setDownloadQueues(listOf(DownloadQueue(QueueOrder.MAIN_ID, "Main"), DownloadQueue("later", "Later", held = true)))
    val a = engine.start("a")
    waitFor { started == listOf("a") }
    val b = engine.start("b")
    settle()
    engine.moveDownloadsToQueue(listOf(b), "later")
    finish("a")
    waitFor { store.current(a)?.state == DownloadState.COMPLETED }
    settle()
    assertEquals(listOf("a"), started.toList())
    assertEquals(DownloadState.QUEUED, store.current(b)!!.state)
    engine.setDownloadQueues(listOf(DownloadQueue(QueueOrder.MAIN_ID, "Main")))
    waitFor { started == listOf("a", "b") }
    assertEquals(QueueOrder.MAIN_ID, engine.downloadQueues().queueOf(b))
    finish("b")
    engine.awaitIdle()
  }

  @Test fun holdingAndResumingAQueueAnnouncesItsWaitingDownloadsAgainWithoutChangingThem() = runBlocking {
    val engine = engine()
    engine.start("a")
    waitFor { started == listOf("a") }
    val b = engine.start("b")
    settle()
    engine.setDownloadQueues(listOf(DownloadQueue(QueueOrder.MAIN_ID, "Main"), DownloadQueue("q", "Q")))
    engine.moveDownloadsToQueue(listOf(b), "q")
    val events = Collections.synchronizedList(mutableListOf<DownloadRecord>())
    val collector = scope.launch { engine.stateChanges.collect { events += it } }
    settle()
    engine.setDownloadQueues(listOf(DownloadQueue(QueueOrder.MAIN_ID, "Main"), DownloadQueue("q", "Q", held = true)))
    waitFor { events.any { it.id == b } }
    assertTrue(events.filter { it.id == b }.all { it.state == DownloadState.QUEUED })
    assertTrue(engine.isQueueHeld(b))
    collector.cancel()
    finish("a")
    finish("b")
    engine.setDownloadQueues(listOf(DownloadQueue(QueueOrder.MAIN_ID, "Main")))
    engine.awaitIdle()
  }

  @Test fun anInvalidQueueChangeIsRefusedAndChangesNothing() = runBlocking {
    val engine = engine()
    assertThrows(InvalidRequestException::class.java) {
      runBlocking { engine.moveDownloadsToQueue(listOf("x"), "missing") }
    }
    assertThrows(InvalidRequestException::class.java) {
      runBlocking { engine.setDownloadQueues(listOf(DownloadQueue("bad id", "x"))) }
    }
    assertTrue(engine.downloadQueues().isDefault)
  }

  @Test fun afterARestartInterruptedDownloadsStartInTheUsersOrder() = runBlocking {
    // A previous process left three queued downloads (newest first in the table) and an order: c, a, b.
    val ts = System.currentTimeMillis()
    for ((index, title) in listOf("a", "b", "c").withIndex()) {
      store.create(row("old-$title", title, createdAt = ts + index))
    }
    val book = QueueOrderBook(memoryStorage(QueueOrder.encode(QueueOrder.withOrder(QueueOrderSnapshot.DEFAULT, listOf("old-c", "old-a", "old-b")))))
    val engine = engine(book = book)
    engine.restore()
    waitFor { started.size == 1 }
    for (title in listOf("c", "a")) {
      finish(title)
      waitFor { started.size == listOf("c", "a", "b").indexOf(title) + 2 }
    }
    finish("b")
    engine.awaitIdle()
    assertEquals(listOf("c", "a", "b"), started.toList())
  }

  @Test fun afterARestartWithNothingSetTheOrderIsTodays() = runBlocking {
    val ts = System.currentTimeMillis()
    for ((index, title) in listOf("a", "b", "c").withIndex()) {
      store.create(row("old-$title", title, createdAt = ts + index))
    }
    val engine = engine()
    engine.restore()
    waitFor { started.size == 1 }
    // Today: rows are restored newest first, so the newest takes the first slot.
    assertEquals("c", started[0])
    listOf("a", "b", "c").forEach { gate(it).complete(Unit) }
    engine.awaitIdle()
  }

  @Test fun pausedDownloadsKeepTheirPlaceAndResumeAllFollowsTheOrder() = runBlocking {
    val engine = engine()
    engine.start("a")
    waitFor { started == listOf("a") }
    val b = engine.start("b")
    val c = engine.start("c")
    settle()
    engine.setDownloadOrder(listOf(c, b))
    engine.pauseAll()
    assertEquals(DownloadState.PAUSED, store.current(b)!!.state)
    assertEquals(listOf(c, b), engine.downloadQueues().order.filter { it == b || it == c })
    started.clear()
    gates.clear()
    engine.resumeAll()
    waitFor { started.size == 1 }
    assertTrue("a resumes first or c does: c is ordered before b", started[0] == "a" || started[0] == "c")
    listOf("a", "b", "c").forEach { gate(it).complete(Unit) }
    engine.awaitIdle()
    assertTrue("b never jumps the order: c starts before b", started.indexOf("c") < started.indexOf("b"))
  }

  @Test fun aCancelledOrRemovedDownloadLeavesTheOrder() = runBlocking {
    val engine = engine()
    engine.start("a")
    waitFor { started == listOf("a") }
    val b = engine.start("b")
    val c = engine.start("c")
    settle()
    engine.setDownloadOrder(listOf(c, b))
    engine.cancel(b)
    waitFor { b !in engine.downloadQueues().order }
    engine.removeDownload(b)
    assertFalse(b in engine.downloadQueues().order)
    finish("a")
    finish("c")
    engine.awaitIdle()
  }

  @Test fun noSlotIsLostWhenDownloadsArePausedAndResumedWhileWaiting() = runBlocking {
    // Stress: pause and resume waiting downloads over and over while slots move between them. A slot handed to a
    // download just as it is paused must go on to the next one, or the queue would stall for good.
    val fast = FakeTransfers { _, spec, onProgress ->
      started += spec.url.substringAfterLast("/")
      delay(2)
      spec.partFile.parentFile?.mkdirs()
      spec.partFile.writeBytes(ByteArray(100))
      onProgress(100, 100)
      TransferOutcome.Completed(100, 100, null, spec.url)
    }
    val stress = engine(transfers = fast)
    val idsOf = (1..6).map { stress.start("s$it") }
    val random = java.util.Random(7)
    repeat(40) {
      val id = idsOf[random.nextInt(idsOf.size)]
      runCatching { stress.pause(id) }
      delay(random.nextInt(3).toLong())
      runCatching { stress.resume(id) }
    }
    withTimeout(10_000) {
      while (idsOf.any { store.current(it)?.state != DownloadState.COMPLETED }) {
        stress.resumeAll()
        delay(20)
      }
    }
    assertTrue(idsOf.all { store.current(it)!!.state == DownloadState.COMPLETED })
    stress.awaitIdle()
  }

  // --- harness ---

  private fun memoryStorage(initial: String?) = object : QueueOrderBook.Storage {
    @Volatile var value = initial

    override fun read(): String? = value

    override fun write(json: String?) {
      value = json
    }
  }

  private fun engine(
    book: QueueOrderBook = QueueOrderBook(),
    transfers: Transfers = this.transfers,
  ): DownloadEngine = DownloadEngine(
    store = store,
    prober = Prober {
      ProbeResult.Success(
        kind = SourceKind.PROGRESSIVE,
        finalUrl = it.url,
        contentType = "video/mp4",
        container = Container.MP4,
        sizeBytes = 100,
        resumable = true,
        variants = emptyList(),
        audioTracks = emptyList(),
        durationMs = null,
      )
    },
    transfers = transfers,
    verification = Verification { _, _ -> VerifyResult.Valid },
    inspector = MediaInspector {
      MediaMetadata(1_000, 640, 360, null, hasVideo = true, hasAudio = true, "video/avc", "audio/mp4a-latm", "video/mp4")
    },
    library = library,
    paths = paths,
    scope = scope,
    initialSettings = DownloadSettings.DEFAULT.copy(maxConcurrent = 1),
    queueOrder = book,
    retryDelay = {},
    idFactory = { "dl-${ids.incrementAndGet()}" },
  )

  private fun request(title: String) = EnqueueRequest(
    url = "https://cdn.example/v/$title",
    kind = SourceKind.PROGRESSIVE,
    manifestText = null,
    audioUrl = null,
    variant = null,
    request = RequestContext(null, null, null, emptyMap(), useCookies = false),
    title = title,
    site = SiteId.WEB,
    pageUrl = null,
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = false,
  )

  private fun row(id: String, title: String, createdAt: Long) = DownloadRow(
    id = id,
    state = DownloadState.QUEUED,
    kind = SourceKind.PROGRESSIVE,
    url = "https://cdn.example/v/$title",
    request = RequestContext(null, null, null, emptyMap(), useCookies = false),
    title = title,
    site = SiteId.WEB,
    pageUrl = null,
    thumbnailUrl = null,
    qualityLabel = null,
    bytesDone = 0,
    totalBytes = null,
    errorCode = null,
    errorMessage = null,
    attempts = 0,
    saveToGallery = false,
    createdAt = createdAt,
    updatedAt = createdAt,
  )
}
