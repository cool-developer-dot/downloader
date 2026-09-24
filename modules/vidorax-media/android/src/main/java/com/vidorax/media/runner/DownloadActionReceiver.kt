package com.vidorax.media.runner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.vidorax.media.engine.DownloadEngineProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Pause / Resume / Retry / Cancel straight from the notification. Every one of them is the same engine call the
 * app's own buttons make, so the single-worker and generation guarantees are exactly the ones already tested;
 * nothing here touches a transfer directly.
 */
class DownloadActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(EXTRA_ID)?.takeIf { it.isNotBlank() } ?: return
    val action = intent.action ?: return
    if (action !in ACTIONS) return
    val app = context.applicationContext
    val pending = goAsync()
    CoroutineScope(Dispatchers.IO).launch {
      try {
        val engine = DownloadEngineProvider.get(app)
        // An action the state no longer allows (the user also tapped in the app) is not an error worth showing.
        runCatching {
          when (action) {
            ACTION_PAUSE -> engine.pause(id)
            ACTION_RESUME -> engine.resume(id)
            ACTION_RETRY -> engine.retry(id)
            ACTION_CANCEL -> engine.cancel(id)
            else -> Unit
          }
        }
      } finally {
        runCatching { pending.finish() }
      }
    }
  }

  companion object {
    const val ACTION_PAUSE = "com.vidorax.media.action.PAUSE"
    const val ACTION_RESUME = "com.vidorax.media.action.RESUME"
    const val ACTION_RETRY = "com.vidorax.media.action.RETRY"
    const val ACTION_CANCEL = "com.vidorax.media.action.CANCEL"
    const val EXTRA_ID = "downloadId"

    private val ACTIONS = setOf(ACTION_PAUSE, ACTION_RESUME, ACTION_RETRY, ACTION_CANCEL)

    internal fun actionName(action: DownloadNotificationContent.Action): String = when (action) {
      DownloadNotificationContent.Action.PAUSE -> ACTION_PAUSE
      DownloadNotificationContent.Action.RESUME -> ACTION_RESUME
      DownloadNotificationContent.Action.RETRY -> ACTION_RETRY
      DownloadNotificationContent.Action.CANCEL -> ACTION_CANCEL
    }
  }
}
