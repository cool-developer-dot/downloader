package com.vidorax.media.bridge

import android.net.Uri
import com.vidorax.media.analyze.PageFetchResult
import com.vidorax.media.model.AdjacentItems
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.EnqueueResult
import com.vidorax.media.model.LibraryChange
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.LibraryPage
import com.vidorax.media.model.ProbeAudioTrack
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.ProbeVariant
import com.vidorax.media.model.SiteCount
import com.vidorax.media.model.StorageStats
import java.io.File

// Return values and event payloads in the exact shape of src/VidoraMedia.types.ts. The contract declares `T | null`
// rather than optional fields, so every key is always present.

internal fun LibraryItem.toJs(): Map<String, Any?> = mapOf(
  "id" to id,
  "title" to title,
  "site" to site.wire,
  "pageUrl" to pageUrl,
  "fileUri" to file.toUriString(),
  "fileName" to file.name,
  "mimeType" to mimeType,
  "container" to container.wire,
  "videoCodec" to videoCodec,
  "audioCodec" to audioCodec,
  "hasAudio" to hasAudio,
  "width" to width,
  "height" to height,
  "durationMs" to durationMs,
  "sizeBytes" to sizeBytes,
  "thumbnailUri" to thumbnail?.toUriString(),
  "favorite" to favorite,
  "galleryUri" to galleryUri,
  "createdAt" to createdAt,
  "completedAt" to completedAt,
)

internal fun LibraryPage.toJs(): Map<String, Any?> = mapOf("items" to items.map { it.toJs() }, "total" to total)

internal fun SiteCount.toJs(): Map<String, Any?> = mapOf("site" to site.wire, "count" to count)

internal fun AdjacentItems.toJs(): Map<String, Any?> = mapOf("previous" to previous, "next" to next)

internal fun LibraryChange.toJs(): Map<String, Any?> = mapOf("reason" to reason.wire, "ids" to ids)

internal fun StorageStats.toJs(): Map<String, Any?> = mapOf(
  "libraryBytes" to libraryBytes,
  "thumbnailBytes" to thumbnailBytes,
  "tempBytes" to tempBytes,
  "freeBytes" to freeBytes,
  "totalBytes" to totalBytes,
)

internal fun DownloadRecord.toJs(): Map<String, Any?> = mapOf(
  "id" to id,
  "state" to state.wire,
  "title" to title,
  "site" to site.wire,
  "kind" to kind.wire,
  "pageUrl" to pageUrl,
  "thumbnailUrl" to thumbnailUrl,
  "qualityLabel" to qualityLabel,
  "bytesDone" to bytesDone,
  "totalBytes" to totalBytes,
  "errorCode" to errorCode?.wire,
  "errorMessage" to errorMessage,
  "attempts" to attempts,
  "libraryItemId" to libraryItemId,
  "createdAt" to createdAt,
  "updatedAt" to updatedAt,
)

internal fun EnqueueResult.toJs(): Map<String, Any?> = when (this) {
  is EnqueueResult.Enqueued -> mapOf("outcome" to "ENQUEUED", "record" to record.toJs(), "libraryItemId" to null)
  is EnqueueResult.AlreadyDownloading ->
    mapOf("outcome" to "ALREADY_DOWNLOADING", "record" to record.toJs(), "libraryItemId" to null)
  is EnqueueResult.AlreadyDownloaded -> mapOf("outcome" to "ALREADY_DOWNLOADED", "record" to null, "libraryItemId" to libraryItemId)
}

internal fun DownloadProgress.toJs(): Map<String, Any?> = mapOf(
  "id" to id,
  "phase" to phase.wire,
  "bytesDone" to bytesDone,
  "totalBytes" to totalBytes,
  "fraction" to fraction,
  "speedBps" to speedBps,
  "etaSeconds" to etaSeconds,
  "stage" to stage?.wire,
)

internal fun ProbeResult.toJs(): Map<String, Any?> = when (this) {
  is ProbeResult.Success -> mapOf(
    "ok" to true,
    "kind" to kind.wire,
    "finalUrl" to finalUrl,
    "contentType" to contentType,
    "container" to container.wire,
    "sizeBytes" to sizeBytes,
    "resumable" to resumable,
    "variants" to variants.map { it.toJs() },
    "audioTracks" to audioTracks.map { it.toJs() },
    "durationMs" to durationMs,
    "mergesAudio" to mergesAudio,
  )
  is ProbeResult.Failure -> mapOf(
    "ok" to false,
    "reason" to reason.wire,
    "httpStatus" to httpStatus,
    "message" to message,
  )
}

internal fun PageFetchResult.toJs(): Map<String, Any?> = when (this) {
  is PageFetchResult.Document -> mapOf(
    "kind" to "document",
    "finalUrl" to finalUrl,
    "status" to status,
    "contentType" to contentType,
    "body" to body,
    "truncated" to truncated,
    "redirects" to redirects,
    "elapsedMs" to elapsedMs,
  )
  is PageFetchResult.Media -> mapOf(
    "kind" to "media",
    "finalUrl" to finalUrl,
    "status" to status,
    "contentType" to contentType,
    "contentLength" to contentLength,
    "redirects" to redirects,
    "elapsedMs" to elapsedMs,
  )
  is PageFetchResult.Failure -> mapOf(
    "kind" to "failure",
    "code" to code.wire,
    "status" to status,
    "redirects" to redirects,
    "elapsedMs" to elapsedMs,
  )
}

private fun ProbeVariant.toJs(): Map<String, Any?> = mapOf(
  "id" to id,
  "width" to width,
  "height" to height,
  "bitrate" to bitrate,
  "frameRate" to frameRate,
  "videoCodec" to videoCodec,
  "needsAudioMux" to needsAudioMux,
  "estimatedBytes" to estimatedBytes,
  "decodable" to decodable,
)

private fun ProbeAudioTrack.toJs(): Map<String, Any?> = mapOf(
  "id" to id,
  "language" to language,
  "label" to label,
  "bitrate" to bitrate,
  "codec" to codec,
  "isDefault" to isDefault,
)

/** `file:///...` with the path percent-encoded, as expo-video and expo-image expect. */
private fun File.toUriString(): String = Uri.fromFile(this).toString()
