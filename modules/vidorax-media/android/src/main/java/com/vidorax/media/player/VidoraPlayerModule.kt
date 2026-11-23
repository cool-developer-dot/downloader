package com.vidorax.media.player

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.view.WindowManager
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.video.player.VideoPlayer
import expo.modules.video.player.VideoPlayerHooks
import java.util.WeakHashMap

/**
 * The `VidoraPlayer` Expo module: Faran's Player packages (P14–P19) reach expo-video's ExoPlayer through it — what
 * expo-video's JavaScript API cannot set. Its contract is modules/vidorax-media/src/VidoraPlayer.types.ts.
 *
 * JavaScript passes its expo-video `VideoPlayer` (a shared object) to each call; every call runs on the main thread,
 * where ExoPlayer lives. A player that has been released is ignored (its ExoPlayer refuses calls).
 *
 * The module also registers the hooks scripts/patch-expo-video.js adds to expo-video (VideoPlayerHooks): each media
 * session of a player controls a [QueueSessionPlayer], which hands "next" / "previous" to JavaScript.
 */
@OptIn(UnstableApi::class)
class VidoraPlayerModule : Module() {
  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  /** One session player per expo-video player (its basic session and the playback service's share it). */
  private val sessionPlayers = WeakHashMap<VideoPlayer, QueueSessionPlayer>()

  /** P18: each player's sleep-timer / daily-limit countdown. */
  private val deadlines = WeakHashMap<VideoPlayer, PlaybackDeadline>()

  override fun definition() = ModuleDefinition {
    Name("VidoraPlayer")

    Events(ON_QUEUE_COMMAND, ON_PLAYBACK_DEADLINE)

    OnCreate {
      // P17 / P19: every new player's audio sink runs a VidoraAudioProcessor first (its own instance).
      VideoPlayerHooks.audioProcessors = { arrayOf(VidoraAudioProcessor()) }
      VideoPlayerHooks.sessionPlayerFactory = { owner, exo ->
        sessionPlayers.getOrPut(owner) {
          QueueSessionPlayer(exo) { command -> runCatching { sendEvent(ON_QUEUE_COMMAND, mapOf("command" to command)) } }
        }
      }
    }

    OnDestroy {
      VideoPlayerHooks.audioProcessors = null
      VideoPlayerHooks.sessionPlayerFactory = null
      sessionPlayers.clear()
      deadlines.values.forEach { it.cancel() }
      deadlines.clear()
    }

    // Faran's packages: everything kept for a player (countdown, session player), when it is released.
    AsyncFunction("releasePlayer") { player: VideoPlayer ->
      deadlines.remove(player)?.cancel()
      sessionPlayers.remove(player)
    }.runOnQueue(Queues.MAIN)

    // P18 #644 / #730: the player fades out and pauses `inMs` from now (null cancels); then onPlaybackDeadline.
    AsyncFunction("setPlaybackDeadline") { player: VideoPlayer, inMs: Double?, fadeMs: Int ->
      val deadline = deadlines.getOrPut(player) {
        PlaybackDeadline(player.player) { runCatching { sendEvent(ON_PLAYBACK_DEADLINE, emptyMap<String, Any>()) } }
      }
      deadline.arm(inMs?.toLong(), fadeMs.toLong())
    }.runOnQueue(Queues.MAIN)

    // P14 #670 (stream quality cap) and P17 #574 (Audio Only Mode: no video decoding).
    AsyncFunction("setTrackLimits") { player: VideoPlayer, maxLongSide: Int?, videoDisabled: Boolean ->
      val exo = player.player
      val limits = PlayerTrackLimits.of(maxLongSide, videoDisabled)
      exo.trackSelectionParameters = limits.applyTo(exo.trackSelectionParameters)
    }.runOnQueue(Queues.MAIN)

    // P14 #670: what the stream plays now, for "Auto · 720p now" (null before the first video format is known).
    AsyncFunction("getPlayingVideoSize") { player: VideoPlayer, promise: Promise ->
      val format = player.player.videoFormat
      if (format == null || format.width <= 0 || format.height <= 0) {
        promise.resolve(null)
      } else {
        promise.resolve(mapOf("width" to format.width, "height" to format.height, "bitrate" to format.bitrate))
      }
    }.runOnQueue(Queues.MAIN)

    // P15 #661 / #701: what the media session's ⏮ / ⏭ (headset double press, remotes, the notification) may do.
    AsyncFunction("setQueueNavigation") { player: VideoPlayer, enabled: Boolean, hasNext: Boolean, hasPrevious: Boolean ->
      sessionPlayers[player]?.setNavigation(QueueNavigation(enabled, hasNext, hasPrevious))
    }.runOnQueue(Queues.MAIN)

    // P17 #554: the sound later (+) or earlier (−) than the picture, in ms, kept the same in real time at any speed.
    AsyncFunction("setAudioDelay") { player: VideoPlayer, delayMs: Int, speed: Double ->
      player.audioProcessor()?.setDelay(delayMs, speed.toFloat())
    }.runOnQueue(Queues.MAIN)

    // P15 #560: pause when the sound would move to the speaker (headphones unplugged, Bluetooth disconnected).
    AsyncFunction("setPauseWhenAudioBecomesNoisy") { player: VideoPlayer, enabled: Boolean ->
      player.player.setHandleAudioBecomingNoisy(enabled)
    }.runOnQueue(Queues.MAIN)

    // P15 #703: the app's window shows over the lock screen (only while the Player is in front; see the JS side).
    AsyncFunction("setShowWhenLocked") { show: Boolean ->
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      LockScreen.setShowWhenLocked(activity, show)
      true
    }.runOnQueue(Queues.MAIN)

    // P15 #703: whether the phone is locked (the keyguard is up), so leaving the Player asks for the unlock first.
    AsyncFunction("isDeviceLocked") {
      LockScreen.keyguard(context)?.isKeyguardLocked == true
    }.runOnQueue(Queues.MAIN)

    // P15 #703: asks the user to unlock (PIN, pattern, fingerprint); true once the phone is unlocked.
    AsyncFunction("requestUnlock") { promise: Promise ->
      val activity = appContext.currentActivity
      val keyguard = LockScreen.keyguard(context)
      if (activity == null || keyguard == null || !keyguard.isKeyguardLocked) {
        promise.resolve(keyguard?.isKeyguardLocked != true)
        return@AsyncFunction
      }
      LockScreen.requestUnlock(activity, keyguard) { unlocked -> promise.resolve(unlocked) }
    }.runOnQueue(Queues.MAIN)
  }

  companion object {
    const val ON_QUEUE_COMMAND = "onQueueCommand"
    const val ON_PLAYBACK_DEADLINE = "onPlaybackDeadline"
  }
}

/** This player's VidoraAudioProcessor; null for a player built before the module registered its hook. */
@OptIn(UnstableApi::class)
internal fun VideoPlayer.audioProcessor(): VidoraAudioProcessor? =
  extraAudioProcessors.firstNotNullOfOrNull { it as? VidoraAudioProcessor }

/** P15 #703: showing over the lock screen, and asking for the unlock. Main thread. */
internal object LockScreen {
  fun keyguard(context: Context?): KeyguardManager? =
    context?.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager

  @Suppress("DEPRECATION")
  fun setShowWhenLocked(activity: Activity, show: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(show)
    } else if (show) {
      activity.window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
    } else {
      activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
    }
  }

  fun requestUnlock(activity: Activity, keyguard: KeyguardManager, done: (Boolean) -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      // No dismiss request before Android 8: stop showing over the lock screen, so the system asks for the unlock.
      setShowWhenLocked(activity, false)
      done(false)
      return
    }
    keyguard.requestDismissKeyguard(
      activity,
      object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() = done(true)
        override fun onDismissCancelled() = done(false)
        override fun onDismissError() = done(false)
      },
    )
  }
}
