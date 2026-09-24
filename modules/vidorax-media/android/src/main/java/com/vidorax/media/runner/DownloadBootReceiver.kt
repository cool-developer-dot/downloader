package com.vidorax.media.runner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Picks downloads back up after the device restarts. A reboot kills the process and every job with it, so
 * without this a download that was running at shutdown would sit untouched until the user opened the app.
 *
 * It starts nothing when nothing was running: a paused download stays paused, and a device that has no
 * unfinished downloads never sees a notification.
 */
class DownloadBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in ACTIONS) return
    val app = context.applicationContext
    val pending = goAsync()
    // The broadcast window is also what allows the foreground service to start, so the work happens here.
    CoroutineScope(Dispatchers.IO).launch {
      try {
        if (BackgroundDownloads.hasUnfinishedWork(app)) {
          BackgroundDownloads.resumeAfterBoot(app)
        }
      } finally {
        runCatching { pending.finish() }
      }
    }
  }

  private companion object {
    val ACTIONS = setOf(
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_LOCKED_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
    )
  }
}
