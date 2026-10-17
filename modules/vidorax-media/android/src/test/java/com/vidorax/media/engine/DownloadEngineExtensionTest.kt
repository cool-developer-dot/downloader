package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.library.galleryMimeType
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * #494 in the engine: the finished file takes the asked-for extension only when it is a safe alias for the container
 * its bytes proved; with no preference (the default) naming is exactly as before.
 */
class DownloadEngineExtensionTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)

  @Before fun setUp() {
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
  }

  @After fun tearDown() { dispatcher.close() }

  private fun engine(
    container: Container,
    extensions: PreferredExtensions = PreferredExtensions(),
    hasVideo: Boolean = true,
  ) = DownloadEngine(
    store = store,
    prober = Prober {
      ProbeResult.Success(SourceKind.PROGRESSIVE, it.url, "video/${container.wire}", container, 1_000, true, emptyList(), emptyList(), null)
    },
    transfers = FakeTransfers { _, spec, onProgress ->
      spec.partFile.parentFile?.mkdirs()
      spec.partFile.writeBytes(ByteArray(1_000))
      onProgress(1_000, 1_000)
      TransferOutcome.Completed(1_000, 1_000, null, spec.url)
    },
    verification = Verification { _, _ -> VerifyResult.Valid },
    inspector = MediaInspector {
      MediaMetadata(1_000, 640, 360, null, hasVideo = hasVideo, hasAudio = true, "video/avc", "audio/mp4a-latm", "video/mp4")
    },
    library = library,
    paths = paths,
    scope = scope,
    preferredExtensions = extensions,
    retryDelay = {},
    idFactory = { "ext-${ids.incrementAndGet()}" },
  )

  private fun request(extension: String?) = EnqueueRequest(
    url = "https://cdn.example/clip",
    kind = SourceKind.PROGRESSIVE,
    manifestText = null,
    audioUrl = null,
    variant = null,
    request = RequestContext(null, null, null, emptyMap(), useCookies = false),
    title = "Clip",
    site = SiteId.WEB,
    pageUrl = null,
    thumbnailUrl = null,
    durationMs = null,
    estimatedBytes = null,
    qualityLabel = null,
    saveToGallery = false,
    preferredExtension = extension,
  )

  private suspend fun fileNameOf(engine: DownloadEngine, extension: String?): String {
    val record = engine.enqueue(request(extension))
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    return library.items[record.id]!!.file.name
  }

  @Test fun withoutAPreferenceAnMp4IsNamedAsToday() = runBlocking {
    assertTrue(fileNameOf(engine(Container.MP4), null).endsWith(".mp4"))
  }

  @Test fun anMp4VideoTakesM4vWhenAskedFor() = runBlocking {
    val name = fileNameOf(engine(Container.MP4), "m4v")
    assertTrue(name, name.endsWith(".m4v"))
  }

  @Test fun aContainerTheAliasDoesNotFitKeepsItsOwnExtension() = runBlocking {
    assertTrue(fileNameOf(engine(Container.WEBM), "m4v").endsWith(".webm"))
    assertTrue(fileNameOf(engine(Container.MOV), "m4v").endsWith(".mov"))
    assertTrue("m4a is not a video", fileNameOf(engine(Container.MP4), "m4a").endsWith(".mp4"))
  }

  @Test fun anUnknownValueFromJavaScriptIsNoPreference() = runBlocking {
    assertTrue(fileNameOf(engine(Container.MP4), "exe").endsWith(".mp4"))
  }

  @Test fun thePreferenceOutlivesARestartOfTheEngine() = runBlocking {
    val storage = PreferredExtensions.Storage.memory()
    val before = PreferredExtensions(storage)
    // Asked for before the restart (the download was created by the previous process).
    before.put("ext-1", "m4v", live = emptyList())
    val name = fileNameOf(engine(Container.MP4, extensions = PreferredExtensions(storage)), null)
    assertTrue(name, name.endsWith(".m4v"))
  }

  @Test fun anM4vGalleryCopyIsPublishedWithTheTypeAndroidPairsWithIt() = runBlocking {
    val name = fileNameOf(engine(Container.MP4), "m4v")
    val item = library.items.values.single { it.file.name == name }
    assertEquals("video/mp4", item.mimeType)
    assertEquals("video/x-m4v", galleryMimeType(item))
    val mp4 = library.items.values.firstOrNull { it.file.name.endsWith(".mp4") }
    if (mp4 != null) assertEquals("video/mp4", galleryMimeType(mp4))
  }
}
