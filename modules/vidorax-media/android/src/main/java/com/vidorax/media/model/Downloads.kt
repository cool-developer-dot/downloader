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
)

data class DownloadProgress(
  val id: String,
  val phase: ProgressPhase,
  val bytesDone: Long,
  val totalBytes: Long?,
  /** 0..1 when known. */
  val fraction: Double?,
  val speedBps: Long,
  val etaSeconds: Long?,
  /**
   * #315, HLS/DASH segment downloads only (null otherwise): segments durably on disk and segments in all, over the
   * video and a separate audio track.
   */
  val segmentsDone: Int? = null,
  val segmentsTotal: Int? = null,
  /** [ProgressPhase.PROCESSING] only: what the engine is doing with the downloaded tracks. */
  val stage: ProcessingStage? = null,
)

data class DownloadSettings(
  val maxConcurrent: Int,
  val wifiOnly: Boolean,
  val autoSaveToGallery: Boolean,
  /** Null means best available. */
  val preferredMaxHeight: Int?,
) {
  companion object {
    const val MIN_CONCURRENT = 1
    const val MAX_CONCURRENT = 4
    // A finished video also appears in the device gallery unless the user turned that off.
    val DEFAULT = DownloadSettings(maxConcurrent = 2, wifiOnly = false, autoSaveToGallery = true, preferredMaxHeight = null)
  }
}
