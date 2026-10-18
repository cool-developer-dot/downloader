package com.vidorax.media.runner

import android.app.NotificationManager
import android.content.Context

/**
 * The app's "Download notifications" setting, as the native runner applies it (JavaScript pushes it with
 * `setDownloadNotificationsEnabled`; kept in SharedPreferences `vidorax_download_notifications`, so a download that
 * resumes before any JavaScript runs obeys it too). On by default, as the setting is.
 *
 * Off:
 * - no notification of a download's own is posted — finished, failed, paused, or one of several running;
 * - the one notification Android requires while downloads run (the foreground service's / user-initiated job's,
 *   [SUMMARY_NOTIFICATION_ID]) is never removed: it is only minimized (its display deferred on Android 12+, silent
 *   and low-importance as always).
 */
internal object DownloadNotificationsToggle {
  private const val PREFS = "vidorax_download_notifications"
  private const val KEY = "enabled"

  @Volatile
  private var cached: Boolean? = null

  fun isEnabled(context: Context): Boolean =
    cached ?: runCatching { prefs(context).getBoolean(KEY, true) }.getOrDefault(true).also { cached = it }

  /** Remembers the setting; turning it off also takes away the per-download notifications already shown. */
  fun setEnabled(context: Context, enabled: Boolean) {
    cached = enabled
    runCatching { prefs(context).edit().putBoolean(KEY, enabled).apply() }
    if (!enabled) clearDownloadNotifications(context)
  }

  /** Pure: whether a download's own notification may be posted. */
  fun postsOwnNotifications(enabled: Boolean): Boolean = enabled

  /** Every per-download notification (their ids are a range of their own); the required one and app notices stay. */
  fun clearDownloadNotifications(context: Context) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    runCatching {
      manager.activeNotifications
        .map { it.id }
        .filter(::isDownloadNotificationId)
        .forEach(manager::cancel)
    }
  }

  fun isDownloadNotificationId(id: Int): Boolean =
    id >= DOWNLOAD_NOTIFICATION_ID_BASE && id < DOWNLOAD_NOTIFICATION_ID_BASE + DOWNLOAD_NOTIFICATION_ID_SPAN

  internal fun resetForTests() {
    cached = null
  }

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/** What the runner posts per download, gated by the "Download notifications" setting; clearing always goes through. */
internal class ToggledNotifier(
  private val delegate: DownloadNotifier,
  private val enabled: () -> Boolean,
) : DownloadNotifier {
  override fun show(content: DownloadNotificationContent) {
    if (DownloadNotificationsToggle.postsOwnNotifications(enabled())) delegate.show(content)
  }

  override fun clear(downloadId: String) = delegate.clear(downloadId)
}
