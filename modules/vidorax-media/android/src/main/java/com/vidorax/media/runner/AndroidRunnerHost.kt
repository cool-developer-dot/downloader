package com.vidorax.media.runner

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Keeps the process transferring while downloads are live, with the mechanism the running Android version
 * expects: a user-initiated data transfer job from API 34, a dataSync foreground service below it. Both are
 * only a keep-alive around the one engine — neither starts, resumes or duplicates a transfer.
 */
internal class AndroidRunnerHost(
  private val context: Context,
  private val notifications: DownloadNotifications,
) : RunnerHost {
  private enum class Mode { NONE, JOB, SERVICE }

  @Volatile
  var summary: RunnerSummaryContent = RunnerSummaryContent.IDLE
    private set

  @Volatile
  private var mode = Mode.NONE

  override fun start(summary: RunnerSummaryContent) {
    this.summary = summary
    if (mode != Mode.NONE) {
      update(summary)
      return
    }
    if (Build.VERSION.SDK_INT >= USER_INITIATED_JOB_SDK && scheduleJob()) {
      mode = Mode.JOB
      return
    }
    if (startService()) {
      mode = Mode.SERVICE
      return
    }
    // Truthful degradation: the transfer still runs, but only for as long as Android keeps this process alive.
    Log.w(TAG, "No background runner could be started; downloads run only while the app process lives")
    notifications.showSummary(summary)
  }

  override fun update(summary: RunnerSummaryContent) {
    this.summary = summary
    notifications.showSummary(summary)
  }

  override fun stop() {
    summary = RunnerSummaryContent.IDLE
    when (mode) {
      Mode.JOB -> {
        if (Build.VERSION.SDK_INT >= USER_INITIATED_JOB_SDK) {
          DownloadTransferJobService.finishCurrent()
          cancelJob()
        }
      }
      Mode.SERVICE -> runCatching { context.stopService(Intent(context, DownloadForegroundService::class.java)) }
      Mode.NONE -> Unit
    }
    mode = Mode.NONE
    notifications.clearSummary()
  }

  private fun scheduleJob(): Boolean {
    val scheduler = context.getSystemService(JobScheduler::class.java) ?: return false
    val info = JobInfo.Builder(JOB_ID, ComponentName(context, DownloadTransferJobService::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
      .setUserInitiated(true)
      .build()
    return runCatching { scheduler.schedule(info) == JobScheduler.RESULT_SUCCESS }
      .onFailure { Log.w(TAG, "user-initiated transfer job refused: ${it.javaClass.simpleName}") }
      .getOrDefault(false)
  }

  private fun cancelJob() {
    runCatching { context.getSystemService(JobScheduler::class.java)?.cancel(JOB_ID) }
  }

  private fun startService(): Boolean = runCatching {
    val intent = Intent(context, DownloadForegroundService::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(intent)
    } else {
      context.startService(intent)
    }
    true
  }.onFailure { Log.w(TAG, "foreground download service refused: ${it.javaClass.simpleName}") }.getOrDefault(false)

  private companion object {
    const val TAG = "VidoraDownloads"
    const val JOB_ID = 0x5644
    const val USER_INITIATED_JOB_SDK = 34
  }
}
