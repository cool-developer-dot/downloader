package com.vidorax.media

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.vidorax.media.bridge.DownloadBandwidthRecord
import com.vidorax.media.bridge.DownloadSettingsRecord
import com.vidorax.media.bridge.EnqueueRequestRecord
import com.vidorax.media.bridge.LeftoverFilesRecord
import com.vidorax.media.bridge.LegacyMetadataRecord
import com.vidorax.media.bridge.LibraryQueryRecord
import com.vidorax.media.bridge.PageFetchRequestRecord
import com.vidorax.media.bridge.ProbeRequestRecord
import com.vidorax.media.bridge.toJs
import com.vidorax.media.bridge.toSourceJs
import com.vidorax.media.engine.DownloadEngineApi
import com.vidorax.media.engine.DownloadEngineProvider
import com.vidorax.media.incoming.IncomingMedia
import com.vidorax.media.incoming.IncomingMediaIntents
import com.vidorax.media.incoming.IncomingMediaReader
import com.vidorax.media.library.DeviceVideos
import com.vidorax.media.player.ActivityVisibility
import com.vidorax.media.player.PictureInPictureAutoEnter
import com.vidorax.media.player.Volume
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicReference

/**
 * The `VidoraMedia` Expo module; its contract is src/VidoraMedia.types.ts. It only converts arguments, delegates to
 * [MediaServices] and the download engine, and forwards their events. Rejection codes come from MediaErrors.kt.
 */
class VidoraMediaModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private val services: MediaServices get() = MediaServices.get(context)
  private val engine: DownloadEngineApi get() = DownloadEngineProvider.get(context)
  private val deviceVideos: DeviceVideos get() = DeviceVideos(context)

  private var volume: Volume? = null

  private fun volume(): Volume = volume ?: Volume(context).also { volume = it }

  private val pictureInPicture = PictureInPictureAutoEnter()

  private val mainHandler = Handler(Looper.getMainLooper())

  @Volatile private var hasIncomingMediaListeners = false

  // A file that arrived while JavaScript did not listen, handed out by consumeIncomingMedia.
  private val unclaimedIncomingMedia = AtomicReference<IncomingMedia?>(null)

  private fun takeIncomingMedia(intent: android.content.Intent?): IncomingMedia? =
    IncomingMediaReader(context.contentResolver).take(intent)?.also { services.incomingMedia.put(it) }

  private fun incomingMediaFor(token: String): IncomingMedia {
    if (!IncomingMediaIntents.isToken(token)) throw InvalidRequestException("Not an incoming file token")
    return services.incomingMedia.get(token) ?: throw NotFoundException("The file is no longer available")
  }

  private val activityVisibility = ActivityVisibility { inPictureInPicture ->
    sendEvent(ON_ACTIVITY_STOP, mapOf("inPictureInPicture" to inPictureInPicture))
  }

  override fun definition() = ModuleDefinition {
    Name("VidoraMedia")

    Events(
      ON_DOWNLOAD_PROGRESS,
      ON_DOWNLOAD_STATE_CHANGE,
      ON_LIBRARY_CHANGE,
      ON_VOLUME_CHANGE,
      ON_ACTIVITY_STOP,
      ON_INCOMING_MEDIA,
    )

    OnCreate {
      val media = services
      val downloads = engine
      media.scope.launch {
        media.legacyImport.run()
        // Files removed or moved outside VidoraX since the last run: their rows must not look playable.
        runCatching { media.library.removeMissingFiles() }
      }
      // This scope ends with the JavaScript runtime, so a reload never leaves a second set of forwarders behind.
      val events = appContext.backgroundCoroutineScope
      events.launch { media.library.changes.collect { sendEvent(ON_LIBRARY_CHANGE, it.toJs()) } }
      events.launch { downloads.progress.collect { sendEvent(ON_DOWNLOAD_PROGRESS, it.toJs()) } }
      events.launch {
        downloads.stateChanges.collect { sendEvent(ON_DOWNLOAD_STATE_CHANGE, mapOf("record" to it.toJs())) }
      }
      mainHandler.post { activityVisibility.attach(appContext.currentActivity) }
    }

    // Lifecycle observers are main-thread only; this callback can also run while the module is created from JS.
    OnActivityEntersForeground {
      mainHandler.post { activityVisibility.attach(appContext.currentActivity) }
    }

    OnStartObserving(ON_VOLUME_CHANGE) {
      volume().observe { sendEvent(ON_VOLUME_CHANGE, mapOf("volume" to it)) }
    }

    OnStopObserving(ON_VOLUME_CHANGE) {
      volume?.stopObserving()
    }

    OnStartObserving(ON_INCOMING_MEDIA) { hasIncomingMediaListeners = true }

    OnStopObserving(ON_INCOMING_MEDIA) { hasIncomingMediaListeners = false }

    // "Open with VidoraX" while the app runs (singleTask): the file goes to JavaScript as a token.
    OnNewIntent { intent ->
      val media = takeIncomingMedia(intent) ?: return@OnNewIntent
      if (hasIncomingMediaListeners) {
        sendEvent(ON_INCOMING_MEDIA, media.toJs())
      } else {
        unclaimedIncomingMedia.set(media)
      }
    }

    OnDestroy {
      volume?.stopObserving()
      mainHandler.post { activityVisibility.detach() }
    }

    // Home / Recents while a video plays: Android 8–11 need PiP requested right here (see PictureInPictureAutoEnter).
    OnUserLeavesActivity {
      appContext.currentActivity?.let { pictureInPicture.onUserLeaveHint(it) }
    }

    // Probing and downloads

    AsyncFunction("probe") Coroutine { request: ProbeRequestRecord ->
      engine.probe(request.toModel()).toJs()
    }

    // A pasted/shared link read the way its tab would navigate to it, before the WebView plays anything. Returns the
    // page's bytes (bounded) or says the link is media itself; nothing on the page is executed.
    AsyncFunction("fetchPage") Coroutine { request: PageFetchRequestRecord ->
      val model = request.toModel()
      withContext(Dispatchers.IO) { services.pageFetcher.fetch(model) }.toJs()
    }

    AsyncFunction("enqueue") Coroutine { request: EnqueueRequestRecord ->
      engine.enqueue(request.toModel()).toJs()
    }

    // One download per video: an existing download or saved copy of the same video is returned instead
    AsyncFunction("enqueueUnique") Coroutine { request: EnqueueRequestRecord ->
      engine.enqueueUnique(request.toModel()).toJs()
    }

    AsyncFunction("findDuplicate") Coroutine { request: EnqueueRequestRecord ->
      engine.findDuplicate(request.toModel())?.toJs()
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

    AsyncFunction("measureLeftoverFiles") Coroutine { options: LeftoverFilesRecord? ->
      engine.measureLeftovers((options ?: LeftoverFilesRecord()).keep()).toJs()
    }

    AsyncFunction("cleanLeftoverFiles") Coroutine { options: LeftoverFilesRecord? ->
      engine.cleanLeftovers((options ?: LeftoverFilesRecord()).keep()).toJs()
    }

    AsyncFunction("setDownloadBandwidth") Coroutine { id: String, options: DownloadBandwidthRecord ->
      engine.setDownloadBandwidth(id, options.limit(), options.priority == true).map { it.toJs() }
    }

    AsyncFunction("setDownloadStartAt") Coroutine { id: String, startAt: Double? ->
      val at = startAt?.takeIf { !it.isNaN() && it > 0 }?.toLong()
      engine.setDownloadStartAt(id, at).toJs()
    }

    AsyncFunction("stopRecording") Coroutine { id: String ->
      engine.stopRecording(id).toJs()
    }

    AsyncFunction("listDownloadBandwidth") Coroutine { ->
      engine.listDownloadBandwidth().map { it.toJs() }
    }

    // Completions for JavaScript to count once (the in-app review), including ones that happened while it was not running

    AsyncFunction("listCompletedDownloads") Coroutine { ->
      engine.listCompletions().map { mapOf("id" to it.downloadId, "completedAt" to it.completedAt.toDouble()) }
    }

    AsyncFunction("acknowledgeCompletedDownloads") Coroutine { ids: List<String> ->
      engine.acknowledgeCompletions(ids.take(MAX_ACKNOWLEDGE_IDS))
    }

    // Videos already on the device (read-only; empty until the user grants the media permission)

    AsyncFunction("listDeviceVideos") Coroutine { limit: Int, offset: Int ->
      val videos = withContext(Dispatchers.IO) { deviceVideos.list(limit.coerceIn(1, 500), maxOf(offset, 0)) }
      mapOf(
        "permissionGranted" to deviceVideos.hasPermission(),
        "access" to deviceVideos.access().name.lowercase(),
        "items" to videos.map { video ->
          mapOf(
            "id" to video.id,
            "uri" to video.uri,
            "title" to video.title,
            "durationMs" to video.durationMs,
            "sizeBytes" to video.sizeBytes,
            "width" to video.width,
            "height" to video.height,
            "addedAt" to video.addedAt,
            "mimeType" to video.mimeType,
          )
        },
      )
    }

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

    AsyncFunction("reconcileLibrary") Coroutine { ids: List<String>? ->
      services.library.removeMissingFiles(ids)
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

    // Files opened from other apps

    Function("consumeIncomingMedia") {
      (unclaimedIncomingMedia.getAndSet(null) ?: takeIncomingMedia(appContext.currentActivity?.intent))?.toJs()
    }

    Function("getIncomingMediaSource") { token: String ->
      if (!IncomingMediaIntents.isToken(token)) null else services.incomingMedia.get(token)?.toSourceJs()
    }

    AsyncFunction("importIncomingMedia") Coroutine { token: String ->
      services.incomingImport.import(incomingMediaFor(token)).toJs()
    }

    AsyncFunction("openIncomingWith") Coroutine { token: String ->
      val media = incomingMediaFor(token)
      withContext(Dispatchers.Main) {
        services.fileActions.openIncomingWith(appContext.currentActivity, media.uri, media.mimeType, media.displayName)
      }
    }

    // Player helpers

    Function("getVolume") { volume().get() }

    Function("setVolume") { value: Double -> volume().set(value) }

    Function("setPictureInPictureAutoEnter") { armed: Boolean, aspectWidth: Int, aspectHeight: Int ->
      pictureInPicture.arm(armed, aspectWidth, aspectHeight)
    }
  }

  private companion object {
    const val ON_DOWNLOAD_PROGRESS = "onDownloadProgress"
    const val ON_DOWNLOAD_STATE_CHANGE = "onDownloadStateChange"
    const val ON_LIBRARY_CHANGE = "onLibraryChange"
    const val ON_VOLUME_CHANGE = "onVolumeChange"
    const val ON_ACTIVITY_STOP = "onActivityStop"
    const val ON_INCOMING_MEDIA = "onIncomingMedia"
    const val MAX_ACKNOWLEDGE_IDS = 1_000
  }
}
