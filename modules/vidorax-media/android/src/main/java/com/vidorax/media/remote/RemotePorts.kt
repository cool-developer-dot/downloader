package com.vidorax.media.remote

import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import java.io.File

/** One row of the Web UI's queue: a download record with its latest progress. Never carries a media URL. */
data class RemoteDownload(
  val id: String,
  val title: String,
  val state: String,
  val site: String,
  val quality: String?,
  val bytesDone: Long,
  val totalBytes: Long?,
  val fraction: Double?,
  val speedBps: Long?,
  val etaSeconds: Long?,
  val errorCode: String?,
  val createdAt: Long,
  val updatedAt: Long,
  val actions: List<String>,
) {
  companion object {
    private val PAUSABLE = setOf(
      DownloadState.QUEUED,
      DownloadState.PROBING,
      DownloadState.DOWNLOADING,
      DownloadState.WAITING_NETWORK,
      DownloadState.WAITING_RETRY,
      DownloadState.WAITING_CONDITIONS,
    )
    private val ENDED = setOf(DownloadState.COMPLETED, DownloadState.FAILED, DownloadState.CANCELLED)

    /** The actions the queue offers for [state] — the same ones the app's own row offers. */
    fun actionsFor(state: DownloadState): List<String> = buildList {
      if (state in PAUSABLE) add(ACTION_PAUSE)
      if (state == DownloadState.PAUSED) add(ACTION_RESUME)
      if (state == DownloadState.FAILED) add(ACTION_RETRY)
      if (state !in ENDED && state != DownloadState.RECORDING && state != DownloadState.PROCESSING) add(ACTION_CANCEL)
    }

    fun from(record: DownloadRecord, progress: DownloadProgress?): RemoteDownload {
      val live = progress?.takeIf { it.id == record.id && record.state == DownloadState.DOWNLOADING }
      val total = live?.totalBytes ?: record.totalBytes
      val done = if (record.state == DownloadState.COMPLETED) (total ?: record.bytesDone) else (live?.bytesDone ?: record.bytesDone)
      val fraction = when {
        record.state == DownloadState.COMPLETED -> 1.0
        live?.fraction != null -> live.fraction
        total != null && total > 0 -> (done.toDouble() / total).coerceIn(0.0, 1.0)
        else -> null
      }
      return RemoteDownload(
        id = record.id,
        title = record.title,
        state = record.state.wire,
        site = record.site.wire,
        quality = record.qualityLabel,
        bytesDone = done,
        totalBytes = total,
        fraction = fraction,
        speedBps = live?.speedBps,
        etaSeconds = live?.etaSeconds,
        errorCode = record.errorCode?.wire,
        createdAt = record.createdAt,
        updatedAt = record.updatedAt,
        actions = actionsFor(record.state),
      )
    }

    const val ACTION_PAUSE = "pause"
    const val ACTION_RESUME = "resume"
    const val ACTION_RETRY = "retry"
    const val ACTION_CANCEL = "cancel"
  }
}

/** The download engine as the Web UI drives it; every call is the one the app's own buttons make. */
interface RemoteQueue {
  suspend fun list(): List<RemoteDownload>

  suspend fun pause(id: String)

  suspend fun resume(id: String)

  suspend fun retry(id: String)

  suspend fun cancel(id: String)

  suspend fun pauseAll()

  suspend fun resumeAll()
}

/** Where a link handed to VidoraX from outside the app came from. */
enum class LinkSource(val wire: String) {
  WEB("web"),
  EXTENSION("extension"),
  CLI("cli"),
  AUTOMATION("automation"),
  ;

  companion object {
    fun from(value: String?): LinkSource = entries.firstOrNull { it.wire == value } ?: WEB
  }
}

/** A link waiting for, or checked by, the app's Batch Add path. */
data class LinkRequest(
  val requestId: String,
  val url: String,
  val source: LinkSource,
  val createdAt: Long,
  /** `waiting_for_app` (no JavaScript yet), `checking`, then `added` / `duplicate` / `needs_review` / `refused`. */
  val status: String,
  val title: String? = null,
  val downloadId: String? = null,
  val detail: String? = null,
) {
  companion object {
    const val WAITING_FOR_APP = "waiting_for_app"
    const val CHECKING = "checking"
  }
}

interface RemoteLinkIntake {
  /** Null when the inbox is full. */
  fun submit(url: String, source: LinkSource): LinkRequest?

  fun get(requestId: String): LinkRequest?
}

/** #511 "Send to computer": a link or a finished video the phone put in the Web UI's "Sent from phone" list. */
data class SentItem(
  val id: String,
  val title: String,
  val url: String?,
  val libraryItemId: String?,
  val sizeBytes: Long?,
  val sentAt: Long,
)

/** A file the Web UI may download: what [RemoteSentFiles.openTicket] found behind a ticket. */
data class SentFile(val file: File, val name: String, val mimeType: String)

interface RemoteSentFiles {
  fun list(): List<SentItem>

  fun remove(id: String): Boolean

  /** A short-lived download path for item [id]'s file; null when it has none (a link only, or unknown). */
  suspend fun ticket(id: String): String?

  suspend fun openTicket(ticket: String): SentFile?
}
