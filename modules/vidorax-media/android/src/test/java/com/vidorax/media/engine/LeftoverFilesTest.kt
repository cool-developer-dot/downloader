package com.vidorax.media.engine

import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.verify.VerifyResult
import java.io.File
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * F15: what counts as leftover download files, and that a clean-up never touches files a download still needs.
 */
class LeftoverFilesTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()

  @Before fun setUp() {
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
  }

  @After fun tearDown() { dispatcher.close() }

  private fun write(file: File, size: Int): File {
    file.parentFile?.mkdirs()
    file.writeBytes(ByteArray(size))
    return file
  }

  // ---------- the scanner ----------

  @Test fun anOrphanWorkFolderWithItsPerPartFilesAndALooseFileAreLeftovers() {
    write(File(paths.workRoot, "orphan/download.part"), 1000)
    write(File(paths.workRoot, "orphan/download.part.parts"), 50) // F1's per-part checkpoint
    write(File(paths.workRoot, "orphan/segments/00001.ts"), 200)
    write(File(paths.workRoot, "kept/download.part"), 500)
    write(File(paths.workRoot, "stray.tmp"), 10)
    val leftovers = LeftoverFiles(paths)

    val roots = leftovers.find(keepWorkNames = setOf("kept"), keepLegacyIds = null)
    assertEquals(listOf("orphan", "stray.tmp"), roots.map { it.name })
    assertEquals(LeftoverSummary(4, 1260), leftovers.measure(roots))
    assertTrue("measuring deletes nothing", File(paths.workRoot, "orphan/download.part").exists())

    assertEquals(LeftoverSummary(4, 1260), leftovers.delete(roots))
    assertFalse(File(paths.workRoot, "orphan").exists())
    assertFalse(File(paths.workRoot, "stray.tmp").exists())
    assertEquals(500, File(paths.workRoot, "kept/download.part").length())
    assertEquals(LeftoverSummary.NONE, leftovers.measure(leftovers.find(setOf("kept"), null)))
  }

  @Test fun v1FoldersLoseOnlyTheTemporaryPartsOfDownloadsNoLongerActive() {
    val legacy = paths.legacyDownloadsDir
    write(File(legacy, "v1-done/clip.mp4"), 3000) // a finished v1 video: a library file
    write(File(legacy, "v1-done/.hls/seg-1.ts"), 100)
    write(File(legacy, "v1-done/.mranges/part-0"), 70)
    write(File(legacy, "v1-done/other.mp4.part"), 40)
    write(File(legacy, "v1-active/.mranges/part-0"), 80) // a v1 download still in use
    write(File(legacy, "v1-active/video.mp4.part"), 90)
    val leftovers = LeftoverFiles(paths)

    val roots = leftovers.find(keepWorkNames = emptySet(), keepLegacyIds = setOf("v1-active"))
    assertEquals(listOf(".hls", ".mranges", "other.mp4.part"), roots.map { it.name })
    assertEquals(LeftoverSummary(3, 210), leftovers.delete(roots))
    assertEquals(3000, File(legacy, "v1-done/clip.mp4").length())
    assertTrue(File(legacy, "v1-active/.mranges/part-0").exists())
    assertTrue(File(legacy, "v1-active/video.mp4.part").exists())

    // Without the list of active v1 downloads, v1 folders are not looked at at all.
    write(File(legacy, "v1-done/.hls/seg-2.ts"), 100)
    assertEquals(LeftoverSummary.NONE, leftovers.measure(leftovers.find(emptySet(), keepLegacyIds = null)))
  }

  // ---------- the engine's keep rule ----------

  @Test fun theEngineKeepsEveryDownloadThatMayStillUseItsFilesAndCleansTheRest() = runBlocking {
    val kept = listOf(
      DownloadState.QUEUED, DownloadState.PROBING, DownloadState.DOWNLOADING, DownloadState.PAUSED,
      DownloadState.WAITING_NETWORK, DownloadState.WAITING_RETRY, DownloadState.PROCESSING, DownloadState.FAILED,
    )
    val gone = listOf(DownloadState.COMPLETED, DownloadState.CANCELLED)
    (kept + gone).forEach { state ->
      store.create(row(state.wire, state))
      write(File(paths.workDir(state.wire), "download.part"), 100)
    }
    write(File(paths.workRoot, "no-such-download/download.part"), 300)
    val engine = engine()

    assertEquals(LeftoverSummary(3, 500), engine.measureLeftovers(keepLegacyIds = null))
    assertEquals(LeftoverSummary(3, 500), engine.cleanLeftovers(keepLegacyIds = null))
    kept.forEach { assertTrue("${it.wire} keeps its part", File(paths.workDir(it.wire), "download.part").exists()) }
    gone.forEach { assertFalse("${it.wire} is a leftover", paths.workDir(it.wire).exists()) }
    assertFalse(File(paths.workRoot, "no-such-download").exists())
    assertEquals(LeftoverSummary.NONE, engine.measureLeftovers(keepLegacyIds = null))
  }

  @Test fun clearTempFilesFollowsTheSameRuleAndLeavesV1FoldersAlone() = runBlocking {
    store.create(row("paused", DownloadState.PAUSED))
    write(File(paths.workDir("paused"), "download.part"), 100)
    write(File(paths.workRoot, "orphan/download.part"), 250)
    write(File(paths.legacyDownloadsDir, "v1/.hls/seg.ts"), 60)

    assertEquals(250L, engine().clearTempFiles())
    assertTrue(File(paths.workDir("paused"), "download.part").exists())
    assertTrue(File(paths.legacyDownloadsDir, "v1/.hls/seg.ts").exists())
  }

  private fun engine() = DownloadEngine(
    store = store,
    prober = Prober { error("no download runs in these tests") },
    transfers = FakeTransfers { _, _, _ -> error("no download runs in these tests") },
    verification = Verification { _, _ -> VerifyResult.Valid },
    inspector = MediaInspector { error("no download runs in these tests") },
    library = FakeLibrary(),
    paths = paths,
    scope = scope,
    retryDelay = {},
  )

  private fun row(id: String, state: DownloadState) = DownloadRow(
    id = id,
    state = state,
    kind = SourceKind.PROGRESSIVE,
    url = "https://cdn.example/$id.mp4",
    request = RequestContext(null, null, null, emptyMap(), useCookies = false),
    title = "Clip $id",
    site = SiteId.WEB,
    pageUrl = null,
    thumbnailUrl = null,
    qualityLabel = null,
    bytesDone = 0,
    totalBytes = 1000,
    errorCode = null,
    errorMessage = null,
    attempts = 0,
    saveToGallery = null,
    createdAt = System.currentTimeMillis(),
    updatedAt = System.currentTimeMillis(),
  )
}
