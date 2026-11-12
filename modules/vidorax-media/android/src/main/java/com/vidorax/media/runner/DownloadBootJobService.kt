package com.vidorax.media.runner

import android.app.job.JobParameters
import android.app.job.JobService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A plain job that keeps the process alive while the engine works without the app on screen. Deliberately plain:
 * from Android 15 a `dataSync` foreground service may not be started from BOOT_COMPLETED or the background at all,
 * and a user-initiated transfer job may only be scheduled while the app is visible. Three uses (job ids in
 * [BackgroundDownloads]): picking downloads back up after a reboot; F3's wake-up when a waiting download's start
 * time or download hours arrive (with the charging / battery / roaming constraints of the rules); and carrying a
 * download that became allowed while the app is in the background. Each run lasts up to ~9 minutes and asks to be
 * rescheduled while work is left — resumable progress across several runs. The moment the user opens VidoraX the
 * normal runner takes over.
 */
class DownloadBootJobService : JobService() {
  private var worker: Job? = null

  override fun onStartJob(params: JobParameters): Boolean {
    running.add(params.jobId)
    BackgroundDownloads.ensureEngine(applicationContext)
    worker = CoroutineScope(Dispatchers.Default).launch {
      // Give the engine a moment to reconcile before deciding there is nothing to do.
      delay(START_GRACE_MS)
      val deadline = System.currentTimeMillis() + MAX_RUN_MS
      while (BackgroundDownloads.hasLiveWork() && System.currentTimeMillis() < deadline) {
        delay(POLL_MS)
      }
      // Ask for a reschedule when work is still going, so the transfer is picked up again if we are cut short.
      val more = BackgroundDownloads.hasLiveWork()
      running.remove(params.jobId)
      jobFinished(params, more)
      BackgroundDownloads.onBackgroundJobEnded(applicationContext)
    }
    return true
  }

  /** The engine reacts to connectivity itself; the platform only wants to know we heard it. */
  override fun onNetworkChanged(params: JobParameters) = Unit

  override fun onStopJob(params: JobParameters): Boolean {
    worker?.cancel()
    worker = null
    running.remove(params.jobId)
    return BackgroundDownloads.hasLiveWork()
  }

  internal companion object {
    /** Job ids running right now: rescheduling one of them would stop it. */
    private val running = java.util.concurrent.ConcurrentHashMap.newKeySet<Int>()

    fun isRunning(jobId: Int): Boolean = jobId in running

    private const val START_GRACE_MS = 4_000L
    private const val POLL_MS = 2_000L

    /** A plain job gets roughly ten minutes; finish before the system stops us so the reschedule is ours. */
    private const val MAX_RUN_MS = 9 * 60 * 1000L
  }
}
