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
import com.vidorax.media.engine.WakePlan
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
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

  @Volatile
  private var engineRef: DownloadEngineApi? = null

  /** F3: asks for the wake-up to be looked at again (conflated, so a burst of state changes is one look). */
  private val wakeRequests = Channel<Unit>(Channel.CONFLATED)

  @Volatile
  private var lastWake: WakePlan? = null

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
    engineRef = engine
    // Subscribe before reconciling, so no state change between the two is missed.
    downloadRunner.attach(engine, scope)
    scope.launch {
      // Reconcile downloads interrupted by a previous process death; idempotent, so the singleton runs it once.
      runCatching { reconcile() }
      runCatching { downloadRunner.restore(engine.listDownloads()) }
      wakeRequests.trySend(Unit)
    }
    // F3: every state change may change what waits for a rule, so the background wake-up follows it.
    scope.launch { engine.stateChanges.collect { wakeRequests.trySend(Unit) } }
    scope.launch {
      for (request in wakeRequests) {
        delay(WAKE_SETTLE_MS)
        runCatching { scheduleWake(appContext, engine.wakePlan()) }
      }
    }
  }

  /** A plain background job ended: the wake-up it may have stood in for is decided again. */
  fun onBackgroundJobEnded(context: Context) {
    lastWake = null
    if (engineRef != null) wakeRequests.trySend(Unit) else ensureEngine(context)
  }

  /**
   * F3: the JobScheduler job that wakes VidoraX for downloads held by a rule — not before the start time / the
   * download hours (minimum latency), and only while charging / with the battery not low / not roaming / on Wi-Fi
   * when the rules say so. Persisted, so it survives a reboot. No exact alarm: Android picks the moment, so a start
   * can be a few minutes late. Never rescheduled while it runs (that would stop it); cancelled when nothing waits.
   */
  private fun scheduleWake(context: Context, plan: WakePlan?) {
    val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
    if (DownloadBootJobService.isRunning(WAKE_JOB_ID)) return
    if (plan == null) {
      if (lastWake != null) runCatching { scheduler.cancel(WAKE_JOB_ID) }
      lastWake = null
      return
    }
    if (plan == lastWake) return
    val network = when {
      plan.unmetered -> JobInfo.NETWORK_TYPE_UNMETERED
      plan.notRoaming -> JobInfo.NETWORK_TYPE_NOT_ROAMING
      else -> JobInfo.NETWORK_TYPE_ANY
    }
    val latency = (plan.earliestAt - System.currentTimeMillis()).coerceAtLeast(0L)
    val builder = JobInfo.Builder(WAKE_JOB_ID, ComponentName(context, DownloadBootJobService::class.java))
      .setMinimumLatency(latency)
      .setRequiredNetworkType(network)
      .setRequiresCharging(plan.requiresCharging)
      .setRequiresBatteryNotLow(plan.requiresBatteryNotLow)
      .setPersisted(true)
    // A timed wake-up gets a deadline shortly after its time: without one, Android 14+ may add "flexible" constraints
    // (charging, idle) and hold the job for hours. A window under an hour is exempt. At the deadline the job runs even
    // if a condition is still unmet; the engine then re-checks and plans an untimed wake-up, so nothing repeats.
    if (latency > 0) builder.setOverrideDeadline(latency + WAKE_DEADLINE_SLACK_MS)
    val info = builder.build()
    val scheduled = runCatching { scheduler.schedule(info) == JobScheduler.RESULT_SUCCESS }.getOrDefault(false)
    lastWake = plan.takeIf { scheduled }
    if (!scheduled) Log.w(TAG, "could not schedule the download wake-up; waiting downloads start when the app is opened")
  }

  /**
   * Keeps a download that became allowed while VidoraX is in the background going: there the user-initiated job and
   * the foreground service are refused, a plain job is not. It ends by itself when no work is left.
   */
  fun scheduleContinuation(context: Context): Boolean {
    val app = context.applicationContext
    if (DownloadBootJobService.isRunning(CONTINUE_JOB_ID)) return true
    val info = JobInfo.Builder(CONTINUE_JOB_ID, ComponentName(app, DownloadBootJobService::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
      .build()
    return runCatching { app.getSystemService(JobScheduler::class.java)?.schedule(info) == JobScheduler.RESULT_SUCCESS }
      .getOrDefault(false)
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

  /** F3: the wake-up for downloads held by a rule. */
  internal const val WAKE_JOB_ID = 0x5646

  /** A download allowed while the app is in the background. */
  internal const val CONTINUE_JOB_ID = 0x5647

  /** F3: how late a timed wake-up (a start time, the download hours opening) may run at most. */
  internal const val WAKE_DEADLINE_SLACK_MS = 10L * 60 * 1000

  /** State changes come in bursts; the wake-up is decided once they settle. */
  private const val WAKE_SETTLE_MS = 500L

  private val UNFINISHED = setOf(
    DownloadState.QUEUED,
    DownloadState.PROBING,
    DownloadState.DOWNLOADING,
    DownloadState.WAITING_NETWORK,
    DownloadState.WAITING_RETRY,
    DownloadState.PROCESSING,
  )
}
