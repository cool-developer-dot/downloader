package com.vidorax.media.library

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import com.vidorax.media.R

/**
 * H23: keeps a long edit (a long trim, any conversion) running while VidoraX is in the background. It edits nothing
 * itself — [MediaEditor] does, as before; this only gives the process a foreground reason to stay alive and shows the
 * edit's progress with Cancel. Type `mediaProcessing` from Android 15 (API 35), `dataSync` (local file processing)
 * on Android 10–14, no type below. If Android refuses to start it, the edit simply runs as before (it may then be
 * stopped while VidoraX is in the background). Declared in the app's manifest.
 */
class MediaEditService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var title: String = ""

  private val poll = object : Runnable {
    override fun run() {
      val progress = MediaEditor.progress()
      if (progress == null) {
        // The edit ended (done, failed or cancelled): nothing left to keep alive.
        stopSelf()
        return
      }
      runCatching {
        getSystemService(NotificationManager::class.java)?.notify(MediaEditForeground.NOTIFICATION_ID, notification(progress))
      }
      handler.postDelayed(this, MediaEditForeground.POLL_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == MediaEditForeground.ACTION_CANCEL) {
      MediaEditor.cancel()
      return START_NOT_STICKY
    }
    title = intent?.getStringExtra(MediaEditForeground.EXTRA_TITLE).orEmpty()
    val started = runCatching {
      val type = MediaEditForeground.serviceType(Build.VERSION.SDK_INT)
      if (type != null) {
        startForeground(MediaEditForeground.NOTIFICATION_ID, notification(MediaEditor.progress()), type)
      } else {
        startForeground(MediaEditForeground.NOTIFICATION_ID, notification(MediaEditor.progress()))
      }
    }.onFailure { Log.w(TAG, "could not enter the foreground: ${it.javaClass.simpleName}") }.isSuccess
    if (!started) {
      stopSelf()
      return START_NOT_STICKY
    }
    handler.removeCallbacks(poll)
    handler.postDelayed(poll, MediaEditForeground.POLL_MS)
    // Never restarted by Android: an edit does not survive its process.
    return START_NOT_STICKY
  }

  /** Android 15+ limits both types' time; the system requires the service to stop when told. The edit goes on. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    Log.w(TAG, "foreground time for the edit expired")
    stopSelf()
  }

  override fun onDestroy() {
    handler.removeCallbacks(poll)
    runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
    super.onDestroy()
  }

  private fun notification(progress: Double?): Notification {
    MediaEditForeground.ensureChannel(this)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, MediaEditForeground.CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
    }
    val percent = progress?.let { (it * 100).toInt().coerceIn(0, 100) }
    builder
      .setContentTitle(getString(R.string.vidorax_edit_notification_title))
      .setContentText(title.ifBlank { null })
      .setSmallIcon(android.R.drawable.ic_menu_edit)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setProgress(100, percent ?: 0, percent == null)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      runCatching {
        PendingIntent.getActivity(this, OPEN_REQUEST, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      }.getOrNull()?.let(builder::setContentIntent)
    }
    MediaEditForeground.cancelIntent(this)?.let { cancel ->
      val icon = android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel)
      builder.addAction(Notification.Action.Builder(icon, getString(R.string.vidorax_edit_cancel), cancel).build())
    }
    return builder.build()
  }

  private companion object {
    const val TAG = "VidoraEdit"
    const val OPEN_REQUEST = 0x5649
  }
}

/** When an edit needs [MediaEditService], and starting it (it stops itself once the edit has ended). */
internal object MediaEditForeground {
  const val CHANNEL_ID = "vidorax_media_edits"
  /** Apart from the runner's summary, the data-limit notices and every download's id. */
  const val NOTIFICATION_ID = 0x563F
  const val ACTION_CANCEL = "com.vidorax.media.action.CANCEL_EDIT"
  const val EXTRA_TITLE = "title"
  const val POLL_MS = 500L

  /** A trim that keeps at least this much is "long"; shorter ones finish in moments. */
  const val LONG_TRIM_MS = 30_000L

  /** Conversions always (they read the whole file); a trim when it keeps [LONG_TRIM_MS] or more. */
  fun needsForeground(kind: EditKind, keptMs: Long): Boolean = kind != EditKind.TRIM || keptMs >= LONG_TRIM_MS

  /** `mediaProcessing` from API 35, `dataSync` on API 29–34, null (no type) below. */
  fun serviceType(sdk: Int): Int? = when {
    sdk >= 35 -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING
    sdk >= Build.VERSION_CODES.Q -> ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
    else -> null
  }

  /** True when the service was asked to start; false keeps today's behaviour (no foreground service). */
  fun start(context: Context, title: String): Boolean = runCatching {
    val intent = Intent(context, MediaEditService::class.java).putExtra(EXTRA_TITLE, title)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
    true
  }.onFailure { Log.w("VidoraEdit", "edit foreground service refused: ${it.javaClass.simpleName}") }.getOrDefault(false)

  fun cancelIntent(context: Context): PendingIntent? = runCatching {
    val intent = Intent(context, MediaEditService::class.java).setAction(ACTION_CANCEL)
    PendingIntent.getService(context, NOTIFICATION_ID, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }.getOrNull()

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    runCatching {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, context.getString(R.string.vidorax_edit_channel_name), NotificationManager.IMPORTANCE_LOW).apply {
          description = context.getString(R.string.vidorax_edit_channel_description)
          setShowBadge(false)
        },
      )
    }
  }
}
