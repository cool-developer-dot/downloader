package com.vidorax.media.model

/** Request context of the WebView frame that observed the media. Never carries cookie values. */
data class RequestContext(
  val userAgent: String?,
  val referer: String?,
  val origin: String?,
  val headers: Map<String, String>,
  val useCookies: Boolean,
)

data class ProbeRequest(
  val url: String,
  /** Null lets the engine sniff the source. */
  val kind: SourceKind?,
  val manifestText: String?,
  val request: RequestContext,
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
  ) : ProbeResult

  data class Failure(
    val reason: ProbeFailure,
    val httpStatus: Int?,
    val message: String?,
  ) : ProbeResult
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
  val qualityLabel: String?,
  /** Null follows [DownloadSettings.autoSaveToGallery]. */
  val saveToGallery: Boolean?,
)

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
    val DEFAULT = DownloadSettings(maxConcurrent = 2, wifiOnly = false, autoSaveToGallery = false, preferredMaxHeight = null)
  }
}
