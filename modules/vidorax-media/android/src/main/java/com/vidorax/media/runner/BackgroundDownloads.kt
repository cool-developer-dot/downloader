package com.vidorax.media.runner

import android.app.Notification
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.util.Log
import com.vidorax.media.MediaServices
import com.vidorax.media.engine.SqliteDownloadStore
import com.vidorax.media.model.DownloadState
import com.vidorax.media.engine.DownloadEngineApi
import com.vidorax.media.engine.DownloadEngineProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Process-wide seam between the download engine and Android's background/notification machinery. The engine is
 * built once (see [DownloadEngineProvider]); everything here observes it and never drives it.
 */
internal object BackgroundDownloads {
  @Volatile
  private var runner: DownloadRunner? = null

  @Volatile
  private var host: AndroidRunnerHost? = null

  @Volatile
  private var notifications: DownloadNotifications? = null

  /**
   * Called once, from the engine's own construction, so there is exactly one runner per process. [reconcile] is
   * the engine's own startup reconciliation; it runs before the runner adopts the rows it produced.
   */
  fun install(
    context: Context,
    engine: DownloadEngineApi,
    scope: CoroutineScope,
    reconcile: suspend () -> Unit,
  ) {
    val appContext = context.applicationContext
    val notifier = DownloadNotifications(appContext)
    val runnerHost = AndroidRunnerHost(appContext, notifier)
    val downloadRunner = DownloadRunner(runnerHost, notifier)
    notifications = notifier
    host = runnerHost
    runner = downloadRunner
    // Subscribe before reconciling, so no state change between the two is missed.
    downloadRunner.attach(engine, scope)
    scope.launch {
      // Reconcile downloads interrupted by a previous process death; idempotent, so the singleton runs it once.
      runCatching { reconcile() }
      runCatching { downloadRunner.restore(engine.listDownloads()) }
    }
  }

  /**
   * Brings the engine back up after Android restarted the process for our service/job. Off the main thread: it
   * opens the database. Idempotent — [DownloadEngineProvider] keeps one instance and one restore.
   */
  fun ensureEngine(context: Context) {
    val appContext = context.applicationContext
    CoroutineScope(Dispatchers.IO).launch {
      runCatching { DownloadEngineProvider.get(appContext) }
    }
  }

  /** The notification a service or job must attach itself to; safe before the engine has reported anything. */
  fun summaryNotification(context: Context): Notification {
    val notifier = notifications ?: DownloadNotifications(context.applicationContext)
    return notifier.buildSummary(host?.summary ?: RunnerSummaryContent.IDLE)
  }

  fun hasLiveWork(): Boolean = runner?.hasLiveWork() ?: false

  /**
   * Whether any download was still going when the process last died. Reads the engine's own table, so a paused
   * download — which the user stopped on purpose — is never counted.
   */
  suspend fun hasUnfinishedWork(context: Context): Boolean = runCatching {
    val services = MediaServices.get(context.applicationContext)
    SqliteDownloadStore(services.database).list(System.currentTimeMillis()).any { it.state in UNFINISHED }
  }.getOrDefault(false)

  /**
   * Called from the boot broadcast. It schedules a plain job rather than starting a foreground service: from
   * Android 15 a `dataSync` service started from BOOT_COMPLETED is refused outright, and a user-initiated
   * transfer job can only be scheduled while the app is in the foreground. The job keeps the process alive
   * while the engine resumes; the normal runner takes over as soon as the user opens the app.
   */
  fun resumeAfterBoot(context: Context) {
    val app = context.applicationContext
    val scheduler = app.getSystemService(JobScheduler::class.java)
    val info = JobInfo.Builder(BOOT_JOB_ID, ComponentName(app, DownloadBootJobService::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
      .build()
    val scheduled = runCatching { scheduler?.schedule(info) == JobScheduler.RESULT_SUCCESS }.getOrDefault(false)
    if (!scheduled) {
      Log.w(TAG, "could not schedule the boot recovery job; downloads resume when the app is opened")
      // The engine still reconciles its rows, so nothing is lost — it simply waits for the app.
      ensureEngine(app)
    }
  }

  private const val TAG = "VidoraDownloads"
  private const val BOOT_JOB_ID = 0x5645

  private val UNFINISHED = setOf(
    DownloadState.QUEUED,
    DownloadState.PROBING,
    DownloadState.DOWNLOADING,
    DownloadState.WAITING_NETWORK,
    DownloadState.WAITING_RETRY,
    DownloadState.PROCESSING,
  )
}
