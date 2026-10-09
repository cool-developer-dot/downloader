package com.vidorax.media.player

import android.app.Activity
import android.os.Build
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import java.lang.ref.WeakReference

/**
 * Reports when the activity stops being visible (`onStop`): the PiP window was dismissed, the user left while PiP could
 * not open (turned off for the app in system settings), or the screen went off.
 *
 * The player keeps playing while the system moves it into a PiP window, so something must stop it when no window
 * appears or the window goes away. JavaScript timers do not run while the activity is paused, so the player cannot
 * wait and check; this event is its signal. Call [attach] and [detach] on the main thread.
 */
class ActivityVisibility(private val onStopped: (inPictureInPicture: Boolean) -> Unit) {
  private var observed: WeakReference<LifecycleOwner>? = null

  private val observer = LifecycleEventObserver { source, event ->
    if (event == Lifecycle.Event.ON_STOP) {
      val activity = source as? Activity
      val inPictureInPicture = activity != null &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
        activity.isInPictureInPictureMode
      onStopped(inPictureInPicture)
    }
  }

  fun attach(activity: Activity?) {
    val owner = activity as? LifecycleOwner ?: return
    if (observed?.get() === owner) return
    detach()
    owner.lifecycle.addObserver(observer)
    observed = WeakReference(owner)
  }

  fun detach() {
    observed?.get()?.lifecycle?.removeObserver(observer)
    observed = null
  }
}
