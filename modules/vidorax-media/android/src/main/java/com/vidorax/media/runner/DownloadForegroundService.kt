package com.vidorax.media.runner

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log

/**
 * Keeps downloads running while the app is backgrounded on Android 13 and below (and wherever a user-initiated
 * transfer job is refused). It performs no transfer itself: the engine's workers own that, this service only
 * gives the process a foreground reason to stay alive and shows the ongoing notification.
 */
class DownloadForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = BackgroundDownloads.summaryNotification(this)
    val started = runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(SUMMARY_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(SUMMARY_NOTIFICATION_ID, notification)
      }
    }.onFailure { Log.w(TAG, "could not enter the foreground: ${it.javaClass.simpleName}") }.isSuccess
    if (!started) {
      stopSelf()
      return START_NOT_STICKY
    }
    // Android may have restarted us into a fresh process: rebuilding the engine re-queues interrupted downloads,
    // and its restore is idempotent, so no id ever gets a second worker.
    BackgroundDownloads.ensureEngine(applicationContext)
    return START_STICKY
  }

  /** Android 15+ caps dataSync time; the system requires the service to stop itself when told. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    Log.w(TAG, "dataSync foreground time expired; stopping the runner")
    stopSelf()
  }

  override fun onDestroy() {
    runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
    super.onDestroy()
  }

  private companion object {
    const val TAG = "VidoraDownloads"
  }
}
