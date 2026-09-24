package com.vidorax.media.runner

import com.vidorax.media.engine.DownloadEngineApi
import com.vidorax.media.model.DownloadProgress
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** The platform component that keeps the process transferring. Idempotent: [start] twice starts one component. */
internal interface RunnerHost {
  fun start(summary: RunnerSummaryContent)

  fun update(summary: RunnerSummaryContent)

  fun stop()
}

internal interface DownloadNotifier {
  fun show(content: DownloadNotificationContent)

  fun clear(downloadId: String)
}

/**
 * Turns the engine's persisted state into (a) whether the background host must be running and (b) what the
 * user sees. It never starts, stops or resumes a transfer: the engine stays the only authority over work, so
 * attaching the runner can never produce a second worker for an id.
 *
 * One live download is shown by the runner's own notification alone; a second one gives every live download
 * its own notification under an aggregate. Paused and finished downloads always keep their own.
 */
internal class DownloadRunner(
  private val host: RunnerHost,
  private val notifier: DownloadNotifier,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  private class Tracked(
    var state: DownloadState,
    var record: DownloadRecord,
    var bytesDone: Long,
    var totalBytes: Long?,
    var postedAt: Long,
    var postedPercent: Int?,
    /** From the engine's progress events; only meaningful while DOWNLOADING. */
    var speedBps: Long = 0L,
  )

  private val lock = Any()
  private val tracked = LinkedHashMap<String, Tracked>()

  /** Ids that currently have a notification of their own, so one is never left behind. */
  private val ownNotification = LinkedHashSet<String>()
  private var hostRunning = false

  /** Downloads the engine is working on, i.e. what the foreground host exists for. Paused work is not live. */
  fun hasLiveWork(): Boolean = synchronized(lock) { tracked.values.any { it.state in LIVE } }

  fun attach(engine: DownloadEngineApi, scope: CoroutineScope): Job = scope.launch {
    launch { engine.stateChanges.collect { onState(it) } }
    launch { engine.progress.collect { onProgress(it) } }
  }

  /**
   * Adopts the rows a previous process left behind, after the engine's own reconciliation. Re-posting the same
   * deterministic notification ids updates those notifications instead of duplicating them, and a second call
   * changes nothing.
   */
  fun restore(records: List<DownloadRecord>) {
    for (record in records) {
      if (record.state in TERMINAL) continue
      onState(record)
    }
    apply(Plan(host = synchronized(lock) { hostActionLocked() }))
  }

  fun onState(record: DownloadRecord) {
    val plan = synchronized(lock) {
      if (record.state in TERMINAL) {
        tracked.remove(record.id)
        // The finished notification is this download's own from here on: the runner stops managing it.
        ownNotification.remove(record.id)
        val content = notificationContentFor(record)
        val reconciled = reconcileLocked()
        Plan(
          show = reconciled.show + listOfNotNull(content),
          // A cancelled download simply disappears.
          clear = reconciled.clear + listOfNotNull(record.id.takeIf { content == null }),
          host = hostActionLocked(),
        )
      } else {
        // The record is authoritative: a 200 restart legitimately rewinds bytes, so never carry an older count forward.
        tracked[record.id]?.also {
          it.state = record.state
          it.record = record
          it.bytesDone = record.bytesDone
          it.totalBytes = record.totalBytes
          // A speed belongs to bytes moving now: waiting, paused or finishing up shows none.
          if (record.state != DownloadState.DOWNLOADING) it.speedBps = 0L
        } ?: Tracked(
          state = record.state,
          record = record,
          bytesDone = record.bytesDone,
          totalBytes = record.totalBytes,
          postedAt = 0,
          postedPercent = null,
        ).also { tracked[record.id] = it }
        markPostedLocked(record.id)
        val reconciled = reconcileLocked()
        // Refresh this download's own notification too, unless the reconciliation has just posted it.
        val own = tracked[record.id]
          ?.takeIf { record.id in ownNotification && reconciled.show.none { shown -> shown.downloadId == record.id } }
          ?.let { contentOf(it) }
        Plan(
          show = reconciled.show + listOfNotNull(own),
          clear = reconciled.clear,
          host = hostActionLocked(),
        )
      }
    }
    apply(plan)
  }

  fun onProgress(progress: DownloadProgress) {
    val plan = synchronized(lock) {
      val entry = tracked[progress.id] ?: return
      entry.bytesDone = progress.bytesDone
      entry.totalBytes = progress.totalBytes ?: entry.totalBytes
      entry.speedBps = progress.speedBps
      val next = contentOf(entry) ?: return
      val now = clock()
      // The engine already throttles; this only keeps the system's notification rate limit out of reach.
      if (now - entry.postedAt < MIN_POST_INTERVAL_MS && next.percent == entry.postedPercent) return
      entry.postedAt = now
      entry.postedPercent = next.percent
      Plan(
        show = listOfNotNull(next.takeIf { progress.id in ownNotification }),
        host = if (entry.state in LIVE) hostActionLocked() else HostAction {},
      )
    }
    apply(plan)
  }

  private fun apply(plan: Plan) {
    plan.clear.forEach(notifier::clear)
    plan.show.forEach(notifier::show)
    plan.host.run()
  }

  private class Plan(
    val show: List<DownloadNotificationContent> = emptyList(),
    val clear: List<String> = emptyList(),
    val host: HostAction,
  )

  private class Reconciled(val show: List<DownloadNotificationContent>, val clear: List<String>)

  /**
   * Decides which downloads need a notification of their own right now, and returns the ones that must be
   * posted or taken away. A download that is the only live one is shown by the runner's notification instead.
   */
  private fun reconcileLocked(): Reconciled {
    val live = tracked.values.count { it.state in LIVE }
    val wanted = tracked.filterValues { it.state !in LIVE || live > 1 }.keys
    val add = wanted - ownNotification
    val drop = ownNotification - wanted
    ownNotification.removeAll(drop)
    ownNotification.addAll(add)
    for (id in add) {
      markPostedLocked(id)
    }
    return Reconciled(
      show = add.mapNotNull { id -> tracked[id]?.let { contentOf(it) } },
      clear = drop.toList(),
    )
  }

  private fun markPostedLocked(id: String) {
    val entry = tracked[id] ?: return
    entry.postedAt = clock()
    entry.postedPercent = contentOf(entry)?.percent
  }

  private fun contentOf(entry: Tracked): DownloadNotificationContent? =
    notificationContentFor(entry.record, entry.bytesDone, entry.totalBytes, entry.speedBps)

  /** Decided under the lock, run outside it: the host talks to the platform and may call back in. */
  private fun interface HostAction {
    fun run()
  }

  private fun hostActionLocked(): HostAction {
    val summary = summaryLocked()
    return when {
      summary.activeCount > 0 && !hostRunning -> {
        hostRunning = true
        HostAction { host.start(summary) }
      }
      summary.activeCount > 0 -> HostAction { host.update(summary) }
      hostRunning -> {
        hostRunning = false
        HostAction { host.stop() }
      }
      else -> HostAction {}
    }
  }

  private fun summaryLocked(): RunnerSummaryContent {
    val live = tracked.values.filter { it.state in LIVE }
    val paused = tracked.values.count { it.state == DownloadState.PAUSED }
    if (live.isEmpty()) {
      return RunnerSummaryContent.IDLE.copy(pausedCount = paused)
    }
    val single = live.singleOrNull()?.let { contentOf(it) }
    if (single != null) {
      return singleSummaryContent(single, paused)
    }
    val total = live.mapNotNull { it.totalBytes }.takeIf { it.size == live.size }?.sum()
    return aggregateSummaryContent(
      activeCount = live.size,
      pausedCount = paused,
      bytesDone = live.sumOf { it.bytesDone },
      totalBytes = total,
      speedBps = live.sumOf { if (it.state == DownloadState.DOWNLOADING) it.speedBps else 0L },
    )
  }

  private companion object {
    const val MIN_POST_INTERVAL_MS = 700L

    val TERMINAL = setOf(DownloadState.COMPLETED, DownloadState.FAILED, DownloadState.CANCELLED)

    /** States in which the engine holds a worker or is waiting to run one; the host must survive all of them. */
    val LIVE = setOf(
      DownloadState.QUEUED,
      DownloadState.PROBING,
      DownloadState.DOWNLOADING,
      DownloadState.WAITING_NETWORK,
      DownloadState.WAITING_RETRY,
      DownloadState.PROCESSING,
    )
  }
}
