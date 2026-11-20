package com.vidorax.media.watch

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import com.vidorax.media.engine.DownloadEngineProvider
import com.vidorax.media.net.HttpClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray

/**
 * The process-wide watched links (#362, #504, #363): the store, the runner, and the hourly job that checks the links
 * that are due — also with the app closed and after a reboot (a persisted JobScheduler job, any network). No link, no
 * job.
 */
object Watches {
  private const val JOB_ID = 0x5650
  private const val PERIOD_MS = 60L * 60 * 1000

  @Volatile private var runnerInstance: WatchRunner? = null
  @Volatile private var storeInstance: WatchStore? = null

  internal fun store(context: Context): WatchStore =
    storeInstance ?: synchronized(this) {
      storeInstance ?: WatchStore(WatchStore.Storage.preferences(context)).also { storeInstance = it }
    }

  internal fun runner(context: Context): WatchRunner =
    runnerInstance ?: synchronized(this) {
      runnerInstance ?: run {
        val app = context.applicationContext
        WatchRunner(
          store = store(app),
          checker = LinkChecker(HttpClient.create()),
          enqueue = { request -> DownloadEngineProvider.get(app).enqueueUnique(request) },
          rules = { BulkRules.load(app) },
          notify = { link, what -> WatchNotifications.post(app, link, what) },
        ).also { runnerInstance = it }
      }
    }

  /** Every watched link as JSON, for the app. */
  fun listJson(context: Context): String = JSONArray().apply { store(context).list().forEach { put(it.toJson()) } }.toString()

  /**
   * Adds [url] (its kind found by a first look when [kind] is null) and records what it shows now, so only later
   * changes count. Returns the link as JSON, or an error code: `full` (100 links), `unreachable` (no answer, or not found).
   */
  suspend fun add(context: Context, url: String, kind: String?, intervalHours: Int, autoDownload: Boolean): String {
    val first = LinkChecker(HttpClient.create()).check(url, WatchKind.fromWire(kind))
    if (first.status != "ok") return "unreachable"
    val resolvedKind = WatchKind.fromWire(kind) ?: first.kind ?: WatchKind.PAGE
    val now = System.currentTimeMillis()
    val link = WatchRunner.newLink(url, resolvedKind, first.title, intervalHours.coerceIn(1, 24 * 30), autoDownload, now).copy(
      fingerprint = first.fingerprint,
      lastCheckedAt = now,
      lastStatus = first.status,
      items = first.items.take(WatchedLink.MAX_ITEMS),
    )
    val added = store(context).add(link) ?: return "full"
    schedule(context)
    return added.toJson().toString()
  }

  fun update(context: Context, id: String, intervalHours: Int?, autoDownload: Boolean?): String? =
    store(context).update(id) {
      it.copy(intervalHours = intervalHours?.coerceIn(1, 24 * 30) ?: it.intervalHours, autoDownload = autoDownload ?: it.autoDownload)
    }?.toJson()?.toString()

  fun remove(context: Context, id: String): Boolean = store(context).remove(id).also { schedule(context) }

  suspend fun checkNow(context: Context, id: String): String? = runner(context).checkNow(id)?.link?.toJson()?.toString()

  /** Keeps the hourly job scheduled while any link is watched; cancels it when none is. */
  fun schedule(context: Context) {
    val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
    if (store(context).list().isEmpty()) {
      runCatching { scheduler.cancel(JOB_ID) }
      return
    }
    if (scheduler.allPendingJobs.any { it.id == JOB_ID }) return
    val info = JobInfo.Builder(JOB_ID, ComponentName(context, WatchJobService::class.java))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
      .setPeriodic(PERIOD_MS)
      .setPersisted(true)
      .build()
    runCatching { scheduler.schedule(info) }
  }
}

/** The hourly job of [Watches]: checks the due links, then lets the system sleep again. */
class WatchJobService : JobService() {
  private var worker: Job? = null

  override fun onStartJob(params: JobParameters): Boolean {
    worker = CoroutineScope(Dispatchers.IO).launch {
      try {
        Watches.runner(applicationContext).runDue()
      } finally {
        jobFinished(params, false)
      }
    }
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean {
    worker?.cancel()
    worker = null
    return true
  }
}
