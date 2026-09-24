package com.vidorax.media.runner

import android.app.job.JobParameters
import android.app.job.JobService
import android.util.Log

/**
 * The Android 14+ path: a user-initiated data transfer job. The job is the process's permission to keep
 * transferring while the app is backgrounded; the engine's workers still own the actual download, so the job
 * starts nothing and can never produce a second worker for an id.
 */
class DownloadTransferJobService : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    runCatching {
      setNotification(
        params,
        SUMMARY_NOTIFICATION_ID,
        BackgroundDownloads.summaryNotification(this),
        JOB_END_NOTIFICATION_POLICY_REMOVE,
      )
    }.onFailure { Log.w(TAG, "could not attach the transfer notification: ${it.javaClass.simpleName}") }
    synchronized(LOCK) { current = this to params }
    // A fresh process (the system started us after a process death): rebuild the engine, which re-queues
    // interrupted downloads through its own idempotent restore.
    BackgroundDownloads.ensureEngine(applicationContext)
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean {
    synchronized(LOCK) {
      if (current?.second === params) current = null
    }
    // Ask for a reschedule only while the engine still has work; otherwise the job is simply done.
    return BackgroundDownloads.hasLiveWork()
  }

  companion object {
    private const val TAG = "VidoraDownloads"
    private val LOCK = Any()

    @Volatile
    private var current: Pair<DownloadTransferJobService, JobParameters>? = null

    /** Ends the running job cleanly once nothing is left to transfer. */
    fun finishCurrent() {
      val running = synchronized(LOCK) { current.also { current = null } } ?: return
      runCatching { running.first.jobFinished(running.second, false) }
    }
  }
}
