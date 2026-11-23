package com.vidorax.media.player

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class QueueNavigationTest {
  private val seekable: Player.Commands =
    Player.Commands.Builder().addAll(Player.COMMAND_PLAY_PAUSE, Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM).build()
  private val notSeekable: Player.Commands = Player.Commands.Builder().add(Player.COMMAND_PLAY_PAUSE).build()

  @Test
  fun offersNextOnlyWhileTheQueueHasOne() {
    val withNext = QueueNavigation.commands(seekable, QueueNavigation(enabled = true, hasNext = true, hasPrevious = false))
    assertTrue(withNext.contains(Player.COMMAND_SEEK_TO_NEXT))
    assertTrue(withNext.contains(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM))
    val last = QueueNavigation.commands(withNext, QueueNavigation(enabled = true, hasNext = false, hasPrevious = false))
    assertFalse(last.contains(Player.COMMAND_SEEK_TO_NEXT))
    assertFalse(last.contains(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM))
  }

  @Test
  fun offersPreviousForAPreviousVideoOrTheStartOfThisOne() {
    val first = QueueNavigation(enabled = true, hasNext = true, hasPrevious = false)
    assertTrue(QueueNavigation.commands(seekable, first).contains(Player.COMMAND_SEEK_TO_PREVIOUS))
    assertFalse(QueueNavigation.commands(notSeekable, first).contains(Player.COMMAND_SEEK_TO_PREVIOUS))
    val middle = QueueNavigation(enabled = true, hasNext = true, hasPrevious = true)
    assertTrue(QueueNavigation.commands(notSeekable, middle).contains(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM))
  }

  @Test
  fun keepsEveryOtherCommand() {
    val commands = QueueNavigation.commands(seekable, QueueNavigation(enabled = true, hasNext = true, hasPrevious = true))
    assertTrue(commands.contains(Player.COMMAND_PLAY_PAUSE))
    assertTrue(commands.contains(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM))
  }

  @Test
  fun offTheSessionKeepsTheExoPlayersOwnCommandsAndForwardsEverySeek() {
    val off = QueueNavigation(enabled = false, hasNext = true, hasPrevious = true)
    assertEquals(seekable, QueueNavigation.commands(seekable, off))
    assertNull(QueueNavigation.commandFor(Player.COMMAND_SEEK_TO_NEXT, off))
  }

  @Test
  fun handsNextAndPreviousToThePlayerAndForwardsOtherSeeks() {
    val on = QueueNavigation(enabled = true, hasNext = true, hasPrevious = true)
    assertEquals("next", QueueNavigation.commandFor(Player.COMMAND_SEEK_TO_NEXT, on))
    assertEquals("next", QueueNavigation.commandFor(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, on))
    assertEquals("previous", QueueNavigation.commandFor(Player.COMMAND_SEEK_TO_PREVIOUS, on))
    assertEquals("previous", QueueNavigation.commandFor(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, on))
    assertNull(QueueNavigation.commandFor(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM, on))
    assertNull(QueueNavigation.commandFor(Player.COMMAND_SEEK_BACK, on))
    assertNull(QueueNavigation.commandFor(Player.COMMAND_SEEK_FORWARD, on))
  }
}
