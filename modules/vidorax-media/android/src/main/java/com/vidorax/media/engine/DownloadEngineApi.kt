package com.vidorax.media.engine

import com.vidorax.media.model.DownloadBandwidth
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

  /**
   * Sets download [id]'s own speed limit and Priority mark (F2); priority on clears it from every other download.
   * Returns every download's entry. Throws NotFoundException for an unknown id.
   */
  suspend fun setDownloadBandwidth(id: String, speedLimitBytesPerSecond: Long?, priority: Boolean): List<DownloadBandwidth> =
    emptyList()

  suspend fun listDownloadBandwidth(): List<DownloadBandwidth> = emptyList()

  /** Deletes work folders no download owns; returns the bytes freed. */
  suspend fun clearTempFiles(): Long

  /**
   * F15: download files that belong to nothing — work folders of no unfinished download, and the temporary parts of
   * v1 downloads not in [keepLegacyIds] (null: v1 folders are not looked at). Nothing is deleted.
   */
  suspend fun measureLeftovers(keepLegacyIds: Set<String>?): LeftoverSummary = LeftoverSummary.NONE

  /** F15: deletes what [measureLeftovers] lists; returns what was freed. */
  suspend fun cleanLeftovers(keepLegacyIds: Set<String>?): LeftoverSummary = LeftoverSummary.NONE

  /**
   * F3 "Start at…": the earliest moment [id] may run (null: as soon as the rules allow). A paused download starts by
   * itself then; a running one stops and waits. Throws NotFoundException / InvalidStateException (finished).
   */
  suspend fun setDownloadStartAt(id: String, startAt: Long?): DownloadRecord =
    throw UnsupportedOperationException("setDownloadStartAt")

  /** F3: when and under which conditions the waiting downloads may next run (the background wake-up); null: none wait. */
  suspend fun wakePlan(): WakePlan? = null

  /**
   * Downloads that reached COMPLETED with their verified library item and that JavaScript has not acknowledged yet —
   * including completions that happened while no JavaScript was running. Oldest first.
   */
  suspend fun listCompletions(): List<CompletionRecord>

  /** Marks completions as counted, so each is reported once. */
  suspend fun acknowledgeCompletions(ids: List<String>)
}

/**
 * F3: the background wake-up for downloads held by a rule — not before [earliestAt] (a start time, the download hours
 * opening), and only with the device conditions the rules ask for. Android's JobScheduler decides the exact moment.
 */
data class WakePlan(
  val earliestAt: Long,
  val requiresCharging: Boolean,
  val requiresBatteryNotLow: Boolean,
  val notRoaming: Boolean,
  val unmetered: Boolean,
)
