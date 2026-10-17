package com.vidorax.media.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** H4: the start-order rules — default unchanged, the user's order, queues, held queues, storage. */
class QueueOrderTest {
  private val default = QueueOrderSnapshot.DEFAULT

  private fun candidates(vararg ids: String) = ids.mapIndexed { index, id -> QueueOrder.Candidate(id, index.toLong()) }

  private fun pickAll(snapshot: QueueOrderSnapshot, vararg ids: String): List<String> {
    val left = candidates(*ids).toMutableList()
    val picked = mutableListOf<String>()
    while (true) {
      val next = QueueOrder.pickNext(left, snapshot) ?: break
      picked += next.downloadId
      left.remove(next)
    }
    return picked
  }

  private fun queues(vararg queues: DownloadQueue) = QueueOrder.withQueues(default, queues.toList())

  @Test fun theDefaultIsFirstComeExactlyAsToday() {
    assertTrue(default.isDefault)
    assertEquals(listOf("a", "b", "c", "d"), pickAll(default, "a", "b", "c", "d"))
    val list = listOf("x", "y", "z")
    assertTrue("restore keeps the list itself", QueueOrder.inStartOrder(list, default) { it } === list)
  }

  @Test fun theUsersOrderComesFirstThenFirstCome() {
    val ordered = QueueOrder.withOrder(default, listOf("d", "b"))
    assertFalse(ordered.isDefault)
    assertEquals(listOf("d", "b", "a", "c"), pickAll(ordered, "a", "b", "c", "d"))
    assertEquals(listOf("d", "b", "a", "c"), QueueOrder.inStartOrder(listOf("a", "b", "c", "d"), ordered) { it })
  }

  @Test fun aNewOrderPutsItsDownloadsFirstAndKeepsTheRestInTheirOrder() {
    val first = QueueOrder.withOrder(default, listOf("a", "b", "c"))
    val second = QueueOrder.withOrder(first, listOf("c", "c", "", "a"))
    assertEquals(listOf("c", "a", "b"), second.order)
  }

  @Test fun queuesRunInTheirListedOrderAndEachInItsOwnOrder() {
    val withNight = queues(DownloadQueue("night", "Night"), DownloadQueue(QueueOrder.MAIN_ID, "x"))
    assertEquals(listOf("night", QueueOrder.MAIN_ID), withNight.queues.map { it.id })
    val moved = QueueOrder.withMoved(withNight, listOf("c"), "night")
    // Night is listed first: its download starts before Main's, whatever its arrival.
    assertEquals(listOf("c", "a", "b"), pickAll(moved, "a", "b", "c"))
  }

  @Test fun aHeldQueueDoesNotStartUntilResumed() {
    val held = QueueOrder.withMoved(queues(DownloadQueue(QueueOrder.MAIN_ID, ""), DownloadQueue("later", "Later", held = true)), listOf("b"), "later")
    assertTrue(held.isHeld("b"))
    assertFalse(held.isHeld("a"))
    assertEquals(listOf("a", "c"), pickAll(held, "a", "b", "c"))
    assertNull("only held downloads waiting: nothing starts", QueueOrder.pickNext(candidates("b"), held))
    val resumed = QueueOrder.withQueues(held, held.queues.map { it.copy(held = false) })
    assertEquals(listOf("a", "b", "c"), pickAll(resumed, "a", "b", "c"))
  }

  @Test fun mainIsAlwaysThereNeverHeldAndKeepsItsName() {
    val snapshot = queues(DownloadQueue("q1", "One"), DownloadQueue(QueueOrder.MAIN_ID, "Renamed", held = true))
    val main = snapshot.queues.single { it.id == QueueOrder.MAIN_ID }
    assertFalse(main.held)
    assertEquals(QueueOrder.MAIN_NAME, main.name)
    val withoutMain = queues(DownloadQueue("q1", "One"))
    assertEquals("left out: Main comes back at the front", listOf(QueueOrder.MAIN_ID, "q1"), withoutMain.queues.map { it.id })
  }

  @Test fun deletingAQueueMovesItsDownloadsToMain() {
    val two = QueueOrder.withMoved(queues(DownloadQueue(QueueOrder.MAIN_ID, ""), DownloadQueue("q1", "One")), listOf("a", "b"), "q1")
    assertEquals("q1", two.queueOf("a"))
    val deleted = QueueOrder.withQueues(two, listOf(DownloadQueue(QueueOrder.MAIN_ID, "")))
    assertEquals(QueueOrder.MAIN_ID, deleted.queueOf("a"))
    assertTrue(deleted.assignments.isEmpty())
  }

  @Test fun movingToMainDropsTheAssignmentAndPutsTheDownloadAtTheEnd() {
    val snapshot = QueueOrder.withOrder(queues(DownloadQueue(QueueOrder.MAIN_ID, ""), DownloadQueue("q1", "One")), listOf("a", "b", "c"))
    val toQ1 = QueueOrder.withMoved(snapshot, listOf("a"), "q1")
    assertEquals(listOf("b", "c", "a"), toQ1.order)
    val back = QueueOrder.withMoved(toQ1, listOf("a"), QueueOrder.MAIN_ID)
    assertFalse(back.assignments.containsKey("a"))
    assertThrows(IllegalArgumentException::class.java) { QueueOrder.withMoved(snapshot, listOf("a"), "nope") }
  }

  @Test fun invalidQueueListsAreRefused() {
    assertThrows(IllegalArgumentException::class.java) { queues(DownloadQueue("bad id", "x")) }
    assertThrows(IllegalArgumentException::class.java) { queues(DownloadQueue("q1", "  ")) }
    assertThrows(IllegalArgumentException::class.java) { queues(DownloadQueue("q1", "x".repeat(41))) }
    assertThrows(IllegalArgumentException::class.java) { queues(DownloadQueue("q1", "a"), DownloadQueue("q1", "b")) }
    val eleven = (1..10).map { DownloadQueue("q$it", "Q$it") }
    assertThrows(IllegalArgumentException::class.java) { QueueOrder.withQueues(default, eleven) }
  }

  @Test fun finishedAndRemovedDownloadsLeaveNoTrace() {
    val snapshot = QueueOrder.withMoved(
      QueueOrder.withOrder(queues(DownloadQueue(QueueOrder.MAIN_ID, ""), DownloadQueue("q1", "One")), listOf("a", "b", "c")),
      listOf("b"),
      "q1",
    )
    val without = QueueOrder.without(snapshot, listOf("b"))
    assertEquals(listOf("a", "c"), without.order)
    assertFalse(without.assignments.containsKey("b"))
    val pruned = QueueOrder.prunedTo(snapshot, listOf("c"))
    assertEquals(listOf("c"), pruned.order)
    assertTrue(pruned.assignments.isEmpty())
    assertTrue("nothing to drop: the same snapshot", QueueOrder.without(snapshot, listOf("zzz")) === snapshot)
  }

  @Test fun storageRoundTripsAndAnythingUnreadableIsTheDefault() {
    val snapshot = QueueOrder.withOrder(
      QueueOrder.withMoved(queues(DownloadQueue("q1", "Night", held = true), DownloadQueue(QueueOrder.MAIN_ID, "")), listOf("a"), "q1"),
      listOf("b", "a"),
    )
    assertEquals(snapshot, QueueOrder.decode(QueueOrder.encode(snapshot)))
    assertEquals(default, QueueOrder.decode(null))
    assertEquals(default, QueueOrder.decode(""))
    assertEquals(default, QueueOrder.decode("{not json"))
    assertEquals(default, QueueOrder.decode("""{"queues":[{"id":"bad id","name":"x"}]}"""))
    // An assignment to a queue that no longer exists is Main.
    val stale = QueueOrder.decode("""{"queues":[{"id":"main","name":"Main"}],"assignments":{"a":"gone"},"order":["a"]}""")
    assertEquals(QueueOrder.MAIN_ID, stale.queueOf("a"))
    assertTrue(stale.assignments.isEmpty())
  }

  @Test fun theBookSavesOnlyRealChangesAndForgetsTheDefault() {
    val writes = mutableListOf<String?>()
    val book = QueueOrderBook(
      object : QueueOrderBook.Storage {
        override fun read(): String? = null

        override fun write(json: String?) {
          writes += json
        }
      },
    )
    assertEquals(default, book.snapshot)
    book.update { QueueOrder.withOrder(it, listOf("a")) }
    book.update { QueueOrder.withOrder(it, listOf("a")) }
    assertEquals("the same order twice is one write", 1, writes.size)
    book.forget(listOf("a"))
    assertEquals("back to the default: the key is removed", listOf(writes[0], null), writes)
    book.forget(listOf("a"))
    assertEquals(2, writes.size)
    assertThrows(IllegalArgumentException::class.java) { book.update { QueueOrder.withMoved(it, listOf("a"), "nope") } }
    assertEquals(default, book.snapshot)
  }
}
