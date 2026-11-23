package com.vidorax.media.player

import androidx.annotation.OptIn
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * P15 #661 / #701: the player a media session of an expo-video player controls (through VideoPlayerHooks).
 *
 * expo-video plays one item, so a session's "next" / "previous" — a headset double press, a Bluetooth remote's ⏭ / ⏮,
 * the notification's buttons — would do nothing. This player forwards everything to the ExoPlayer except those two:
 * it offers them while the Player's queue has somewhere to go (JavaScript says so, [setNavigation]) and hands them to
 * [onCommand] ("next" / "previous"), where the Player plays the next or previous video of its queue. "Previous" is
 * always offered while the video can seek: the Player decides between the previous video and the start of this one.
 * Main thread only (the ExoPlayer's application thread).
 */
@OptIn(UnstableApi::class)
class QueueSessionPlayer(player: Player, private val onCommand: (String) -> Unit) : ForwardingSimpleBasePlayer(player) {
  private var navigation = QueueNavigation.NONE

  /** What the session offers; the notification and the controllers it is connected to update at once. */
  fun setNavigation(next: QueueNavigation) {
    if (next == navigation) return
    navigation = next
    invalidateState()
  }

  override fun getState(): State {
    val state = super.getState()
    val commands = QueueNavigation.commands(state.availableCommands, navigation)
    return if (commands == state.availableCommands) state else state.buildUpon().setAvailableCommands(commands).build()
  }

  override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
    val command = QueueNavigation.commandFor(seekCommand, navigation)
    if (command != null) {
      onCommand(command)
      return Futures.immediateVoidFuture()
    }
    return super.handleSeek(mediaItemIndex, positionMs, seekCommand)
  }
}

/** Pure rules of [QueueSessionPlayer] (JVM-tested). */
data class QueueNavigation(val enabled: Boolean, val hasNext: Boolean, val hasPrevious: Boolean) {
  companion object {
    val NONE = QueueNavigation(enabled = false, hasNext = false, hasPrevious = false)

    private val NEXT = intArrayOf(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
    private val PREVIOUS = intArrayOf(Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)

    /**
     * The session's commands: next only while the queue has a next video; previous while it has a previous one, or
     * the video can seek (back to its start). With the setting off, neither is changed from the ExoPlayer's own.
     */
    fun commands(base: Player.Commands, navigation: QueueNavigation): Player.Commands {
      if (!navigation.enabled) return base
      val builder = base.buildUpon()
      if (navigation.hasNext) builder.addAll(*NEXT) else builder.removeAll(*NEXT)
      if (navigation.hasPrevious || base.contains(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM)) {
        builder.addAll(*PREVIOUS)
      }
      return builder.build()
    }

    /** "next" / "previous" when the session's seek is one the Player's queue answers; null to forward it. */
    fun commandFor(seekCommand: Int, navigation: QueueNavigation): String? {
      if (!navigation.enabled) return null
      return when {
        seekCommand in NEXT -> "next"
        seekCommand in PREVIOUS -> "previous"
        else -> null
      }
    }
  }
}
