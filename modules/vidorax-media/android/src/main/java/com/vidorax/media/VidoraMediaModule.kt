package com.vidorax.media

import android.content.Context
import com.vidorax.media.bridge.DownloadSettingsRecord
import com.vidorax.media.bridge.EnqueueRequestRecord
import com.vidorax.media.bridge.LegacyMetadataRecord
import com.vidorax.media.bridge.LibraryQueryRecord
import com.vidorax.media.bridge.ProbeRequestRecord
import com.vidorax.media.bridge.toJs
import com.vidorax.media.engine.DownloadEngineApi
import com.vidorax.media.engine.DownloadEngineProvider
import com.vidorax.media.player.Volume
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The `VidoraMedia` Expo module; its contract is src/VidoraMedia.types.ts. It only converts arguments, delegates to
 * [MediaServices] and the download engine, and forwards their events. Rejection codes come from MediaErrors.kt.
 */
class VidoraMediaModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private val services: MediaServices get() = MediaServices.get(context)
  private val engine: DownloadEngineApi get() = DownloadEngineProvider.get(context)

  private var volume: Volume? = null

  private fun volume(): Volume = volume ?: Volume(context).also { volume = it }

  override fun definition() = ModuleDefinition {
    Name("VidoraMedia")

    Events(ON_DOWNLOAD_PROGRESS, ON_DOWNLOAD_STATE_CHANGE, ON_LIBRARY_CHANGE, ON_VOLUME_CHANGE)

    OnCreate {
      val media = services
      val downloads = engine
      media.scope.launch { media.legacyImport.run() }
      // This scope ends with the JavaScript runtime, so a reload never leaves a second set of forwarders behind.
      val events = appContext.backgroundCoroutineScope
      events.launch { media.library.changes.collect { sendEvent(ON_LIBRARY_CHANGE, it.toJs()) } }
      events.launch { downloads.progress.collect { sendEvent(ON_DOWNLOAD_PROGRESS, it.toJs()) } }
      events.launch {
        downloads.stateChanges.collect { sendEvent(ON_DOWNLOAD_STATE_CHANGE, mapOf("record" to it.toJs())) }
      }
    }

    OnStartObserving(ON_VOLUME_CHANGE) {
      volume().observe { sendEvent(ON_VOLUME_CHANGE, mapOf("volume" to it)) }
    }

    OnStopObserving(ON_VOLUME_CHANGE) {
      volume?.stopObserving()
    }

    OnDestroy {
      volume?.stopObserving()
    }

    // Probing and downloads

    AsyncFunction("probe") Coroutine { request: ProbeRequestRecord ->
      engine.probe(request.toModel()).toJs()
    }

    AsyncFunction("enqueue") Coroutine { request: EnqueueRequestRecord ->
      engine.enqueue(request.toModel()).toJs()
    }

    AsyncFunction("pause") Coroutine { id: String -> engine.pause(id) }

    AsyncFunction("resume") Coroutine { id: String -> engine.resume(id) }

    AsyncFunction("retry") Coroutine { id: String -> engine.retry(id) }

    AsyncFunction("cancel") Coroutine { id: String -> engine.cancel(id) }

    AsyncFunction("removeDownload") Coroutine { id: String -> engine.removeDownload(id) }

    AsyncFunction("pauseAll") Coroutine { -> engine.pauseAll() }

    AsyncFunction("resumeAll") Coroutine { -> engine.resumeAll() }

    AsyncFunction("listDownloads") Coroutine { ->
      engine.listDownloads().map { it.toJs() }
    }

    AsyncFunction("setDownloadSettings") Coroutine { settings: DownloadSettingsRecord ->
      engine.setDownloadSettings(settings.toModel())
    }

    AsyncFunction("clearTempFiles") Coroutine { -> engine.clearTempFiles() }

    // Library

    AsyncFunction("listLibrary") Coroutine { query: LibraryQueryRecord ->
      services.library.list(query.toModel()).toJs()
    }

    AsyncFunction("getLibraryItem") Coroutine { id: String ->
      services.library.get(id)?.toJs()
    }

    AsyncFunction("getLibraryItems") Coroutine { ids: List<String> ->
      services.library.getMany(ids).map { it.toJs() }
    }

    AsyncFunction("applyLegacyMetadata") Coroutine { entries: List<LegacyMetadataRecord> ->
      val metadata = entries.map { it.toModel() }
      // The import creates the items this metadata describes: wait for it when it is still running.
      services.legacyImport.run()
      services.library.applyLegacyMetadata(metadata)
    }

    AsyncFunction("getAdjacentLibraryItems") Coroutine { id: String, query: LibraryQueryRecord ->
      services.library.adjacent(id, query.toModel()).toJs()
    }

    AsyncFunction("getLibrarySiteCounts") Coroutine { ->
      services.library.siteCounts().map { it.toJs() }
    }

    AsyncFunction("renameLibraryItem") Coroutine { id: String, title: String ->
      services.library.rename(id, title).toJs()
    }

    AsyncFunction("setFavorite") Coroutine { id: String, favorite: Boolean ->
      services.library.setFavorite(id, favorite)
    }

    AsyncFunction("deleteLibraryItems") Coroutine { ids: List<String> ->
      services.library.delete(ids)
    }

    AsyncFunction("saveToGallery") Coroutine { ids: List<String> ->
      services.galleryExport.save(ids)
    }

    AsyncFunction("openWith") Coroutine { id: String ->
      val item = services.library.requireFiles(listOf(id)).single()
      withContext(Dispatchers.Main) { services.fileActions.openWith(appContext.currentActivity, item) }
    }

    AsyncFunction("share") Coroutine { ids: List<String> ->
      if (ids.isEmpty()) throw InvalidRequestException("Nothing to share")
      val items = services.library.requireFiles(ids)
      withContext(Dispatchers.Main) { services.fileActions.share(appContext.currentActivity, items) }
    }

    AsyncFunction("getStorageStats") Coroutine { ->
      services.storageUsage.read().toJs()
    }

    // Player helpers

    Function("getVolume") { volume().get() }

    Function("setVolume") { value: Double -> volume().set(value) }
  }

  private companion object {
    const val ON_DOWNLOAD_PROGRESS = "onDownloadProgress"
    const val ON_DOWNLOAD_STATE_CHANGE = "onDownloadStateChange"
    const val ON_LIBRARY_CHANGE = "onLibraryChange"
    const val ON_VOLUME_CHANGE = "onVolumeChange"
  }
}
