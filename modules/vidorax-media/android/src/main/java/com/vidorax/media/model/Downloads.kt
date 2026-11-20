package com.vidorax.media.model

/** Request context of the WebView frame that observed the media. Never carries cookie values. */
data class RequestContext(
  val userAgent: String?,
  val referer: String?,
  val origin: String?,
  val headers: Map<String, String>,
  val useCookies: Boolean,
  /**
   * #299: the download this request belongs to, so the HTTP client can add that download's sign-in
   * (net/DownloadCredentials) — set by the engine for each request, never stored (RequestContextJson leaves it out).
   */
  val authKey: String? = null,
  /**
   * B11: the incognito session (`vidorax-incog<session>`) the media was found in — its jar is used instead of the
   * active profile's ([com.vidorax.media.net.IncognitoWebCookies]); null for every other download (today's).
   */
  val cookieProfile: String? = null,
)

data class ProbeRequest(
  val url: String,
  /** Null lets the engine sniff the source. */
  val kind: SourceKind?,
  val manifestText: String?,
  val request: RequestContext,
  /** HLS: classify the variant an enqueue with this choice would download (see [EnqueueRequest.variant]). */
  val variant: VariantChoice? = null,
  /** [SourceKind.SPLIT] only: the audio file that goes with the video file [url]. */
  val audioUrl: String? = null,
)

sealed interface ProbeResult {
  data class Success(
    val kind: SourceKind,
    val finalUrl: String,
    val contentType: String?,
    val container: Container,
    val sizeBytes: Long?,
    val resumable: Boolean,
    val variants: List<ProbeVariant>,
    val audioTracks: List<ProbeAudioTrack>,
    val durationMs: Long?,
    /** The download will merge a separate audio track into the video (split files, HLS/DASH separate audio). */
    val mergesAudio: Boolean = false,
  ) : ProbeResult

  data class Failure(
    val reason: ProbeFailure,
    val httpStatus: Int?,
    val message: String?,
    /** #299: the server answered 401 and asks for HTTP Basic authentication. */
    val authChallenge: AuthChallenge? = null,
  ) : ProbeResult
}

/** #299: a `WWW-Authenticate: Basic` challenge — where to sign in (scheme://host:port) and the server's realm. */
data class AuthChallenge(val origin: String, val realm: String?)

/** #299: a user name and password for one download (net/DownloadCredentials). Never printed: both are hidden. */
class BasicCredentials(val username: String, val password: String) {
  override fun toString(): String = "BasicCredentials(<redacted>)"
}

data class ProbeVariant(
  val id: String,
  val width: Int?,
  val height: Int?,
  val bitrate: Long?,
  val frameRate: Double?,
  val videoCodec: String?,
  val needsAudioMux: Boolean,
  val estimatedBytes: Long?,
  val decodable: Boolean,
)

data class ProbeAudioTrack(
  val id: String,
  val language: String?,
  val label: String?,
  val bitrate: Long?,
  val codec: String?,
  val isDefault: Boolean,
)

data class VariantChoice(
  val videoId: String?,
  val audioId: String?,
  val maxHeight: Int?,
)

/**
 * [variant] chooses the HLS/DASH variant (`videoId` exact, else `maxHeight`, else the best decodable variant); the
 * stream's audio (a separate rendition or adaptation set) is chosen by the engine. [audioUrl] is the audio file of a
 * [SourceKind.SPLIT] download. `manifestText` is legacy and remains only for wire compatibility.
 */
data class EnqueueRequest(
  val url: String,
  val kind: SourceKind,
  val manifestText: String?,
  val audioUrl: String?,
  val variant: VariantChoice?,
  val request: RequestContext,
  val title: String,
  val site: SiteId,
  val pageUrl: String?,
  val thumbnailUrl: String?,
  val durationMs: Long?,
  val estimatedBytes: Long?,
  /**
   * #299: the user name and password the server asked for, for this download only (https, its own origin). Handed to
   * net/DownloadCredentials when the download is created; never stored with it.
   */
  val credentials: BasicCredentials? = null,
  val qualityLabel: String?,
  /** Null follows [DownloadSettings.autoSaveToGallery]. */
  val saveToGallery: Boolean?,
  /**
   * #494 Custom Extension: `mp4`, `m4v` or `m4a` for the finished file, used only when it is a safe alias for the
   * container its bytes prove (engine/PreferredExtensions); null (or anything else) keeps the usual extension.
   */
  val preferredExtension: String? = null,
  /**
   * #480 per-download "Wi-Fi only": true waits for (and keeps to) an unmetered network, false lets this download use
   * mobile data. Null follows [DownloadSettings.wifiOnly]. Kept by the engine until the download ends (NetworkChoices).
   */
  val wifiOnly: Boolean? = null,
  /**
   * The source as the page offered it, before any refresh or redirect: the video's identity is derived from it (see
   * `engine/DownloadIdentity`), so a re-signed or redirected link is still the same video. Null uses [url].
   */
  val identityUrl: String? = null,
  /**
   * H12 (Duplicate Action #386): the user wants this video although they already have it ("Keep both", or the new
   * copy of "Replace"): no identity check, and its finished file is kept even when the same bytes are saved.
   */
  val allowDuplicate: Boolean = false,
)

/**
 * What an enqueue did. A video is downloaded once: when the same video is already downloading, or already saved (in
 * the library, or as the gallery copy VidoraX made), the engine says so instead of starting a second copy.
 */
sealed interface EnqueueResult {
  data class Enqueued(val record: DownloadRecord) : EnqueueResult

  /** The download of this video that already exists (queued, running, waiting or paused). */
  data class AlreadyDownloading(val record: DownloadRecord) : EnqueueResult

  /** The library item that holds this video, or null when only VidoraX's gallery copy of it is left. */
  data class AlreadyDownloaded(val libraryItemId: String?, val galleryUri: String?) : EnqueueResult
}

data class DownloadRecord(
  val id: String,
  val state: DownloadState,
  val title: String,
  val site: SiteId,
  val kind: SourceKind,
  val pageUrl: String?,
  val thumbnailUrl: String?,
  val qualityLabel: String?,
  val bytesDone: Long,
  val totalBytes: Long?,
  val errorCode: DownloadErrorCode?,
  val errorMessage: String?,
  val attempts: Int,
  val libraryItemId: String?,
  val createdAt: Long,
  val updatedAt: Long,
  /** F3, [DownloadState.WAITING_CONDITIONS] only: the rule that holds it. */
  val waitReason: WaitReason? = null,
  /** F3, [DownloadState.WAITING_CONDITIONS] only: when a time rule ends (epoch ms). */
  val waitUntil: Long? = null,
  /** F3 "Start at…" (epoch ms), persisted in `download_schedule`. */
  val startAt: Long? = null,
  /** F6: the recorded length of a live recording so far (ms), from its checkpoint. */
  val recordedMs: Long? = null,
)

/** A download's own speed limit and Priority mark (F2), persisted in `download_bandwidth`. */
data class DownloadBandwidth(val id: String, val speedLimitBytesPerSecond: Long?, val priority: Boolean)

data class DownloadProgress(
  val id: String,
  val phase: ProgressPhase,
  val bytesDone: Long,
  val totalBytes: Long?,
  /** 0..1 when known. */
  val fraction: Double?,
  val speedBps: Long,
  val etaSeconds: Long?,
  /** [ProgressPhase.PROCESSING] only: what the engine is doing with the downloaded tracks. */
  val stage: ProcessingStage? = null,
  /** F6: a live recording's recorded length so far (ms). */
  val recordedMs: Long? = null,
  /**
   * #315, HLS/DASH segment downloads only (null otherwise): segments durably on disk and segments in all, over the
   * video and a separate audio track.
   */
  val segmentsDone: Int? = null,
  val segmentsTotal: Int? = null,
)

data class DownloadSettings(
  val maxConcurrent: Int,
  val wifiOnly: Boolean,
  val autoSaveToGallery: Boolean,
  /** Null means best available. */
  val preferredMaxHeight: Int?,
  /**
   * Connections one file may use at once (parallel byte ranges of a large progressive file, segments of a stream
   * fetched ahead). Still one [maxConcurrent] slot per download.
   */
  val connectionsPerFile: Int = DEFAULT_CONNECTIONS,
  /** All downloads together, bytes per second (Download Settings → "Speed limit"); null = no limit. */
  val speedLimitBytesPerSecond: Long? = null,
  /** F3: the daily download hours; null = any time. */
  val window: DownloadWindow? = null,
  /** F3: hold downloads while roaming. */
  val notOnRoaming: Boolean = false,
  /** F3: hold downloads at ≤ [com.vidorax.media.engine.DownloadRules.LOW_BATTERY_PERCENT] % while not charging. */
  val pauseOnLowBattery: Boolean = false,
  /** F3: run downloads only while charging. */
  val onlyWhileCharging: Boolean = false,
  /** The app's language for the F3 wait texts in notifications ("en" or "ur"). */
  val language: String = "en",
  /** F6: Settings → "Live recording (beta)"; off = live streams are refused. */
  val liveRecording: Boolean = false,
  /** F6: a recording stops by itself after this many minutes. */
  val liveRecordingMaxMinutes: Int = DEFAULT_LIVE_MAX_MINUTES,
  /**
   * Download Settings → "Automatically resume interrupted downloads" (on by default): after a process death or a
   * reboot, a download that was running continues by itself; off, it waits paused for the user's Resume.
   */
  val autoResume: Boolean = true,
  /** #350 "Buffer size": bytes read from the network per read (KiB, [MIN_BUFFER_KB]..[MAX_BUFFER_KB]). */
  val bufferKb: Int = DEFAULT_BUFFER_KB,
  /** #344 "Disk write cache": received bytes gathered in memory before each disk write (KiB, 0 = off). */
  val writeCacheKb: Int = 0,
  /** #348 "Low memory mode": [LowMemoryMode.AUTO] follows the device ([android.app.ActivityManager.isLowRamDevice]). */
  val lowMemoryMode: LowMemoryMode = LowMemoryMode.AUTO,
  /** #506 "Cooldown between files": seconds a site's next download waits after its previous one ended (0 = none). */
  val cooldownSeconds: Int = 0,
  /** #358 "Exit when done": close VidoraX when every download has finished while it is in the background. */
  val exitWhenDone: Boolean = false,
) {
  /**
   * The settings the engine runs with: in low memory mode one download at a time on one connection, a small read
   * buffer and no write cache, whatever was chosen (the chosen values stay saved for when the mode is off).
   */
  fun effective(lowRamDevice: Boolean): DownloadSettings =
    if (lowMemoryMode == LowMemoryMode.ON || (lowMemoryMode == LowMemoryMode.AUTO && lowRamDevice)) {
      copy(maxConcurrent = 1, connectionsPerFile = 1, bufferKb = LOW_MEMORY_BUFFER_KB, writeCacheKb = 0)
    } else {
      this
    }

  companion object {
    const val MIN_BUFFER_KB = 16
    const val MAX_BUFFER_KB = 1024
    const val DEFAULT_BUFFER_KB = 64
    const val LOW_MEMORY_BUFFER_KB = 32
    const val MAX_WRITE_CACHE_KB = 16 * 1024
    const val MAX_COOLDOWN_SECONDS = 600
    const val MIN_LIVE_MAX_MINUTES = 15
    const val MAX_LIVE_MAX_MINUTES = 720
    /** F6 default: 2 hours. */
    const val DEFAULT_LIVE_MAX_MINUTES = 120
    const val MIN_CONCURRENT = 1
    const val MAX_CONCURRENT = 4
    const val MIN_CONNECTIONS = 1
    const val MAX_CONNECTIONS = 4
    /** Tester-facing default of "Connections per file". */
    const val DEFAULT_CONNECTIONS = 3
    // A finished video also appears in the device gallery unless the user turned that off.
    val DEFAULT = DownloadSettings(maxConcurrent = 2, wifiOnly = false, autoSaveToGallery = true, preferredMaxHeight = null)
  }
}

/** #348: low memory mode — automatic (the device decides), always on, or off. */
enum class LowMemoryMode(val wire: String) {
  AUTO("auto"),
  ON("on"),
  OFF("off"),
  ;

  companion object {
    fun fromWire(value: String?): LowMemoryMode = entries.firstOrNull { it.wire == value } ?: AUTO
  }
}

/**
 * F3: the daily download hours, in minutes after local midnight. [startMinute] > [endMinute] crosses midnight; equal
 * means the whole day. [days] are ISO weekdays (1 = Monday … 7 = Sunday) on which the window starts.
 */
data class DownloadWindow(val startMinute: Int, val endMinute: Int, val days: Set<Int>) {
  init {
    require(startMinute in 0 until MINUTES_PER_DAY && endMinute in 0 until MINUTES_PER_DAY) { "minutes out of range" }
    require(days.all { it in 1..7 }) { "days are ISO weekdays 1..7" }
  }

  companion object {
    const val MINUTES_PER_DAY = 24 * 60
  }
}
