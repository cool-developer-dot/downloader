package com.vidorax.media.engine

import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.EnqueueResult
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import kotlinx.coroutines.flow.Flow

/**
 * What VidoraMediaModule needs from the download engine. The engine is application-scoped and outlives the module:
 * it owns the queue, the background runners and the downloads/parts tables, and adds finished items through
 * LibraryStore.insert. Failures are the coded exceptions of MediaErrors.kt.
 */
interface DownloadEngineApi {
  /** Progress events, throttled by the engine. */
  val progress: Flow<DownloadProgress>

  /** Every persisted state change. */
  val stateChanges: Flow<DownloadRecord>

  suspend fun probe(request: ProbeRequest): ProbeResult

  /** [enqueueUnique], with an already-saved video refused as ERR_ALREADY_DOWNLOADED (older callers). */
  suspend fun enqueue(request: EnqueueRequest): DownloadRecord

  /**
   * Starts the download unless the same video (engine/DownloadIdentity) is already downloading — that download is
   * returned — or already saved in the library or as VidoraX's gallery copy. Atomic: racing calls start one download.
   */
  suspend fun enqueueUnique(request: EnqueueRequest): EnqueueResult

  /** What [enqueueUnique] would find for this request without starting anything; null when the video is new. */
  suspend fun findDuplicate(request: EnqueueRequest): EnqueueResult?

  suspend fun pause(id: String)

  suspend fun resume(id: String)

  suspend fun retry(id: String)

  suspend fun cancel(id: String)

  /** Removes a failed, cancelled or completed record and its temp files, never the library item. */
  suspend fun removeDownload(id: String)

  suspend fun pauseAll()

  suspend fun resumeAll()

  /** Every non-completed record plus records completed in the last 24 h, newest first. */
  suspend fun listDownloads(): List<DownloadRecord>

  suspend fun setDownloadSettings(settings: DownloadSettings)

  /** Deletes work folders no download owns; returns the bytes freed. */
  suspend fun clearTempFiles(): Long

  /**
   * Downloads that reached COMPLETED with their verified library item and that JavaScript has not acknowledged yet —
   * including completions that happened while no JavaScript was running. Oldest first.
   */
  suspend fun listCompletions(): List<CompletionRecord>

  /** Marks completions as counted, so each is reported once. */
  suspend fun acknowledgeCompletions(ids: List<String>)
}
