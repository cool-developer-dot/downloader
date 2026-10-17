package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.BasicCredentials
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.DownloadCredentials
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * #299 in the engine: a download enqueued with sign-in hands it to net/DownloadCredentials, every request of the
 * download is keyed to it (never stored), a 401 is reported as AUTH_REQUIRED, and the credentials go as it stops.
 */
class DownloadEngineAuthTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)
  private val flags = DownloadCredentials.Flags.memory()

  /** The authKey and the Authorization the HTTP client would add, for every probe and transfer request. */
  private val seenKeys = Collections.synchronizedList(mutableListOf<String?>())
  private val seenAuthorization = Collections.synchronizedList(mutableListOf<String?>())

  @Volatile private var unauthorized = false

  @Before fun setUp() {
    dispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
    DownloadCredentials.resetForTests(flags)
  }

  @After fun tearDown() {
    dispatcher.close()
    DownloadCredentials.resetForTests()
  }

  private fun note(context: RequestContext, url: String) {
    seenKeys += context.authKey
    seenAuthorization += DownloadCredentials.authorizationFor(context.authKey, url.toHttpUrl())
  }

  private fun engine(): DownloadEngine = DownloadEngine(
    store = store,
    prober = Prober {
      note(it.request, it.url)
      if (unauthorized) {
        ProbeResult.Failure(ProbeFailure.HTTP_403, 401, "Access denied")
      } else {
        ProbeResult.Success(SourceKind.PROGRESSIVE, it.url, "video/mp4", Container.MP4, 100, true, emptyList(), emptyList(), null)
      }
    },
    transfers = FakeTransfers { _, spec, onProgress ->
      note(spec.context, spec.url)
      spec.partFile.parentFile?.mkdirs()
      spec.partFile.writeBytes(ByteArray(100))
      onProgress(100, 100)
      TransferOutcome.Completed(100, 100, null, spec.url)
    },
    verification = Verification { _, _ -> VerifyResult.Valid },
    inspector = MediaInspector {
      MediaMetadata(1_000, 640, 360, null, hasVideo = true, hasAudio = true, "video/avc", "audio/mp4a-latm", "video/mp4")
    },
    library = library,
    paths = paths,
    scope = scope,
    retryDelay = {},
    idFactory = { "auth-${ids.incrementAndGet()}" },
  ).also { DownloadCredentials.install(flags, it.stateChanges, scope) }

  private fun request(url: String, credentials: BasicCredentials? = null) = EnqueueRequest(
    url = url,
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
    credentials = credentials,
    qualityLabel = null,
    saveToGallery = false,
  )

  private suspend fun settle(predicate: () -> Boolean) = withTimeout(3_000) { while (!predicate()) delay(10) }

  @Test fun everyRequestOfASignedInDownloadIsKeyedToItAndTheKeyIsNeverStored() = runBlocking {
    val engine = engine()
    delay(50) // the cleanup collector subscribes
    val record = engine.enqueue(request("https://nas.example.com/clip.mp4", BasicCredentials("alice", "pw")))
    engine.awaitIdle()

    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertTrue(seenKeys.isNotEmpty())
    assertTrue("probe and transfer are keyed to the download", seenKeys.all { it == record.id })
    assertTrue("and the client would sign them in", seenAuthorization.all { it != null })
    assertNull("the stored request has no key", store.current(record.id)!!.request.authKey)
    assertFalse(RequestContextJson.encode(store.current(record.id)!!.request.copy(authKey = "x")).contains("\"x\""))

    // Completed: the credentials and the mark are gone.
    settle { !DownloadCredentials.has(record.id) }
    assertFalse(DownloadCredentials.usesSignIn(record.id))
  }

  @Test fun aSignedInDownloadRefusedWith401NeedsTheCredentialsAgain() = runBlocking {
    val engine = engine()
    delay(50)
    unauthorized = true
    val record = engine.enqueue(request("https://nas.example.com/clip.mp4", BasicCredentials("alice", "wrong")))
    engine.awaitIdle()

    val row = store.current(record.id)!!
    assertEquals(DownloadState.FAILED, row.state)
    assertEquals(DownloadErrorCode.AUTH_REQUIRED, row.errorCode)
    settle { !DownloadCredentials.has(record.id) }
    // Retry asks again, for the origin the download was started with.
    assertNotNull(DownloadCredentials.neededFor(record.id))
    assertEquals("https://nas.example.com:443", DownloadCredentials.neededFor(record.id)!!.origin)
  }

  @Test fun aDownloadWithoutSignInRefusedWith401FailsAsToday() = runBlocking {
    val engine = engine()
    unauthorized = true
    val record = engine.enqueue(request("https://nas.example.com/clip.mp4"))
    engine.awaitIdle()

    assertEquals(DownloadErrorCode.HTTP_403, store.current(record.id)!!.errorCode)
    assertNull(DownloadCredentials.neededFor(record.id))
    assertTrue("keyed, but there is nothing to send", seenAuthorization.all { it == null })
  }

  @Test fun credentialsForAnHttpLinkAreNeverKept() = runBlocking {
    val engine = engine()
    val record = engine.enqueue(request("http://nas.example.com/clip.mp4", BasicCredentials("alice", "pw")))
    engine.awaitIdle()

    assertFalse(DownloadCredentials.has(record.id))
    assertFalse(DownloadCredentials.usesSignIn(record.id))
    assertTrue(seenAuthorization.all { it == null })
  }

  @Test fun cancellingForgetsThemAtOnce() = runBlocking {
    val engine = engine()
    delay(50)
    val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
    val slow = DownloadEngine(
      store = store,
      prober = Prober {
        gate.await()
        ProbeResult.Failure(ProbeFailure.NETWORK, null, "never")
      },
      transfers = FakeTransfers { _, _, _ -> error("not reached") },
      verification = Verification { _, _ -> VerifyResult.Valid },
      inspector = MediaInspector {
        MediaMetadata(1_000, 640, 360, null, hasVideo = true, hasAudio = true, "video/avc", "audio/mp4a-latm", "video/mp4")
      },
      library = library,
      paths = paths,
      scope = scope,
      retryDelay = {},
      idFactory = { "slow-${ids.incrementAndGet()}" },
    ).also { DownloadCredentials.install(flags, it.stateChanges, scope) }
    delay(50)
    val record = slow.enqueue(request("https://nas.example.com/clip.mp4", BasicCredentials("alice", "pw")))
    assertTrue(DownloadCredentials.has(record.id))
    slow.cancel(record.id)
    settle { !DownloadCredentials.has(record.id) }
    assertFalse(DownloadCredentials.usesSignIn(record.id))
    gate.complete(Unit)
    slow.awaitIdle()
    engine.awaitIdle()
  }
}
