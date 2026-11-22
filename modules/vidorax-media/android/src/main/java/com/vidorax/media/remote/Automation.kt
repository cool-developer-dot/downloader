package com.vidorax.media.remote

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.vidorax.media.engine.DownloadEngineApi
import com.vidorax.media.engine.DownloadEngineProvider
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** #499 "Allow other apps to control downloads": off by default; nothing below runs while it is off. */
object AutomationSettings {
  private const val KEY = "allow_other_apps"

  fun allowed(context: Context): Boolean =
    context.applicationContext.getSharedPreferences(RemotePrefs.FILE, Context.MODE_PRIVATE).getBoolean(KEY, false)

  fun setAllowed(context: Context, allowed: Boolean) {
    context.applicationContext.getSharedPreferences(RemotePrefs.FILE, Context.MODE_PRIVATE).edit().putBoolean(KEY, allowed).apply()
  }
}

/**
 * #499 Automation API: the intents Tasker, Automate, MacroDroid or any app may send (as a broadcast to this app's
 * package, see docs/AUTOMATION.md):
 * - `com.vidorax.action.ADD_DOWNLOAD` with the link in the `url` extra (or `android.intent.extra.TEXT`, or the
 *   intent's data) — checked by the app's Batch Add path like a pasted link, as soon as VidoraX is running;
 * - `com.vidorax.action.PAUSE_ALL` / `com.vidorax.action.RESUME_ALL`.
 * Every intent is ignored unless the user turned on "Allow other apps to control downloads".
 */
class AutomationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action !in ACTIONS) return
    val app = context.applicationContext
    if (!AutomationSettings.allowed(app)) {
      Log.i(TAG, "ignored ${action.substringAfterLast('.')}: other apps may not control downloads")
      return
    }
    when (action) {
      ACTION_ADD_DOWNLOAD -> {
        val url = linkFrom(intent)
        if (url == null) {
          Log.i(TAG, "ADD_DOWNLOAD without an http(s) link")
          return
        }
        if (RemoteComponents.get(app).inbox.submit(url, LinkSource.AUTOMATION) == null) {
          Log.w(TAG, "ADD_DOWNLOAD dropped: too many links are waiting")
        }
      }
      ACTION_PAUSE_ALL, ACTION_RESUME_ALL -> {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
          try {
            val engine = DownloadEngineProvider.get(app)
            runCatching { if (action == ACTION_PAUSE_ALL) engine.pauseAll() else engine.resumeAll() }
          } finally {
            runCatching { pending.finish() }
          }
        }
      }
    }
  }

  companion object {
    const val ACTION_ADD_DOWNLOAD = "com.vidorax.action.ADD_DOWNLOAD"
    const val ACTION_PAUSE_ALL = "com.vidorax.action.PAUSE_ALL"
    const val ACTION_RESUME_ALL = "com.vidorax.action.RESUME_ALL"
    const val EXTRA_URL = "url"

    private const val TAG = "VidoraAutomation"
    private val ACTIONS = setOf(ACTION_ADD_DOWNLOAD, ACTION_PAUSE_ALL, ACTION_RESUME_ALL)

    /** The link of an ADD_DOWNLOAD intent: `url`, else the shared text, else the data URI. */
    fun linkFrom(intent: Intent): String? {
      val candidates = listOf(
        intent.getStringExtra(EXTRA_URL),
        intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()?.split(Regex("\\s+"))?.firstOrNull { it.startsWith("http", ignoreCase = true) },
        intent.dataString,
      )
      return candidates.firstNotNullOfOrNull { LinkRules.acceptable(it) }
    }
  }
}

/**
 * #499: `com.vidorax.action.DOWNLOAD_COMPLETE` when a download finishes, with only its `id` and `title` — never a
 * URL or a file path. Sent (to any app listening) only while "Allow other apps to control downloads" is on.
 */
object AutomationEvents {
  const val ACTION_DOWNLOAD_COMPLETE = "com.vidorax.action.DOWNLOAD_COMPLETE"
  const val EXTRA_ID = "id"
  const val EXTRA_TITLE = "title"

  private const val REMEMBERED = 64
  private val announced = LinkedHashSet<String>()

  /** Called once, where the engine is built, so completions while no JavaScript runs are announced too. */
  fun attach(context: Context, engine: DownloadEngineApi, scope: CoroutineScope) {
    val app = context.applicationContext
    scope.launch {
      engine.stateChanges.collect { record ->
        if (shouldAnnounce(record) && AutomationSettings.allowed(app)) {
          runCatching { app.sendBroadcast(completionIntent(record)) }
        }
      }
    }
  }

  fun completionIntent(record: DownloadRecord): Intent = Intent(ACTION_DOWNLOAD_COMPLETE)
    .putExtra(EXTRA_ID, record.id)
    .putExtra(EXTRA_TITLE, record.title)

  /** Each finished download once, even if its COMPLETED state is reported again. */
  @Synchronized
  fun shouldAnnounce(record: DownloadRecord): Boolean {
    if (record.state != DownloadState.COMPLETED) return false
    if (!announced.add(record.id)) return false
    while (announced.size > REMEMBERED) announced.remove(announced.first())
    return true
  }
}
