package com.vidorax.media.engine

import android.content.Context
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.DownloadWindow
import com.vidorax.media.MediaServices
import com.vidorax.media.net.AndroidDeviceConditions
import com.vidorax.media.net.AndroidNetworkGate
import com.vidorax.media.net.HttpClient
import com.vidorax.media.plan.AndroidDecoderSupport
import com.vidorax.media.plan.DashPlanner
import com.vidorax.media.plan.HlsPlanner
import com.vidorax.media.plan.Probe
import com.vidorax.media.process.AndroidCodecSupport
import com.vidorax.media.process.MediaProcessor
import com.vidorax.media.process.Remuxer
import com.vidorax.media.process.TransformerTranscoder
import com.vidorax.media.runner.BackgroundDownloads
import com.vidorax.media.runner.DownloadNotificationText
import com.vidorax.media.transfer.HlsTransfer
import com.vidorax.media.transfer.ProgressiveTransfer

/**
 * The single place the module obtains the download engine, as one process-wide instance wired to the shared
 * [MediaServices]. One HTTP client (public hosts only, session cookies per hop) serves the probe, the HLS and DASH
 * planners and both transfers; progressive files, unencrypted VOD HLS and DASH share verify → process → finalize →
 * library. Live and protected streams are refused by the classifier.
 */
object DownloadEngineProvider {
  @Volatile
  private var instance: DownloadEngine? = null

  fun get(context: Context): DownloadEngineApi =
    instance ?: synchronized(this) {
      instance ?: build(context.applicationContext).also { instance = it }
    }

  private fun build(context: Context): DownloadEngine {
    val services = MediaServices.get(context)
    val http = HttpClient.create()
    val planner = HlsPlanner(http, AndroidDecoderSupport)
    val probe = Probe(http, planner, DashPlanner(http, AndroidDecoderSupport))
    val settings = readSettings(context)
    DownloadNotificationText.language = settings.language
    val engine = DownloadEngine(
      store = SqliteDownloadStore(services.database),
      prober = RealProber(probe),
      hls = RealHlsDownloads(planner, HlsTransfer(http)),
      dash = RealDashDownloads(probe),
      split = RealSplitDownloads(probe),
      // Lossless remux/merge with Media3's muxers; re-encoding only through the platform codecs (Transformer).
      processing = RealMediaProcessing(MediaProcessor(Remuxer(), TransformerTranscoder(context), AndroidCodecSupport)),
      transfers = RealTransfers(ProgressiveTransfer(http)),
      verification = RealVerification,
      inspector = RealMediaInspector(services.mediaInfo),
      thumbnails = RealThumbnails(services.thumbnails),
      library = RealLibraryWriter(services.library),
      savedVideos = RealSavedVideos(services.savedVideos),
      gallery = RealGalleryPublisher(services.galleryExport),
      paths = services.paths,
      scope = services.scope,
      network = AndroidNetworkGate(context),
      device = AndroidDeviceConditions(context),
      initialSettings = settings,
      onSettingsChanged = {
        writeSettings(context, it)
        DownloadNotificationText.language = it.language
      },
      // The work folder and the library live on the same volume, so one free-space reading answers for both.
      freeSpace = { services.paths.workRoot.usableSpace },
    )
    // One runner per process: it observes the engine to keep transfers alive in the background, to show their
    // notifications, and to reconcile what a previous process left behind.
    BackgroundDownloads.install(context, engine, services.scope) { engine.restore() }
    return engine
  }

  /**
   * Download settings outlive the JavaScript runtime that set them: a download resumed at boot or after a
   * process death must obey Wi-Fi-only before anything in JavaScript has had a chance to run.
   */
  private fun prefs(context: Context) = context.getSharedPreferences(SETTINGS_FILE, Context.MODE_PRIVATE)

  private fun readSettings(context: Context): DownloadSettings {
    val stored = runCatching { prefs(context) }.getOrNull() ?: return DownloadSettings.DEFAULT
    val defaults = DownloadSettings.DEFAULT
    return DownloadSettings(
      maxConcurrent = stored.getInt(KEY_MAX_CONCURRENT, defaults.maxConcurrent)
        .coerceIn(DownloadSettings.MIN_CONCURRENT, DownloadSettings.MAX_CONCURRENT),
      wifiOnly = stored.getBoolean(KEY_WIFI_ONLY, defaults.wifiOnly),
      autoSaveToGallery = stored.getBoolean(KEY_AUTO_GALLERY, defaults.autoSaveToGallery),
      preferredMaxHeight = stored.getInt(KEY_MAX_HEIGHT, 0).takeIf { it > 0 },
      connectionsPerFile = stored.getInt(KEY_CONNECTIONS, defaults.connectionsPerFile)
        .coerceIn(DownloadSettings.MIN_CONNECTIONS, DownloadSettings.MAX_CONNECTIONS),
      speedLimitBytesPerSecond = stored.getLong(KEY_SPEED_LIMIT, 0L).takeIf { it > 0 },
      window = readWindow(stored),
      notOnRoaming = stored.getBoolean(KEY_NOT_ON_ROAMING, false),
      pauseOnLowBattery = stored.getBoolean(KEY_PAUSE_LOW_BATTERY, false),
      onlyWhileCharging = stored.getBoolean(KEY_ONLY_CHARGING, false),
      language = stored.getString(KEY_LANGUAGE, null) ?: "en",
    )
  }

  /** F3: the download hours as stored ("start,end,days" with days like "1234567"); anything unreadable is no window. */
  private fun readWindow(stored: android.content.SharedPreferences): DownloadWindow? = runCatching {
    val raw = stored.getString(KEY_WINDOW, null) ?: return null
    val (start, end, days) = raw.split(",")
    DownloadWindow(start.toInt(), end.toInt(), days.map { it.digitToInt() }.toSet()).takeIf { it.days.isNotEmpty() }
  }.getOrNull()

  private fun writeSettings(context: Context, settings: DownloadSettings) {
    runCatching {
      prefs(context).edit()
        .putInt(KEY_MAX_CONCURRENT, settings.maxConcurrent)
        .putBoolean(KEY_WIFI_ONLY, settings.wifiOnly)
        .putBoolean(KEY_AUTO_GALLERY, settings.autoSaveToGallery)
        .putInt(KEY_MAX_HEIGHT, settings.preferredMaxHeight ?: 0)
        .putInt(KEY_CONNECTIONS, settings.connectionsPerFile)
        .putLong(KEY_SPEED_LIMIT, settings.speedLimitBytesPerSecond ?: 0L)
        .putString(
          KEY_WINDOW,
          settings.window?.let { "${it.startMinute},${it.endMinute},${it.days.sorted().joinToString("")}" },
        )
        .putBoolean(KEY_NOT_ON_ROAMING, settings.notOnRoaming)
        .putBoolean(KEY_PAUSE_LOW_BATTERY, settings.pauseOnLowBattery)
        .putBoolean(KEY_ONLY_CHARGING, settings.onlyWhileCharging)
        .putString(KEY_LANGUAGE, settings.language)
        .apply()
    }
  }

  private const val SETTINGS_FILE = "vidorax-media-settings"
  private const val KEY_MAX_CONCURRENT = "maxConcurrent"
  private const val KEY_WIFI_ONLY = "wifiOnly"
  private const val KEY_AUTO_GALLERY = "autoSaveToGallery"
  private const val KEY_MAX_HEIGHT = "preferredMaxHeight"
  private const val KEY_CONNECTIONS = "connectionsPerFile"
  private const val KEY_SPEED_LIMIT = "speedLimitBytesPerSecond"
  private const val KEY_WINDOW = "downloadWindow"
  private const val KEY_NOT_ON_ROAMING = "notOnRoaming"
  private const val KEY_PAUSE_LOW_BATTERY = "pauseOnLowBattery"
  private const val KEY_ONLY_CHARGING = "onlyWhileCharging"
  private const val KEY_LANGUAGE = "language"
}
