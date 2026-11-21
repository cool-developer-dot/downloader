package com.vidorax.media.runner

import android.app.ActivityManager
import android.content.Context
import com.vidorax.media.engine.DownloadEngineProvider

/**
 * #358 "Exit when done": when every download has finished and VidoraX is not on screen, its task is closed (it
 * leaves Recents), as if the user had swiped it away. Nothing happens while the user is looking at the app, while a
 * download is paused (it is not done), or when the setting is off.
 */
internal object ExitWhenDone {
  fun maybeExit(context: Context) {
    if (!DownloadEngineProvider.exitWhenDone(context)) return
    if (isInForeground()) return
    runCatching {
      context.getSystemService(ActivityManager::class.java)?.appTasks?.forEach { it.finishAndRemoveTask() }
    }
  }

  private fun isInForeground(): Boolean = runCatching {
    val state = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(state)
    state.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }.getOrDefault(true)
}
