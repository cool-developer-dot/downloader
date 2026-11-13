package com.vidorax.web.window

import android.app.Activity
import android.content.Context
import android.content.Intent
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArrayList

/**
 * B20 #16: opens [BrowserWindowActivity] windows and carries what happens in them back to JS (`onBrowserWindow`):
 *
 * - `visit` — a page finished loading (JS records it in the profile's history, as for a tab);
 * - `closed` — the user closed the window (JS keeps it for Reopen closed tab);
 * - `returned` — the tab goes back into the main window, in front (`foreground`) or behind the current tab (the window
 *   closed itself because App Lock is on and the user left it);
 * - `openInApp` — a link or download the window doesn't handle, opened in a new tab of the main window.
 *
 * Events that happen while JS isn't listening wait (at most [MAX_PENDING]) until it is.
 */
internal object BrowserWindows {
  fun interface Listener {
    fun onEvent(event: Map<String, Any?>)
  }

  private const val MAX_PENDING = 20

  @Volatile private var listener: Listener? = null
  private val pending = ConcurrentLinkedQueue<Map<String, Any?>>()
  private val open = CopyOnWriteArrayList<WeakReference<BrowserWindowActivity>>()

  fun setListener(value: Listener?) {
    listener = value
    if (value != null) {
      while (true) {
        val event = pending.poll() ?: break
        value.onEvent(event)
      }
    }
  }

  fun emit(type: String, request: BrowserWindowRequest, url: String, title: String, foreground: Boolean = false) {
    val event = mapOf(
      "type" to type,
      "windowId" to request.windowId,
      "profile" to request.profile,
      "url" to url,
      "title" to title,
      "foreground" to foreground,
    )
    val current = listener
    if (current != null) {
      current.onEvent(event)
      return
    }
    pending.add(event)
    while (pending.size > MAX_PENDING) pending.poll()
  }

  /** Main thread. A new task of its own, next to the app in split screen; false when Android can't start it. */
  fun open(context: Context, activity: Activity?, request: BrowserWindowRequest): Boolean {
    val intent = request.writeTo(Intent(context, BrowserWindowActivity::class.java))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT or Intent.FLAG_ACTIVITY_MULTIPLE_TASK or Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT)
    return try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
      true
    } catch (_: RuntimeException) {
      false
    }
  }

  fun register(window: BrowserWindowActivity) {
    open.removeAll { it.get() == null }
    open.add(WeakReference(window))
  }

  fun unregister(window: BrowserWindowActivity) {
    open.removeAll { it.get() == null || it.get() === window }
  }

  /** Main thread. Closes the windows of one browser profile (before it is deleted, or when guest mode ends). */
  fun closeProfile(profile: String): Int {
    var closed = 0
    for (ref in open) {
      val window = ref.get() ?: continue
      if (window.profileName == profile) {
        window.closeForProfileEnd()
        closed++
      }
    }
    return closed
  }

  fun openCount(profile: String): Int = open.count { it.get()?.profileName == profile }
}
