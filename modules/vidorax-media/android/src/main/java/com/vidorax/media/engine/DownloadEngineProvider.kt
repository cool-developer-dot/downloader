package com.vidorax.media.engine

import android.content.Context
import com.vidorax.media.InvalidStateException
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadSettings
import com.vidorax.media.model.EnqueueRequest
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

/**
 * The single place the module obtains the download engine. The engine implementation replaces
 * [UnavailableDownloadEngine] here; until then every download call rejects with ERR_INVALID_STATE.
 */
object DownloadEngineProvider {
  @Suppress("UNUSED_PARAMETER")
  fun get(context: Context): DownloadEngineApi = UnavailableDownloadEngine
}

private object UnavailableDownloadEngine : DownloadEngineApi {
  override val progress: Flow<DownloadProgress> = emptyFlow()
  override val stateChanges: Flow<DownloadRecord> = emptyFlow()

  override suspend fun probe(request: ProbeRequest): ProbeResult = unavailable()

  override suspend fun enqueue(request: EnqueueRequest): DownloadRecord = unavailable()

  override suspend fun pause(id: String) = unavailable()

  override suspend fun resume(id: String) = unavailable()

  override suspend fun retry(id: String) = unavailable()

  override suspend fun cancel(id: String) = unavailable()

  override suspend fun removeDownload(id: String) = unavailable()

  override suspend fun pauseAll() = unavailable()

  override suspend fun resumeAll() = unavailable()

  override suspend fun listDownloads(): List<DownloadRecord> = unavailable()

  override suspend fun setDownloadSettings(settings: DownloadSettings) = unavailable()

  override suspend fun clearTempFiles(): Long = unavailable()

  private fun unavailable(): Nothing = throw InvalidStateException("Downloads are not available in this build")
}
