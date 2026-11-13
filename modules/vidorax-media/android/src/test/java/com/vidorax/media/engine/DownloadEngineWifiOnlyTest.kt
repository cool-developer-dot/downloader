package com.vidorax.media.engine

import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.StoragePaths
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SiteId
import com.vidorax.media.model.SourceKind
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.verify.VerifyResult
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * #480 in the engine: a download's own "Wi-Fi only" decides which network it waits for and keeps to; a download that
 * asked nothing follows Download Settings exactly as before.
 */
class DownloadEngineWifiOnlyTest {
  @get:Rule val tmp = TemporaryFolder()

  private lateinit var dispatcher: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var paths: StoragePaths
  private val store = RecordingStore()
  private val library = FakeLibrary()
  private val ids = AtomicInteger(0)

  @Before fun setUp() {
    dispatcher = Executors.newFixedThreadPool(4).asCoroutineDispatcher()
    scope = CoroutineScope(dispatcher)
    paths = StoragePaths(tmp.newFolder("files"), tmp.newFolder("nobackup"))
  }

  @After fun tearDown() { dispatcher.close() }

  /** A phone on Wi-Fi or on mobile data: under "Wi-Fi only" only Wi-Fi is usable, otherwise both are. */
  private class PhoneNetwork(onWifi: Boolean) : NetworkGate {
    val onWifi = MutableStateFlow(onWifi)

    override fun isUsable(wifiOnly: Boolean): Boolean = !wifiOnly || onWifi.value

    override suspend fun awaitUsable(wifiOnly: Boolean) {
      onWifi.first { !wifiOnly || it }
    }

    override suspend fun awaitUnusable(wifiOnly: Boolean) {
      if (!wifiOnly) kotlinx.coroutines.awaitCancellation()
      onWifi.first { !it }
    }
  }

  private fun engine(
    network: NetworkGate,
    settingWifiOnly: Boolean,
    transfers: Transfers = writeAll(),
    choices: NetworkChoices = NetworkChoices(),
  ) = DownloadEngine(
    store = store,
    prober = Prober {
      ProbeResult.Success(SourceKind.PROGRESSIVE, it.url, "video/mp4", Container.MP4, 1_000, true, emptyList(), emptyList(), null)
    },
    transfers = transfers,
    verification = Verification { _, _ -> VerifyResult.Valid },
    inspector = MediaInspector {
      MediaMetadata(1_000, 640, 360, null, hasVideo = true, hasAudio = true, "video/avc", "audio/mp4a-latm", "video/mp4")
    },
    library = library,
    paths = paths,
    scope = scope,
    network = network,
    initialSettings = DownloadSettings.DEFAULT.copy(wifiOnly = settingWifiOnly),
    networkChoices = choices,
    retryDelay = {},
    idFactory = { "wifi-${ids.incrementAndGet()}" },
  )

  private fun writeAll() = FakeTransfers { _, spec, onProgress ->
    spec.partFile.parentFile?.mkdirs()
    spec.partFile.writeBytes(ByteArray(1_000))
    onProgress(1_000, 1_000)
    TransferOutcome.Completed(1_000, 1_000, null, spec.url)
  }

  private fun request(wifiOnly: Boolean?) = EnqueueRequest(
    url = "https://cdn.example/clip.mp4",
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
    wifiOnly = wifiOnly,
  )

  private suspend fun waitFor(predicate: suspend () -> Boolean) {
    withTimeout(15_000) { while (!predicate()) delay(20) }
  }

  @Test fun aDownloadAllowedOnMobileDataRunsAlthoughTheSettingIsWifiOnly() = runBlocking {
    val engine = engine(PhoneNetwork(onWifi = false), settingWifiOnly = true)
    val record = engine.enqueue(request(wifiOnly = false))
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
  }

  @Test fun aDownloadAskingForWifiWaitsAlthoughTheSettingAllowsMobileData() = runBlocking {
    val phone = PhoneNetwork(onWifi = false)
    val engine = engine(phone, settingWifiOnly = false)
    val record = engine.enqueue(request(wifiOnly = true))
    waitFor { store.current(record.id)?.state == DownloadState.WAITING_NETWORK }

    phone.onWifi.value = true
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
  }

  @Test fun withoutItsOwnChoiceTheSettingDecidesAsBefore() = runBlocking {
    val phone = PhoneNetwork(onWifi = false)
    val engine = engine(phone, settingWifiOnly = true)
    val held = engine.enqueue(request(wifiOnly = null))
    waitFor { store.current(held.id)?.state == DownloadState.WAITING_NETWORK }
    phone.onWifi.value = true
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(held.id)!!.state)

    val free = engine(PhoneNetwork(onWifi = false), settingWifiOnly = false).let { other ->
      other.enqueue(request(wifiOnly = null)).also { other.awaitIdle() }
    }
    assertEquals(DownloadState.COMPLETED, store.current(free.id)!!.state)
  }

  @Test fun aRunningWifiOnlyDownloadStopsWhenWifiGoesEvenIfTheSettingAllowsMobileData() = runBlocking {
    val phone = PhoneNetwork(onWifi = true)
    val started = CompletableDeferred<Unit>()
    val resumedFrom = java.util.Collections.synchronizedList(mutableListOf<Long>())
    val engine = engine(
      phone,
      settingWifiOnly = false,
      transfers = FakeTransfers { call, spec, onProgress ->
        spec.partFile.parentFile?.mkdirs()
        resumedFrom.add(if (spec.partFile.isFile) spec.partFile.length() else 0L)
        if (call == 0) {
          spec.partFile.writeBytes(ByteArray(400))
          onProgress(400, 1_000)
          started.complete(Unit)
          kotlinx.coroutines.awaitCancellation()
        }
        spec.partFile.writeBytes(ByteArray(1_000))
        onProgress(1_000, 1_000)
        TransferOutcome.Completed(1_000, 1_000, null, spec.url)
      },
    )
    val record = engine.enqueue(request(wifiOnly = true))
    started.await()

    phone.onWifi.value = false // mobile data only: this download may not use it
    waitFor { store.current(record.id)?.state == DownloadState.WAITING_NETWORK }
    assertEquals("the partial file is kept", 400L, File(paths.workDir(record.id), "download.part").length())

    phone.onWifi.value = true
    engine.awaitIdle()
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
    assertEquals(listOf(0L, 400L), resumedFrom.toList())
  }

  @Test fun theChoiceOutlivesARestartOfTheEngine() = runBlocking {
    val storage = NetworkChoices.Storage.memory()
    // Chosen before the restart (the previous process created the download).
    NetworkChoices(storage).put("wifi-1", false, live = emptyList())
    val engine = engine(PhoneNetwork(onWifi = false), settingWifiOnly = true, choices = NetworkChoices(storage))
    val record = engine.enqueue(request(wifiOnly = null))
    engine.awaitIdle()
    assertEquals("wifi-1", record.id)
    assertEquals(DownloadState.COMPLETED, store.current(record.id)!!.state)
  }
}
