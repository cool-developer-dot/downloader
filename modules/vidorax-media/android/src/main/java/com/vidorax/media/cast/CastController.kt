package com.vidorax.media.cast

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.MediaTrack
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** What JavaScript asks to show on the TV (`castLoad`). */
data class CastLoadRecord(
  /** The URI the Player plays: `file://` / `content://` (served by [CastFileServer]) or an `http(s)://` stream. */
  @Field val uri: String = "",
  @Field val contentType: String? = null,
  @Field val title: String = "",
  @Field val positionMs: Double = 0.0,
  @Field val autoplay: Boolean = true,
  /** The chosen subtitle file, already converted to WebVTT in JavaScript; null for none. */
  @Field val subtitleVtt: String? = null,
  @Field val subtitleLanguage: String? = null,
  @Field val subtitleLabel: String? = null,
) : Record

/** Events for JavaScript ([VidoraCastModule] turns them into `onCast…` events). */
interface CastEvents {
  fun devices(devices: List<Map<String, Any?>>)
  fun connected(deviceName: String)
  fun disconnected(reason: String, positionMs: Long?, finished: Boolean)
  fun position(positionMs: Long, durationMs: Long?)
  fun state(state: String, positionMs: Long?, durationMs: Long?, volume: Double?)
  fun error(code: String, message: String)
}

/**
 * P13 #667 Chromecast, the native side. Main thread only (the Cast SDK and MediaRouter require it).
 *
 * - **Discovery:** MediaRouter looks for Cast devices only between [startDiscovery] and [stopDiscovery], which the Player
 *   screen calls when it opens and closes.
 * - **Session:** [connect] selects the device's route; the Cast SDK then starts a session with Google's Default Media
 *   Receiver ([CastOptionsProvider]). [stop] ends it and stops the TV.
 * - **Media:** [load] serves a local file with [CastServing] (only now, only this file, random tokens) and loads its URL
 *   (plus subtitles as WebVTT) with RemoteMediaClient; an online stream the receiver can open directly goes by its own
 *   URL. Play, pause, seek, stop and the TV's volume go through RemoteMediaClient / the session.
 * - **Ending:** a session that ends or drops, and [release] (the app's JavaScript runtime going away), stop the server.
 */
class CastController(context: Context, private val events: CastEvents) {
  private val appContext = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  private val serving = CastServing({ WifiAddress.find(appContext) })

  private var castContext: CastContext? = null
  private var initFailed = false
  private var router: MediaRouter? = null
  private var discovering = false
  private var session: CastSession? = null
  private var client: RemoteMediaClient? = null
  private var stopRequested = false
  private var lastPositionMs: Long? = null
  private var lastDurationMs: Long? = null
  private var finished = false

  private val selector: MediaRouteSelector = MediaRouteSelector.Builder()
    .addControlCategory(CastMediaControlIntent.categoryForCast(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID))
    .build()

  /** Whether this phone can cast at all (Google Play services with the Cast framework). */
  fun isAvailable(): Boolean = ensureCastContext() != null

  // --- discovery ---------------------------------------------------------------------------------------------------

  private val routerCallback = object : MediaRouter.Callback() {
    override fun onRouteAdded(router: MediaRouter, route: MediaRouter.RouteInfo) = publishDevices()
    override fun onRouteRemoved(router: MediaRouter, route: MediaRouter.RouteInfo) = publishDevices()
    override fun onRouteChanged(router: MediaRouter, route: MediaRouter.RouteInfo) = publishDevices()
  }

  fun startDiscovery() {
    if (ensureCastContext() == null || discovering) return
    val mediaRouter = router ?: MediaRouter.getInstance(appContext).also { router = it }
    mediaRouter.addCallback(selector, routerCallback, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY)
    discovering = true
    publishDevices()
  }

  fun stopDiscovery() {
    if (!discovering) return
    router?.removeCallback(routerCallback)
    discovering = false
  }

  fun devices(): List<Map<String, Any?>> {
    val mediaRouter = router ?: return emptyList()
    return mediaRouter.routes
      .filter { !it.isDefault && !it.isBluetooth && it.isEnabled && it.matchesSelector(selector) }
      .map { mapOf("id" to it.id, "name" to it.name, "description" to it.description) }
  }

  private fun publishDevices() {
    events.devices(devices())
  }

  // --- session -----------------------------------------------------------------------------------------------------

  private val sessionListener = object : SessionManagerListener<CastSession> {
    override fun onSessionStarting(session: CastSession) {
      events.state("connecting", null, null, null)
    }

    override fun onSessionStarted(session: CastSession, sessionId: String) = attach(session)

    override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) = attach(session)

    override fun onSessionStartFailed(session: CastSession, error: Int) {
      events.error("connect_failed", "Could not connect to the device ($error)")
      detach("failed")
    }

    override fun onSessionEnding(session: CastSession) {
      rememberPosition()
    }

    override fun onSessionEnded(session: CastSession, error: Int) {
      detach(if (stopRequested) "stopped" else if (error != 0) "dropped" else "ended")
    }

    override fun onSessionSuspended(session: CastSession, reason: Int) {
      rememberPosition()
      // No reconnection (CastOptionsProvider): a suspended session is a lost one. The phone takes over again.
      detach("dropped")
      runCatching { castContext?.sessionManager?.endCurrentSession(true) }
    }

    override fun onSessionResuming(session: CastSession, sessionId: String) = Unit
    override fun onSessionResumeFailed(session: CastSession, error: Int) = Unit
  }

  private val mediaCallback = object : RemoteMediaClient.Callback() {
    override fun onStatusUpdated() = publishState()
  }

  private val progressListener = RemoteMediaClient.ProgressListener { progressMs, durationMs ->
    if (progressMs >= 0) lastPositionMs = progressMs
    if (durationMs > 0) lastDurationMs = durationMs
    events.position(progressMs.coerceAtLeast(0), durationMs.takeIf { it > 0 })
  }

  fun connect(deviceId: String) {
    if (ensureCastContext() == null) {
      events.error("unavailable", "Casting isn't available on this phone")
      return
    }
    val mediaRouter = router ?: MediaRouter.getInstance(appContext).also { router = it }
    val route = mediaRouter.routes.firstOrNull { it.id == deviceId && it.matchesSelector(selector) }
    if (route == null) {
      events.error("device_gone", "The device is no longer available")
      return
    }
    stopRequested = false
    mediaRouter.selectRoute(route)
  }

  private fun attach(started: CastSession) {
    session = started
    stopRequested = false
    finished = false
    lastPositionMs = null
    lastDurationMs = null
    val media = started.remoteMediaClient
    client = media
    media?.registerCallback(mediaCallback)
    media?.addProgressListener(progressListener, PROGRESS_INTERVAL_MS)
    events.connected(started.castDevice?.friendlyName ?: "")
  }

  private fun detach(reason: String) {
    // Once per session: a suspended session is reported as dropped, and its later end says nothing more.
    val wasAttached = session != null
    client?.unregisterCallback(mediaCallback)
    client?.removeProgressListener(progressListener)
    client = null
    session = null
    serving.end()
    if (wasAttached || reason == "failed") events.disconnected(reason, lastPositionMs, finished)
    stopRequested = false
  }

  private fun rememberPosition() {
    val media = client ?: return
    val position = runCatching { media.approximateStreamPosition }.getOrNull()
    if (position != null && position >= 0) lastPositionMs = position
    if (media.mediaStatus?.idleReason == MediaStatus.IDLE_REASON_FINISHED) finished = true
  }

  // --- media -------------------------------------------------------------------------------------------------------

  fun load(request: CastLoadRecord) {
    val media = client
    if (media == null) {
      events.error("not_connected", "No device is connected")
      return
    }
    val remote = request.uri.startsWith("http://", ignoreCase = true) || request.uri.startsWith("https://", ignoreCase = true)
    val vtt = request.subtitleVtt?.takeIf { it.isNotBlank() }?.toByteArray(Charsets.UTF_8)
    var contentType = request.contentType ?: CastMimeTypes.forName(request.uri.substringBefore('?'))
    val urls = try {
      if (remote) {
        // An online stream the receiver opens itself; its subtitles, if any, would need the server, so none are sent.
        serving.end()
        CastServing.Urls(request.uri, null)
      } else {
        val file = CastSources.open(appContext, request.uri, request.contentType)
        contentType = file.contentType
        serving.begin(file, vtt)
      }
    } catch (refused: CastSourceRefusedException) {
      events.error(refusedCode(refused.reason), "This video can't be cast")
      return
    } catch (_: CastNoWifiException) {
      events.error("no_wifi", "Connect the phone to the same Wi-Fi as the TV")
      return
    } catch (failed: Exception) {
      serving.end()
      events.error("server_failed", failed.message ?: "Could not share the video")
      return
    }
    val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
      if (request.title.isNotBlank()) putString(MediaMetadata.KEY_TITLE, request.title)
    }
    val tracks = urls.subtitle?.let { url ->
      listOf(
        MediaTrack.Builder(SUBTITLE_TRACK_ID, MediaTrack.TYPE_TEXT)
          .setName(request.subtitleLabel ?: request.subtitleLanguage ?: "Subtitles")
          .setSubtype(MediaTrack.SUBTYPE_SUBTITLES)
          .setContentId(url)
          .setContentType("text/vtt")
          .apply { request.subtitleLanguage?.takeIf { it.isNotBlank() }?.let { setLanguage(it) } }
          .build(),
      )
    }
    val info = MediaInfo.Builder(urls.video)
      .setContentUrl(urls.video)
      .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
      .setContentType(contentType)
      .setMetadata(metadata)
      .apply { if (tracks != null) setMediaTracks(tracks) }
      .build()
    val load = MediaLoadRequestData.Builder()
      .setMediaInfo(info)
      .setAutoplay(request.autoplay)
      .setCurrentTime(request.positionMs.toLong().coerceAtLeast(0))
      .apply { if (tracks != null) setActiveTrackIds(longArrayOf(SUBTITLE_TRACK_ID)) }
      .build()
    finished = false
    lastPositionMs = request.positionMs.toLong().coerceAtLeast(0)
    media.load(load).setResultCallback { result ->
      if (!result.status.isSuccess) events.error("load_failed", "The TV couldn't play this video")
    }
  }

  fun play() {
    client?.play() ?: events.error("not_connected", "No device is connected")
  }

  fun pause() {
    client?.pause() ?: events.error("not_connected", "No device is connected")
  }

  fun seek(positionMs: Double) {
    val media = client ?: return events.error("not_connected", "No device is connected")
    val target = positionMs.toLong().coerceAtLeast(0)
    lastPositionMs = target
    media.seek(MediaSeekOptions.Builder().setPosition(target).build())
  }

  fun setVolume(volume: Double) {
    val current = session ?: return events.error("not_connected", "No device is connected")
    runCatching { current.volume = volume.coerceIn(0.0, 1.0) }
      .onFailure { events.error("volume_failed", "Could not change the TV's volume") }
    publishState()
  }

  /** Stops casting: the TV stops, the session ends, the server stops; the phone gets the last position. */
  fun stop() {
    serving.end()
    if (session == null) return
    stopRequested = true
    rememberPosition()
    runCatching { client?.stop() }
    // onSessionEnded reports the end (reason "stopped"); if the SDK refused, it is reported here instead.
    val ended = runCatching { castContext?.sessionManager?.endCurrentSession(true) }.isSuccess
    if (!ended) detach("stopped")
  }

  fun status(): Map<String, Any?> {
    val current = session
    val media = client
    return mapOf(
      "available" to (castContext != null),
      "connected" to (current != null),
      "deviceName" to current?.castDevice?.friendlyName,
      "state" to stateName(media?.mediaStatus),
      "positionMs" to (media?.approximateStreamPosition ?: lastPositionMs),
      "durationMs" to (media?.streamDuration?.takeIf { it > 0 } ?: lastDurationMs),
      "volume" to runCatching { current?.volume }.getOrNull(),
      "serving" to serving.isRunning,
    )
  }

  /** The app's JavaScript runtime is going away: stop discovery, end any cast, stop the server. */
  fun release() {
    stopDiscovery()
    if (session != null) stop()
    serving.end()
    castContext?.sessionManager?.removeSessionManagerListener(sessionListener, CastSession::class.java)
  }

  private fun publishState() {
    val media = client ?: return
    val status = media.mediaStatus
    if (status?.playerState == MediaStatus.PLAYER_STATE_IDLE && status.idleReason == MediaStatus.IDLE_REASON_FINISHED) {
      finished = true
    }
    if (status?.playerState == MediaStatus.PLAYER_STATE_IDLE && status.idleReason == MediaStatus.IDLE_REASON_ERROR) {
      events.error("playback_failed", "The TV couldn't play this video")
    }
    val position = runCatching { media.approximateStreamPosition }.getOrNull()?.takeIf { it >= 0 }
    if (position != null) lastPositionMs = position
    val duration = media.streamDuration.takeIf { it > 0 }
    if (duration != null) lastDurationMs = duration
    events.state(stateName(status), position, duration, runCatching { session?.volume }.getOrNull())
  }

  private fun stateName(status: MediaStatus?): String = when (status?.playerState) {
    MediaStatus.PLAYER_STATE_PLAYING -> "playing"
    MediaStatus.PLAYER_STATE_PAUSED -> "paused"
    MediaStatus.PLAYER_STATE_BUFFERING, MediaStatus.PLAYER_STATE_LOADING -> "buffering"
    MediaStatus.PLAYER_STATE_IDLE -> if (finished || status.idleReason == MediaStatus.IDLE_REASON_FINISHED) "finished" else "idle"
    else -> "idle"
  }

  private fun refusedCode(reason: CastSourceRefusedException.Reason): String = when (reason) {
    CastSourceRefusedException.Reason.PRIVATE -> "private"
    CastSourceRefusedException.Reason.GROWING -> "still_downloading"
    CastSourceRefusedException.Reason.NOT_LOCAL -> "stream_unsupported"
    else -> "file_unavailable"
  }

  private fun ensureCastContext(): CastContext? {
    castContext?.let { return it }
    if (initFailed) return null
    return try {
      @Suppress("DEPRECATION")
      CastContext.getSharedInstance(appContext).also { created ->
        castContext = created
        created.sessionManager.addSessionManagerListener(sessionListener, CastSession::class.java)
        // A session already running (the JavaScript runtime reloaded mid-cast) is picked up again.
        created.sessionManager.currentCastSession?.let { running -> main.post { attach(running) } }
      }
    } catch (_: Exception) {
      initFailed = true
      null
    }
  }

  private companion object {
    const val PROGRESS_INTERVAL_MS = 1_000L
    const val SUBTITLE_TRACK_ID = 1L
  }
}
