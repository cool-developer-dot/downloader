package com.vidorax.media.player

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.util.Rational

/**
 * Picture-in-picture when the user leaves VidoraX while a video plays, on Android 8–11.
 *
 * From Android 12 expo-video arms `PictureInPictureParams.setAutoEnterEnabled` itself. Before that an app must ask
 * for PiP from `onUserLeaveHint` (Home / Recents), synchronously — a round trip through JavaScript arrives after the
 * activity has paused. JavaScript arms this while its player plays; the system window then shows expo-video's player
 * (its PiP manager moves the same player view into the window, so playback never restarts).
 */
class PictureInPictureAutoEnter {
  @Volatile private var armed = false
  @Volatile private var aspect: Pair<Int, Int>? = null

  fun arm(armed: Boolean, width: Int, height: Int) {
    this.armed = armed
    aspect = safeAspect(width, height)
  }

  fun onUserLeaveHint(activity: Activity) {
    val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    val inPictureInPicture = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity.isInPictureInPictureMode
    if (!shouldEnterOnLeave(Build.VERSION.SDK_INT, armed, supported, inPictureInPicture)) return
    try {
      val builder = PictureInPictureParams.Builder()
      aspect?.let { (width, height) -> builder.setAspectRatio(Rational(width, height)) }
      activity.enterPictureInPictureMode(builder.build())
    } catch (error: IllegalStateException) {
      // The activity does not support PiP (manifest) or is already stopping: the video simply pauses.
      Log.w(TAG, "picture-in-picture not entered: ${error.message}")
    } catch (error: IllegalArgumentException) {
      Log.w(TAG, "picture-in-picture not entered: ${error.message}")
    }
  }

  companion object {
    private const val TAG = "VidoraPiP"
    /** Android 12: expo-video's auto-enter takes over. */
    const val AUTO_ENTER_SDK = 31
    const val FIRST_PIP_PARAMS_SDK = 26

    // PictureInPictureParams accepts aspect ratios between 1:2.39 and 2.39:1 (inclusive); outside it throws.
    private const val MAX_RATIO_NUM = 239
    private const val MAX_RATIO_DEN = 100

    fun shouldEnterOnLeave(sdk: Int, armed: Boolean, supported: Boolean, inPictureInPicture: Boolean): Boolean =
      armed && supported && !inPictureInPicture && sdk >= FIRST_PIP_PARAMS_SDK && sdk < AUTO_ENTER_SDK

    /** The video's aspect ratio as a PiP-safe fraction, or null (system default) when unknown. */
    fun safeAspect(width: Int, height: Int): Pair<Int, Int>? {
      if (width <= 0 || height <= 0) return null
      val ratio = width.toDouble() / height
      return when {
        ratio > MAX_RATIO_NUM.toDouble() / MAX_RATIO_DEN -> MAX_RATIO_NUM to MAX_RATIO_DEN
        ratio < MAX_RATIO_DEN.toDouble() / MAX_RATIO_NUM -> MAX_RATIO_DEN to MAX_RATIO_NUM
        else -> width to height
      }
    }
  }
}
