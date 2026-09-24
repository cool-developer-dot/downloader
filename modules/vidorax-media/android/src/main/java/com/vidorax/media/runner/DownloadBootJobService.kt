package com.vidorax.media.runner

import android.app.job.JobParameters
import android.app.job.JobService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Picks downloads back up after a reboot. A plain job, deliberately: from Android 15 a `dataSync` foreground
 * service may not be started from BOOT_COMPLETED at all, and a user-initiated transfer job may only be
 * scheduled while the app is in the foreground. This job is what the platform does allow at boot, and it keeps
 * the process alive while the engine resumes what it had left; the moment the user opens VidoraX the normal
 * runner takes over.
 */
class DownloadBootJobService : JobService() {
  private var worker: Job? = null

  override fun onStartJob(params: JobParameters): Boolean {
    BackgroundDownloads.ensureEngine(applicationContext)
    worker = CoroutineScope(Dispatchers.Default).launch {
      // Give the engine a moment to reconcile before deciding there is nothing to do.
      delay(START_GRACE_MS)
      val deadline = System.currentTimeMillis() + MAX_RUN_MS
      while (BackgroundDownloads.hasLiveWork() && System.currentTimeMillis() < deadline) {
        delay(POLL_MS)
      }
      // Ask for a reschedule when work is still going, so the transfer is picked up again if we are cut short.
      jobFinished(params, BackgroundDownloads.hasLiveWork())
    }
    return true
  }

  /** The engine reacts to connectivity itself; the platform only wants to know we heard it. */
  override fun onNetworkChanged(params: JobParameters) = Unit

  override fun onStopJob(params: JobParameters): Boolean {
    worker?.cancel()
    worker = null
    return BackgroundDownloads.hasLiveWork()
  }

  private companion object {
    const val START_GRACE_MS = 4_000L
    const val POLL_MS = 2_000L

    /** A plain job gets roughly ten minutes; finish before the system stops us so the reschedule is ours. */
    const val MAX_RUN_MS = 9 * 60 * 1000L
  }
}
