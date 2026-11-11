package com.vidorax.media.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import com.vidorax.media.MediaServices
import com.vidorax.media.R
import com.vidorax.media.engine.DownloadEngineApi
import com.vidorax.media.engine.SqliteDownloadStore
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

/**
 * H22 Home Widget (#456), what it shows: up to [MAX_ROWS] active downloads — running ones first, then waiting and
 * queued ones, then paused ones — each with its title, percentage (when the size is known) and status. Pure.
 */
internal object DownloadsWidgetContent {
  const val MAX_ROWS = 3

  enum class Status { DOWNLOADING, PROCESSING, QUEUED, WAITING_NETWORK, WAITING_RETRY, WAITING, PAUSED }

  data class Row(val id: String, val title: String?, val percent: Int?, val status: Status)

  /** Running, then waiting, then queued, then paused. */
  private val RANK = mapOf(
    Status.DOWNLOADING to 0,
    Status.PROCESSING to 0,
    Status.WAITING_NETWORK to 1,
    Status.WAITING_RETRY to 1,
    Status.WAITING to 1,
    Status.QUEUED to 2,
    Status.PAUSED to 3,
  )

  /** The widget's status of an engine state; null for a finished one (completed, failed, cancelled). */
  fun statusOf(state: DownloadState): Status? = when (state) {
    DownloadState.DOWNLOADING -> Status.DOWNLOADING
    DownloadState.PROCESSING -> Status.PROCESSING
    DownloadState.QUEUED, DownloadState.PROBING -> Status.QUEUED
    DownloadState.WAITING_NETWORK -> Status.WAITING_NETWORK
    DownloadState.WAITING_RETRY -> Status.WAITING_RETRY
    DownloadState.PAUSED -> Status.PAUSED
    DownloadState.COMPLETED, DownloadState.FAILED, DownloadState.CANCELLED -> null
    // A newer engine's state (a rule holding it, a recording) is still active: shown as waiting.
    else -> Status.WAITING
  }

  fun percentOf(bytesDone: Long, totalBytes: Long?): Int? {
    val total = totalBytes?.takeIf { it > 0 } ?: return null
    return ((bytesDone.coerceAtLeast(0) * 100) / total).toInt().coerceIn(0, 100)
  }

  /** [records] in the engine's order (newest first); the order within a group is kept. */
  fun of(records: List<DownloadRecord>): List<Row> = records
    .mapNotNull { record ->
      val status = statusOf(record.state) ?: return@mapNotNull null
      Row(record.id, record.title.trim().ifEmpty { null }, percentOf(record.bytesDone, record.totalBytes), status)
    }
    .withIndex()
    .sortedWith(compareBy({ RANK.getValue(it.value.status) }, { it.index }))
    .map { it.value }
    .take(MAX_ROWS)
}

/**
 * H22: refreshes the widget at most once every [minIntervalMs]. The first change after a quiet moment renders at
 * once; changes within the interval are folded into one render at its end, which reads the newest state. A change
 * that arrives while a render runs schedules one more. Fed only by state changes — never by progress ticks.
 */
internal class WidgetUpdates(
  private val scope: CoroutineScope,
  private val render: suspend () -> Unit,
  private val minIntervalMs: Long = MIN_INTERVAL_MS,
  private val now: () -> Long = System::currentTimeMillis,
  private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
  private val lock = Any()
  private var lastRenderAt: Long? = null
  private var scheduled: Job? = null
  private var dirty = false

  fun onStateChange() {
    synchronized(lock) {
      if (scheduled != null) {
        dirty = true
        return
      }
      scheduleLocked()
    }
  }

  private fun scheduleLocked() {
    val wait = lastRenderAt?.let { (it + minIntervalMs - now()).coerceAtLeast(0) } ?: 0L
    scheduled = scope.launch {
      if (wait > 0) sleep(wait)
      synchronized(lock) {
        lastRenderAt = now()
        dirty = false
      }
      try {
        render()
      } catch (c: kotlinx.coroutines.CancellationException) {
        throw c
      } catch (e: Exception) {
        // A widget that cannot be drawn now is drawn at the next change.
      } finally {
        synchronized(lock) {
          scheduled = null
          if (dirty) {
            dirty = false
            scheduleLocked()
          }
        }
      }
    }
  }

  companion object {
    const val MIN_INTERVAL_MS = 2_000L
  }
}

/** H22: the widget's views and its process-wide updates. */
internal object DownloadsWidget {
  private const val SCHEME_PASTE_LINK = "vidorax://paste-link"
  private const val SCHEME_DOWNLOADS = "vidorax://downloads"
  private const val REQUEST_PASTE = 4561
  private const val REQUEST_DOWNLOADS = 4562

  private val ROW_IDS = listOf(
    Triple(R.id.vidorax_widget_row0, R.id.vidorax_widget_row0_title, R.id.vidorax_widget_row0_status) to R.id.vidorax_widget_row0_progress,
    Triple(R.id.vidorax_widget_row1, R.id.vidorax_widget_row1_title, R.id.vidorax_widget_row1_status) to R.id.vidorax_widget_row1_progress,
    Triple(R.id.vidorax_widget_row2, R.id.vidorax_widget_row2_title, R.id.vidorax_widget_row2_status) to R.id.vidorax_widget_row2_progress,
  )

  /** Called once per process with the engine (DownloadEngineProvider): every state change may refresh the widget. */
  fun install(context: Context, engine: DownloadEngineApi, scope: CoroutineScope) {
    val app = context.applicationContext
    follow(engine.stateChanges, WidgetUpdates(scope, render = { renderAll(app) }), scope)
  }

  /** Only the engine's state changes reach the widget — its progress events never do. */
  fun follow(stateChanges: Flow<DownloadRecord>, updates: WidgetUpdates, scope: CoroutineScope): Job =
    scope.launch { stateChanges.collect { updates.onStateChange() } }

  /** Draws every placed widget from the engine's own records (its downloads table). Nothing when none is placed. */
  suspend fun renderAll(context: Context, ids: IntArray? = null) {
    val manager = AppWidgetManager.getInstance(context) ?: return
    val widgetIds = ids ?: manager.getAppWidgetIds(ComponentName(context, DownloadsWidgetProvider::class.java))
    if (widgetIds.isEmpty()) return
    val store = SqliteDownloadStore(MediaServices.get(context).database)
    val rows = DownloadsWidgetContent.of(store.list(System.currentTimeMillis()).map { it.toRecord() })
    manager.updateAppWidget(widgetIds, views(context, rows))
  }

  fun views(context: Context, rows: List<DownloadsWidgetContent.Row>): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.vidorax_widget_downloads)
    val openDownloads = linkIntent(context, SCHEME_DOWNLOADS, REQUEST_DOWNLOADS)
    views.setOnClickPendingIntent(R.id.vidorax_widget_header_title, openDownloads)
    views.setOnClickPendingIntent(R.id.vidorax_widget_empty, openDownloads)
    views.setOnClickPendingIntent(R.id.vidorax_widget_paste_link, linkIntent(context, SCHEME_PASTE_LINK, REQUEST_PASTE))
    views.setViewVisibility(R.id.vidorax_widget_empty, if (rows.isEmpty()) View.VISIBLE else View.GONE)
    for ((index, ids) in ROW_IDS.withIndex()) {
      val (container, title, status) = ids.first
      val row = rows.getOrNull(index)
      if (row == null) {
        views.setViewVisibility(container, View.GONE)
        continue
      }
      views.setViewVisibility(container, View.VISIBLE)
      views.setTextViewText(title, row.title ?: context.getString(R.string.vidorax_widget_untitled))
      views.setTextViewText(status, statusLine(context, row))
      views.setProgressBar(ids.second, 100, row.percent ?: 0, row.percent == null)
      views.setOnClickPendingIntent(container, openDownloads)
    }
    return views
  }

  private fun statusLine(context: Context, row: DownloadsWidgetContent.Row): String {
    val status = context.getString(
      when (row.status) {
        DownloadsWidgetContent.Status.DOWNLOADING -> R.string.vidorax_widget_status_downloading
        DownloadsWidgetContent.Status.PROCESSING -> R.string.vidorax_widget_status_processing
        DownloadsWidgetContent.Status.QUEUED -> R.string.vidorax_widget_status_queued
        DownloadsWidgetContent.Status.WAITING_NETWORK -> R.string.vidorax_widget_status_waiting_network
        DownloadsWidgetContent.Status.WAITING_RETRY -> R.string.vidorax_widget_status_waiting_retry
        DownloadsWidgetContent.Status.WAITING -> R.string.vidorax_widget_status_waiting
        DownloadsWidgetContent.Status.PAUSED -> R.string.vidorax_widget_status_paused
      },
    )
    val percent = row.percent ?: return status
    return context.getString(R.string.vidorax_widget_row_status, percent, status)
  }

  /** Opens the app at [link] (an expo-router route), like the "Paste link" app shortcut does. */
  private fun linkIntent(context: Context, link: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
