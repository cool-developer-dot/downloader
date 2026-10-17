package com.vidorax.media.engine

import com.vidorax.media.InvalidStateException
import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.ProbeAudioTrack
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.plan.HlsPlan
import com.vidorax.media.plan.HlsPlanResult
import com.vidorax.media.plan.HlsPlannedSegment
import com.vidorax.media.plan.HlsSegmentRef
import com.vidorax.media.transfer.HlsCheckpoint
import com.vidorax.media.transfer.HlsTransferOutcome
import com.vidorax.media.transfer.HlsTransferSpec
import com.vidorax.media.transfer.ResumeValidator
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.io.File
import java.util.Collections
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * H20 Repair Partial File (#412) in the engine: a failed download's partial files are checked (a fake server here) and
 * the download retried from them, from zero, or with its last segment fetched again — and nothing changes when the
 * server cannot be asked. Only work files are touched.
 */
class DownloadEngineRepairTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val library = FakeLibrary()

  /** What the fake server answers to the tail request, and what it sends for a segment. */
  @Volatile private var tail: (start: Long, local: ByteArray, ifRange: String?) -> PartialRepair.TailAnswer =
    { start, _, _ -> PartialRepair.TailAnswer(status = null) }
  @Volatile private var segmentBytes: ByteArray? = null
  private val asked = Collections.synchronizedList(mutableListOf<String>())

  /** The `.part` length each transfer found when it started (0 = from zero). */
  private val resumedFrom = Collections.synchronizedList(mutableListOf<Long>())

  @Before fun setUp() {
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
  }

  @After fun tearDown() = dispatcher.close()

  private val checks = object : PartialChecks {
    override suspend fun tail(url: String, context: RequestContext, start: Long, length: Long, ifRange: String?, local: ByteArray) =
      tail(start, local, ifRange).also { asked += url }

    override suspend fun segment(ref: HlsSegmentRef, context: RequestContext, into: File, maxBytes: Long): Long? {
      asked += ref.url
      val bytes = segmentBytes ?: return null
      into.writeBytes(bytes)
      return bytes.size.toLong()
    }
  }

  private val plan = HlsPlan(
    sourceUrl = "https://cdn.example/s/index.m3u8",
    mediaPlaylistUrl = "https://cdn.example/s/index.m3u8",
    inits = emptyList(),
    segments = (0 until 4).map { HlsPlannedSegment(HlsSegmentRef("https://cdn.example/s/seg$it.ts"), 4_000_000, null) },
    durationUs = 16_000_000,
    selected = null,
    variants = emptyList(),
    containerHint = Container.TS,
    hasDiscontinuities = false,
    fingerprint = "fp",
    estimatedBytes = null,
  )

  private val hls = object : HlsDownloads {
    override suspend fun plan(url: String, context: RequestContext, choice: VariantChoice?): HlsPlanResult = HlsPlanResult.Ready(plan)

    override suspend fun transfer(spec: HlsTransferSpec, onProgress: (Long, Long?) -> Unit): HlsTransferOutcome {
      resumedFrom += HlsCheckpoint.read(spec.checkpointFile)?.partBytes ?: 0L
      error("the transfer itself is not part of this test")
    }
  }

  private fun engine() = DownloadEngine(
    store = store,
    prober = Prober {
      ProbeResult.Success(SourceKind.PROGRESSIVE, it.url, "video/mp4", Container.MP4, 2_000, true, emptyList<com.vidorax.media.model.ProbeVariant>(), emptyList<ProbeAudioTrack>(), null)
    },
    transfers = FakeTransfers { _, spec, _ ->
      resumedFrom += if (spec.partFile.isFile) spec.partFile.length() else 0L
      spec.partFile.parentFile?.mkdirs()
      spec.partFile.writeBytes(ByteArray(2_000))
      TransferOutcome.Completed(2_000, 2_000, null, spec.url)
    },
    verification = Verification { _, _ -> VerifyResult.Valid },
    inspector = MediaInspector {
      MediaMetadata(1_000, 640, 360, null, hasVideo = true, hasAudio = true, "video/avc", "audio/mp4a-latm", "video/mp4")
    },
    library = library,
    paths = paths,
    scope = scope,
    hls = hls,
    retryDelay = {},
    partialChecks = checks,
  )

  /** A failed download with [bytes] of a `.part` (and its validator) in its work folder. */
  private suspend fun failedWithPart(id: String, bytes: ByteArray, kind: SourceKind = SourceKind.PROGRESSIVE): File {
    store.create(
      DownloadRow(
        id = id,
        state = DownloadState.FAILED,
        kind = kind,
        url = "https://cdn.example/v/$id.mp4",
        request = RequestContext(null, null, null, emptyMap(), useCookies = false),
        title = id,
        site = SiteId.WEB,
        pageUrl = null,
        thumbnailUrl = null,
        qualityLabel = null,
        bytesDone = bytes.size.toLong(),
        totalBytes = 2_000,
        errorCode = DownloadErrorCode.NETWORK,
        errorMessage = "Network error",
        attempts = 1,
        saveToGallery = false,
        createdAt = 1,
        updatedAt = 1,
      ),
    )
    val part = File(paths.workDir(id).apply { mkdirs() }, DownloadEngine.PART_NAME)
    part.writeBytes(bytes)
    ResumeValidator.write(part, "\"v1\"")
    return part
  }

  @Test fun aPartialThatChecksOutIsResumedFromWhereItStopped() = runBlocking {
    val engine = engine()
    failedWithPart("a", ByteArray(1_200) { 7 })
    tail = { start, _, ifRange ->
      assertEquals("the resume validator is replayed", "\"v1\"", ifRange)
      PartialRepair.TailAnswer(206, start, 2_000, "\"v1\"", bytesMatch = true)
    }

    assertEquals(RepairOutcome.RESUMED, engine.repairPartial("a"))
    engine.awaitIdle()
    assertEquals(listOf(1_200L), resumedFrom.toList())
    assertEquals(DownloadState.COMPLETED, store.current("a")!!.state)
    assertEquals(listOf("https://cdn.example/v/a.mp4"), asked.toList())
  }

  @Test fun aChangedFileRestartsCleanlyFromZero() = runBlocking {
    val engine = engine()
    val part = failedWithPart("b", ByteArray(1_200) { 7 })
    tail = { _, _, _ -> PartialRepair.TailAnswer(200) }

    assertEquals(RepairOutcome.RESTARTED_CHANGED, engine.repairPartial("b"))
    engine.awaitIdle()
    assertEquals(listOf(0L), resumedFrom.toList())
    assertFalse("its validator went with it", ResumeValidator.fileFor(part).exists())
    assertEquals(DownloadState.COMPLETED, store.current("b")!!.state)
  }

  @Test fun aDamagedPartialRestartsCleanlyFromZero() = runBlocking {
    val engine = engine()
    failedWithPart("c", ByteArray(1_200) { 7 })
    tail = { start, _, _ -> PartialRepair.TailAnswer(206, start, 2_000, "\"v1\"", bytesMatch = false) }

    assertEquals(RepairOutcome.RESTARTED_CORRUPT, engine.repairPartial("c"))
    engine.awaitIdle()
    assertEquals(listOf(0L), resumedFrom.toList())
  }

  @Test fun anUnreachableServerChangesNothing() = runBlocking {
    val engine = engine()
    val part = failedWithPart("d", ByteArray(1_200) { 7 })
    tail = { _, _, _ -> PartialRepair.TailAnswer(status = null) }

    assertEquals(RepairOutcome.UNREACHABLE, engine.repairPartial("d"))
    engine.awaitIdle()
    assertEquals(DownloadState.FAILED, store.current("d")!!.state)
    assertEquals(1_200L, part.length())
    assertTrue(resumedFrom.isEmpty())
  }

  @Test fun aDamagedLastSegmentIsFetchedAgainAndTheRestIsKept() = runBlocking {
    val engine = engine()
    val good = ByteArray(1_000) { 1 }
    val damaged = ByteArray(1_000) { 2 }
    val part = failedWithPart("h", good + good + damaged, kind = SourceKind.HLS)
    HlsCheckpoint.write(File(paths.workDir("h"), DownloadEngine.HLS_CHECKPOINT_NAME), HlsCheckpoint("fp", 3, 3_000, null, Container.TS))
    segmentBytes = ByteArray(1_000) { 3 } // what the server really has for segment 2

    assertEquals(RepairOutcome.SEGMENT_REFETCHED, engine.repairPartial("h"))
    engine.awaitIdle()
    assertEquals("asked for the last checkpointed segment", listOf("https://cdn.example/s/seg2.ts"), asked.toList())
    assertEquals("Retry resumes before the damaged segment", listOf(2_000L), resumedFrom.toList())
    assertEquals(3_000L, part.length())
  }

  @Test fun anIntactLastSegmentResumes() = runBlocking {
    val engine = engine()
    val seg = ByteArray(1_000) { 1 }
    failedWithPart("i", seg + seg, kind = SourceKind.HLS)
    HlsCheckpoint.write(File(paths.workDir("i"), DownloadEngine.HLS_CHECKPOINT_NAME), HlsCheckpoint("fp", 2, 2_000, null, Container.TS))
    segmentBytes = seg

    assertEquals(RepairOutcome.RESUMED, engine.repairPartial("i"))
    engine.awaitIdle()
    assertEquals(listOf(2_000L), resumedFrom.toList())
  }

  @Test fun aFinishedFileIsNeverTouched() = runBlocking {
    val engine = engine()
    failedWithPart("f", ByteArray(1_200) { 7 })
    // A failed download can still name a finished file (a duplicate, a crash after the move).
    val finished = File(paths.filesDir, "library/web/finished.mp4").apply { parentFile?.mkdirs(); writeBytes(ByteArray(2_000) { 9 }) }
    store.save(store.current("f")!!.copy(filePath = paths.toStoredPath(finished)))
    tail = { _, _, _ -> PartialRepair.TailAnswer(200) }

    engine.repairPartial("f")
    engine.awaitIdle()
    assertTrue(finished.exists())
    assertArrayEquals(ByteArray(2_000) { 9 }, finished.readBytes())
  }

  @Test fun onlyAFailedDownloadCanBeRepairedAndWithoutAPartialThereIsNothingToDo() = runBlocking {
    val engine = engine()
    failedWithPart("g", ByteArray(0))
    assertEquals(RepairOutcome.NOTHING, engine.repairPartial("g"))
    assertEquals(DownloadState.FAILED, store.current("g")!!.state)

    store.save(store.current("g")!!.copy(state = DownloadState.PAUSED))
    assertThrows(InvalidStateException::class.java) { runBlocking { engine.repairPartial("g") } }
  }

  @Test fun theRepairInfoCountsWhatIsOnDisk() = runBlocking {
    failedWithPart("x", ByteArray(1_234))
    assertEquals(1_234L, PartialRepair.partialBytes(paths.workDir("x")))
    assertEquals(0L, PartialRepair.partialBytes(paths.workDir("nobody")))
  }
}
