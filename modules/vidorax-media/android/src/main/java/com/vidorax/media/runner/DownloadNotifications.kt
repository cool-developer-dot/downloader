package com.vidorax.media.runner

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log

/**
 * Posts the download notifications. Everything shown comes from the persisted record — title, state, byte
 * counts — so no media URL, signed token or request header can reach the lock screen.
 *
 * When the user denies (or turns off) notifications nothing is posted and no error is raised: the transfer is
 * unaffected, and the app's own Downloads screen stays the truthful view of progress.
 */
internal class DownloadNotifications(private val context: Context) : DownloadNotifier {
  private val manager: NotificationManager? = context.getSystemService(NotificationManager::class.java)

  @Volatile
  private var channelsReady = false

  override fun show(content: DownloadNotificationContent) {
    val manager = manager ?: return
    if (!canPost()) return
    ensureChannels()
    runCatching { manager.notify(notificationIdFor(content.downloadId), build(content)) }
      .onFailure { Log.w(TAG, "notification refused: ${it.javaClass.simpleName}") }
  }

  override fun clear(downloadId: String) {
    runCatching { manager?.cancel(notificationIdFor(downloadId)) }
  }

  fun clearSummary() {
    runCatching { manager?.cancel(SUMMARY_NOTIFICATION_ID) }
  }

  /** True when the notification was actually posted; the caller reports honestly when it was not. */
  fun showSummary(summary: RunnerSummaryContent): Boolean {
    val manager = manager ?: return false
    if (!canPost()) return false
    ensureChannels()
    return runCatching { manager.notify(SUMMARY_NOTIFICATION_ID, buildSummary(summary)) }
      .onFailure { Log.w(TAG, "runner notification refused: ${it.javaClass.simpleName}") }
      .isSuccess
  }

  fun canPost(): Boolean {
    val manager = manager ?: return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    return runCatching { manager.areNotificationsEnabled() }.getOrDefault(true)
  }

  fun build(content: DownloadNotificationContent): Notification {
    ensureChannels()
    val channel = when (content.kind) {
      DownloadNotificationContent.Kind.ACTIVE, DownloadNotificationContent.Kind.PAUSED -> CHANNEL_PROGRESS
      DownloadNotificationContent.Kind.COMPLETED, DownloadNotificationContent.Kind.FAILED -> CHANNEL_STATUS
    }
    val builder = builder(channel)
      .setContentTitle(content.title)
      .setContentText(content.text)
      .setSmallIcon(iconFor(content.kind))
      .setOngoing(content.ongoing)
      .setOnlyAlertOnce(true)
      .setContentIntent(openApp(content.target))
    when (content.kind) {
      DownloadNotificationContent.Kind.ACTIVE, DownloadNotificationContent.Kind.PAUSED ->
        if (content.showProgress) {
          builder.setProgress(100, content.percent ?: 0, content.indeterminate)
        }
      DownloadNotificationContent.Kind.COMPLETED, DownloadNotificationContent.Kind.FAILED ->
        builder.setAutoCancel(true)
    }
    addActions(builder, content.downloadId, content.actions)
    return builder.build()
  }

  fun buildSummary(summary: RunnerSummaryContent): Notification {
    ensureChannels()
    // Deliberately not a group summary: removing one would take every download notification with it, and the
    // runner's notification is removed the moment the last transfer ends.
    val builder = builder(CHANNEL_PROGRESS)
      .setContentTitle(summary.title)
      .setContentText(summary.text)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(openApp(DownloadNotificationContent.Target.DOWNLOADS))
      .setProgress(100, summary.percent ?: 0, summary.indeterminate)
    // With one live download this notification *is* that download, so it carries its buttons too.
    summary.downloadId?.let { addActions(builder, it, summary.actions) }
    return builder.build()
  }

  private fun addActions(
    builder: Notification.Builder,
    downloadId: String,
    actions: List<DownloadNotificationContent.Action>,
  ) {
    for (action in actions) {
      val intent = actionIntent(downloadId, action) ?: continue
      // A null icon is dropped by the system UI on some versions, so every button carries a platform icon.
      val icon = android.graphics.drawable.Icon.createWithResource(context, iconFor(action))
      builder.addAction(Notification.Action.Builder(icon, action.label, intent).build())
    }
  }

  private fun iconFor(action: DownloadNotificationContent.Action): Int = when (action) {
    DownloadNotificationContent.Action.PAUSE -> android.R.drawable.ic_media_pause
    DownloadNotificationContent.Action.RESUME -> android.R.drawable.ic_media_play
    DownloadNotificationContent.Action.RETRY -> android.R.drawable.ic_popup_sync
    DownloadNotificationContent.Action.CANCEL -> android.R.drawable.ic_menu_close_clear_cancel
  }

  private fun builder(channelId: String): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, channelId)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)
    }

  private fun iconFor(kind: DownloadNotificationContent.Kind): Int = when (kind) {
    DownloadNotificationContent.Kind.COMPLETED -> android.R.drawable.stat_sys_download_done
    DownloadNotificationContent.Kind.FAILED -> android.R.drawable.stat_notify_error
    else -> android.R.drawable.stat_sys_download
  }

  /**
   * Opens the screen the notification is about — Downloads for a transfer, Library for a finished video —
   * through the app's own `vidorax://` links, and falls back to simply launching the app when a build has no
   * activity for that link.
   */
  private fun openApp(target: DownloadNotificationContent.Target): PendingIntent? {
    val deepLink = when (target) {
      DownloadNotificationContent.Target.DOWNLOADS -> DEEP_LINK_DOWNLOADS
      DownloadNotificationContent.Target.LIBRARY -> DEEP_LINK_LIBRARY
    }
    val intent = viewIntent(deepLink) ?: context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return runCatching {
      PendingIntent.getActivity(context, target.ordinal, intent, immutableFlags(PendingIntent.FLAG_UPDATE_CURRENT))
    }.getOrNull()
  }

  private fun viewIntent(uri: String): Intent? {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(context.packageName)
    val resolves = runCatching { intent.resolveActivity(context.packageManager) != null }.getOrDefault(false)
    return intent.takeIf { resolves }
  }

  private fun actionIntent(downloadId: String, action: DownloadNotificationContent.Action): PendingIntent? {
    val intent = Intent(context, DownloadActionReceiver::class.java)
      .setAction(DownloadActionReceiver.actionName(action))
      .putExtra(DownloadActionReceiver.EXTRA_ID, downloadId)
    // One request code per download and action, so two downloads never share a pending intent.
    val requestCode = notificationIdFor(downloadId) + action.ordinal + 1
    return runCatching {
      PendingIntent.getBroadcast(context, requestCode, intent, immutableFlags(PendingIntent.FLAG_UPDATE_CURRENT))
    }.getOrNull()
  }

  private fun immutableFlags(base: Int): Int =
    base or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

  private fun ensureChannels() {
    if (channelsReady || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = manager ?: return
    synchronized(this) {
      if (channelsReady) return
      runCatching {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_PROGRESS, "Downloads in progress", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shows videos VidoraX is downloading."
            setShowBadge(false)
          },
        )
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_STATUS, "Finished downloads", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Tells you when a download finishes or fails."
          },
        )
      }
      channelsReady = true
    }
  }

  companion object {
    private const val TAG = "VidoraDownloads"
    const val CHANNEL_PROGRESS = "vidorax_downloads_progress"
    const val CHANNEL_STATUS = "vidorax_downloads_status"
    const val DEEP_LINK_DOWNLOADS = "vidorax://downloads"
    const val DEEP_LINK_LIBRARY = "vidorax://library"
  }
}
