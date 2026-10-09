package com.vidorax.media.runner

import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import com.vidorax.media.model.ProcessingStage
import kotlin.math.abs

/**
 * What one download's notification says. Pure data: no Android types, and nothing from the request context —
 * a notification is readable on the lock screen, so it never carries the media URL, a signed token or a header.
 */
internal data class DownloadNotificationContent(
  val downloadId: String,
  val title: String,
  val text: String,
  /** 0..100 when the total size is known, null while it is not. */
  val percent: Int?,
  val showProgress: Boolean,
  /** Ongoing notifications cannot be swiped away and keep the running transfer visible. */
  val ongoing: Boolean,
  val kind: Kind,
  /** What the user can do from the notification itself, in the order they are shown. */
  val actions: List<Action> = emptyList(),
  /** Where tapping the notification takes the user. */
  val target: Target = Target.DOWNLOADS,
) {
  enum class Kind { ACTIVE, PAUSED, COMPLETED, FAILED }

  /** Every one of these is a call into the same engine the app's own buttons use. */
  enum class Action(val label: String) {
    PAUSE("Pause"),
    RESUME("Resume"),
    RETRY("Retry"),
    CANCEL("Cancel"),
  }

  enum class Target { DOWNLOADS, LIBRARY }

  val indeterminate: Boolean get() = showProgress && percent == null
}

/**
 * What the foreground runner's own notification says. With a single live download it is that download's
 * notification, so the user never sees the same transfer twice; with several it aggregates them.
 */
internal data class RunnerSummaryContent(
  val activeCount: Int,
  val pausedCount: Int,
  val percent: Int?,
  val title: String,
  val text: String,
  val indeterminate: Boolean,
  /** Set when this notification stands for exactly one download, so its buttons can act on it. */
  val downloadId: String? = null,
  val actions: List<DownloadNotificationContent.Action> = emptyList(),
) {
  companion object {
    val IDLE = RunnerSummaryContent(
      activeCount = 0,
      pausedCount = 0,
      percent = null,
      title = DownloadNotificationText.DOWNLOADING,
      text = DownloadNotificationText.DOWNLOADING,
      indeterminate = true,
    )
  }
}

internal object DownloadNotificationText {
  const val DOWNLOADING = "Downloading"
  const val PREPARING = "Preparing"
  const val PAUSED = "Paused"
  const val WAITING_NETWORK = "Waiting for network"
  const val WAITING_RETRY = "Retrying"
  const val PROCESSING = "Finishing up"

  fun processing(stage: ProcessingStage?): String = when (stage) {
    ProcessingStage.MERGING -> "Merging audio and video"
    ProcessingStage.REMUXING -> "Preparing the video file"
    ProcessingStage.TRANSCODING -> "Converting the video"
    ProcessingStage.VERIFYING, null -> PROCESSING
  }
  const val COMPLETED = "Download complete"

  /** Short, non-sensitive reasons; the Downloads row carries the fuller message. */
  fun failure(code: DownloadErrorCode?): String = when (code) {
    DownloadErrorCode.NETWORK -> "Download failed: network error"
    DownloadErrorCode.HTTP_403, DownloadErrorCode.SOURCE_EXPIRED -> "Download failed: the link expired"
    DownloadErrorCode.HTTP_404 -> "Download failed: the video is no longer available"
    DownloadErrorCode.HTTP_ERROR -> "Download failed: server error"
    DownloadErrorCode.DRM_PROTECTED -> "Download failed: protected video"
    DownloadErrorCode.LIVE_UNSUPPORTED -> "Download failed: live stream"
    DownloadErrorCode.UNSUPPORTED_FORMAT -> "Download failed: unsupported format"
    DownloadErrorCode.NOT_MEDIA -> "Download failed: not a video"
    DownloadErrorCode.PROCESSING_FAILED -> "Download failed: the file did not verify"
    DownloadErrorCode.NO_SPACE -> "Download failed: not enough storage"
    DownloadErrorCode.STORAGE_ERROR -> "Download failed: could not save the file"
    // Not a failure: the finished file was a video the user already has, so nothing new was added.
    DownloadErrorCode.DUPLICATE -> "Video already downloaded"
    DownloadErrorCode.VIDEO_TRACK_MISSING -> "Download failed: no video track"
    DownloadErrorCode.AUDIO_TRACK_MISSING -> "Download failed: no audio track"
    DownloadErrorCode.TRACK_MISMATCH -> "Download failed: audio and video don't match"
    DownloadErrorCode.SEGMENT_FAILED -> "Download failed: part of the stream is missing"
    DownloadErrorCode.MUX_FAILED -> "Download failed: couldn't merge audio and video"
    DownloadErrorCode.TRANSCODE_FAILED -> "Download failed: couldn't convert the video"
    DownloadErrorCode.INVALID_MEDIA -> "Download failed: the file did not verify"
    else -> "Download failed"
  }
}

/** PROTECTED and UNSUPPORTED verdicts on the source itself, and a duplicate: nothing a retry can change. */
internal val FINAL_FAILURES = setOf(
  DownloadErrorCode.DRM_PROTECTED,
  DownloadErrorCode.LIVE_UNSUPPORTED,
  DownloadErrorCode.UNSUPPORTED_FORMAT,
  DownloadErrorCode.DUPLICATE,
  // The tracks themselves are not one video: downloading them again cannot change that.
  DownloadErrorCode.VIDEO_TRACK_MISSING,
  DownloadErrorCode.AUDIO_TRACK_MISSING,
  DownloadErrorCode.TRACK_MISMATCH,
)

internal fun percentOf(bytesDone: Long, totalBytes: Long?): Int? =
  totalBytes?.takeIf { it > 0 }?.let { ((bytesDone.toDouble() / it) * 100).toInt().coerceIn(0, 100) }

internal fun formatBytes(bytes: Long): String {
  if (bytes < 1_000) return "$bytes B"
  val units = listOf("kB", "MB", "GB", "TB")
  var value = bytes.toDouble() / 1_000
  var unit = 0
  while (value >= 1_000 && unit < units.lastIndex) {
    value /= 1_000
    unit += 1
  }
  return String.format(if (value < 10) "%.1f %s" else "%.0f %s", value, units[unit])
}

/** "12.3 MB of 27.0 MB", or just what has landed while the size is unknown. */
internal fun transferDetail(bytesDone: Long, totalBytes: Long?): String? = when {
  totalBytes != null && totalBytes > 0 -> "${formatBytes(bytesDone)} of ${formatBytes(totalBytes)}"
  bytesDone > 0 -> formatBytes(bytesDone)
  else -> null
}

/** "1.2 MB/s"; null when nothing is moving, so a stalled or waiting download never shows a stale speed. */
internal fun formatSpeed(bytesPerSecond: Long): String? =
  if (bytesPerSecond > 0) "${formatBytes(bytesPerSecond)}/s" else null

/**
 * Stable per-download notification id: derived from the download id so the notification a previous process
 * posted is updated — never duplicated — after a restart.
 */
internal fun notificationIdFor(downloadId: String): Int {
  val hash = downloadId.hashCode()
  val positive = if (hash == Int.MIN_VALUE) 0 else abs(hash)
  return DOWNLOAD_NOTIFICATION_ID_BASE + (positive % DOWNLOAD_NOTIFICATION_ID_SPAN)
}

internal const val SUMMARY_NOTIFICATION_ID = 0x5644 // "VD"
internal const val DOWNLOAD_NOTIFICATION_ID_BASE = 0x5645
internal const val DOWNLOAD_NOTIFICATION_ID_SPAN = 1_000_000

/** The notification for a record, or null when the state deserves none: a cancelled download just disappears. */
internal fun notificationContentFor(
  record: DownloadRecord,
  bytesDone: Long = record.bytesDone,
  totalBytes: Long? = record.totalBytes,
  /** Current speed; shown only while bytes are actually moving (DOWNLOADING). */
  speedBps: Long = 0L,
  /** What PROCESSING is doing (merging, converting…), from the engine's progress events. */
  stage: ProcessingStage? = null,
): DownloadNotificationContent? {
  val detail = transferDetail(bytesDone, totalBytes)
  val speed = formatSpeed(speedBps).takeIf { record.state == DownloadState.DOWNLOADING }
  fun content(
    label: String,
    kind: DownloadNotificationContent.Kind,
    progress: Boolean,
    ongoing: Boolean,
    withDetail: Boolean = progress,
    actions: List<DownloadNotificationContent.Action> = emptyList(),
    target: DownloadNotificationContent.Target = DownloadNotificationContent.Target.DOWNLOADS,
  ) = DownloadNotificationContent(
    downloadId = record.id,
    title = record.title,
    text = listOfNotNull(label, detail?.takeIf { withDetail }, speed?.takeIf { withDetail }).joinToString(" · "),
    percent = percentOf(bytesDone, totalBytes).takeIf { progress },
    showProgress = progress,
    ongoing = ongoing,
    kind = kind,
    actions = actions,
    target = target,
  )
  val pauseAndCancel = listOf(DownloadNotificationContent.Action.PAUSE, DownloadNotificationContent.Action.CANCEL)
  val active = DownloadNotificationContent.Kind.ACTIVE
  return when (record.state) {
    DownloadState.QUEUED, DownloadState.PROBING ->
      content(DownloadNotificationText.PREPARING, active, progress = true, ongoing = true, actions = pauseAndCancel)
    DownloadState.DOWNLOADING ->
      content(DownloadNotificationText.DOWNLOADING, active, progress = true, ongoing = true, actions = pauseAndCancel)
    DownloadState.WAITING_NETWORK ->
      content(DownloadNotificationText.WAITING_NETWORK, active, progress = true, ongoing = true, actions = pauseAndCancel)
    DownloadState.WAITING_RETRY ->
      content(DownloadNotificationText.WAITING_RETRY, active, progress = true, ongoing = true, actions = pauseAndCancel)
    // Finishing up is verify → finalize → library: stopping it there is not something the engine allows.
    DownloadState.PROCESSING ->
      content(DownloadNotificationText.processing(stage), active, progress = true, ongoing = true)
    // Paused is not ongoing: the user stopped it, so the notification is theirs to dismiss.
    DownloadState.PAUSED ->
      content(
        DownloadNotificationText.PAUSED,
        DownloadNotificationContent.Kind.PAUSED,
        progress = true,
        ongoing = false,
        actions = listOf(DownloadNotificationContent.Action.RESUME, DownloadNotificationContent.Action.CANCEL),
      )
    DownloadState.COMPLETED ->
      content(
        DownloadNotificationText.COMPLETED,
        DownloadNotificationContent.Kind.COMPLETED,
        progress = false,
        ongoing = false,
        withDetail = true,
        target = DownloadNotificationContent.Target.LIBRARY,
      )
    DownloadState.FAILED ->
      content(
        DownloadNotificationText.failure(record.errorCode),
        DownloadNotificationContent.Kind.FAILED,
        progress = false,
        ongoing = false,
        withDetail = false,
        // A protected or unsupported source is a final verdict: a Retry button would only fail again.
        actions = if (record.errorCode in FINAL_FAILURES) emptyList() else listOf(DownloadNotificationContent.Action.RETRY),
      )
    DownloadState.CANCELLED -> null
  }
}

/** The runner's line while several downloads are live; a single one shows its own notification instead. */
internal fun aggregateSummaryContent(
  activeCount: Int,
  pausedCount: Int,
  bytesDone: Long,
  totalBytes: Long?,
  /** Combined speed of the live downloads. */
  speedBps: Long = 0L,
): RunnerSummaryContent {
  val percent = percentOf(bytesDone, totalBytes)
  val parts = listOfNotNull(
    DownloadNotificationText.DOWNLOADING,
    percent?.let { "$it%" } ?: transferDetail(bytesDone, totalBytes),
    formatSpeed(speedBps),
    pausedCount.takeIf { it > 0 }?.let { "$it paused" },
  )
  return RunnerSummaryContent(
    activeCount = activeCount,
    pausedCount = pausedCount,
    percent = percent,
    title = "Downloading $activeCount videos",
    text = parts.joinToString(" · "),
    indeterminate = percent == null,
  )
}

/** The runner's line while exactly one download is live: the download's own notification. */
internal fun singleSummaryContent(
  content: DownloadNotificationContent,
  pausedCount: Int,
): RunnerSummaryContent = RunnerSummaryContent(
  activeCount = 1,
  pausedCount = pausedCount,
  percent = content.percent,
  title = content.title,
  text = content.text,
  indeterminate = content.indeterminate,
  downloadId = content.downloadId,
  actions = content.actions,
)
