/**
 * Per-download Android notifications via NotificationManager.
 *
 * NOT a foreground service — optional presentation only.
 * Stable notification ids from JS. Payload carries downloadId only (no paths).
 */
package com.anonymous.vidorax.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.anonymous.vidorax.MainActivity
import com.anonymous.vidorax.R
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = VidoraDownloadNotificationsModule.NAME)
class VidoraDownloadNotificationsModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  companion object {
    const val NAME = "VidoraDownloadNotifications"
    const val CHANNEL_ID = "vidorax_download_events"
    private const val CHANNEL_NAME = "Download updates"
  }

  @ReactMethod
  fun ensureChannels(promise: Promise) {
    try {
      ensureChannelInternal()
      promise.resolve(true)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  /**
   * Upsert sticky/progress notification for one download.
   * progressPercent: 0–100 when determinate; ignored when indeterminate=true.
   */
  @ReactMethod
  fun upsertProgress(
    downloadId: String,
    notificationId: Double,
    title: String,
    body: String,
    progressPercent: Double?,
    indeterminate: Boolean,
    sticky: Boolean,
    promise: Promise,
  ) {
    try {
      val id = sanitizeDownloadId(downloadId) ?: run {
        promise.reject("INVALID_ID", "Invalid downloadId")
        return
      }
      ensureChannelInternal()
      val notifId = notificationId.toInt()
      val builder = baseBuilder(title, body, id)
        .setOngoing(sticky)
        .setOnlyAlertOnce(true)
        .setAutoCancel(!sticky)

      if (indeterminate) {
        builder.setProgress(0, 0, true)
      } else {
        val pct = ((progressPercent ?: 0.0).toInt()).coerceIn(0, 100)
        builder.setProgress(100, pct, false)
      }

      notifySafe(notifId, builder.build())
      promise.resolve(true)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun notifyTerminal(
    downloadId: String,
    notificationId: Double,
    title: String,
    body: String,
    promise: Promise,
  ) {
    try {
      val id = sanitizeDownloadId(downloadId) ?: run {
        promise.reject("INVALID_ID", "Invalid downloadId")
        return
      }
      ensureChannelInternal()
      val notifId = notificationId.toInt()
      val builder = baseBuilder(title, body, id)
        .setOngoing(false)
        .setAutoCancel(true)
        .setOnlyAlertOnce(false)
        .setProgress(0, 0, false)

      notifySafe(notifId, builder.build())
      promise.resolve(true)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun dismiss(notificationId: Double, promise: Promise) {
    try {
      val nm = NotificationManagerCompat.from(reactContext)
      nm.cancel(notificationId.toInt())
      promise.resolve(true)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  private fun ensureChannelInternal() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager =
      reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val existing = manager.getNotificationChannel(CHANNEL_ID)
    if (existing != null) {
      return
    }
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  private fun baseBuilder(
    title: String,
    body: String,
    downloadId: String,
  ): NotificationCompat.Builder {
    val pending = contentPendingIntent(downloadId)
    return NotificationCompat.Builder(reactContext, CHANNEL_ID)
      .setSmallIcon(R.drawable.notification_icon)
      .setContentTitle(sanitizeText(title, "Download"))
      .setContentText(sanitizeText(body, ""))
      .setContentIntent(pending)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
  }

  private fun contentPendingIntent(downloadId: String): PendingIntent {
    // Deep link into Expo Router — downloadId only, never filesystem paths.
    val uri = Uri.parse("vidorax://downloads/${Uri.encode(downloadId)}")
    val intent = Intent(Intent.ACTION_VIEW, uri).apply {
      setClass(reactContext, MainActivity::class.java)
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      putExtra("downloadId", downloadId)
      putExtra("type", "DOWNLOAD_DETAILS")
    }
    val flags =
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    // Unique request code per download id hash keeps PendingIntents distinct.
    val requestCode = downloadId.hashCode()
    return PendingIntent.getActivity(reactContext, requestCode, intent, flags)
  }

  private fun notifySafe(id: Int, notification: android.app.Notification) {
    val nm = NotificationManagerCompat.from(reactContext)
    if (Build.VERSION.SDK_INT >= 33) {
      // Permission may be denied — NotificationManagerCompat no-ops safely when blocked.
      nm.notify(id, notification)
    } else {
      nm.notify(id, notification)
    }
  }

  private fun sanitizeDownloadId(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.length < 8 || trimmed.length > 128) {
      return null
    }
    if (trimmed.contains('/') || trimmed.contains("://") || trimmed.contains('?')) {
      return null
    }
    if (!trimmed.matches(Regex("^[A-Za-z0-9_-]+$"))) {
      return null
    }
    return trimmed
  }

  private fun sanitizeText(value: String, fallback: String): String {
    val trimmed = value.trim()
    if (trimmed.isEmpty()) {
      return fallback
    }
    if (trimmed.contains("://") || trimmed.startsWith("http", ignoreCase = true)) {
      return fallback
    }
    return if (trimmed.length > 120) trimmed.take(119) + "…" else trimmed
  }
}
