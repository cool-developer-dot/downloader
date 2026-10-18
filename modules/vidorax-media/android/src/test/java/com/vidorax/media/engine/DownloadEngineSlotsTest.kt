package com.vidorax.media.engine

import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The line of downloads waiting for a slot (`DownloadEngine.Slots`). A slot handed to a waiting download just as it
 * was paused or cancelled used to be lost for good: it stayed counted, nobody released it, and once every slot was
 * lost the queue never started anything again.
 *
 * The first three tests run on runBlocking's single thread, so the order is exact: `release()` hands the slot over
 * (the waiter resumes only at the next suspension of the test), then the waiter's job is cancelled before it runs.
 */
class DownloadEngineSlotsTest {
  @Test fun aSlotHandedToADownloadStoppedAtThatMomentGoesToTheNextOne() = runBlocking {
    val slots = DownloadEngine.Slots(1)
    slots.acquire() // "a" runs
    var cStarted = false
    val b = launch(start = CoroutineStart.UNDISPATCHED) { slots.acquire() }
    val c = launch(start = CoroutineStart.UNDISPATCHED) {
      slots.acquire()
      cStarted = true
    }

    // "a" finishes, its slot goes to "b", and "b" is paused before it gets to run.
    slots.release()
    b.cancel()
    b.join()

    withTimeout(1_000) { c.join() }
    assertTrue(cStarted)
  }

  @Test fun aSlotHandedToTheLastWaiterStoppedAtThatMomentIsFreed() = runBlocking {
    val slots = DownloadEngine.Slots(1)
    slots.acquire()
    val b = launch(start = CoroutineStart.UNDISPATCHED) { slots.acquire() }
    slots.release()
    b.cancel()
    b.join()

    // Nothing runs now: the next download starts at once, and only one, as the limit is 1.
    withTimeout(1_000) { slots.acquire() }
    val d = launch(start = CoroutineStart.UNDISPATCHED) { slots.acquire() }
    yield()
    assertFalse(d.isCompleted)
    d.cancel()
  }

  @Test fun aDownloadStoppedWhileWaitingLeavesTheLineAsBefore() = runBlocking {
    val slots = DownloadEngine.Slots(1)
    slots.acquire()
    var bStarted = false
    var cStarted = false
    val b = launch(start = CoroutineStart.UNDISPATCHED) {
      slots.acquire()
      bStarted = true
    }
    val c = launch(start = CoroutineStart.UNDISPATCHED) {
      slots.acquire()
      cStarted = true
    }
    b.cancel()
    b.join()

    slots.release()
    withTimeout(1_000) { c.join() }
    assertFalse(bStarted)
    assertTrue(cStarted)
  }

  @Test fun noSlotIsLostWhenManyDownloadsAreStoppedAtOnce() = runBlocking {
    // Stress on four threads: half the workers are cancelled while they wait, take a slot or run, so the clean-up
    // also runs while another worker holds the line's lock. A lost slot makes a later round hang (timeout).
    val pool = Executors.newFixedThreadPool(4).asCoroutineDispatcher()
    try {
      val slots = DownloadEngine.Slots(2)
      withTimeout(20_000) {
        withContext(pool) {
          repeat(200) { round ->
            val workers = List(6) {
              launch {
                slots.acquire()
                try {
                  delay(1)
                } finally {
                  slots.release()
                }
              }
            }
            if (round % 2 == 1) yield()
            workers.forEachIndexed { i, worker -> if (i % 2 == 0) worker.cancel() }
            workers.joinAll()
          }
        }
      }

      // Every slot is free again: two downloads start at once, and a third waits.
      withTimeout(1_000) {
        slots.acquire()
        slots.acquire()
      }
      val third = launch(pool) { slots.acquire() }
      delay(100)
      assertFalse(third.isCompleted)
      third.cancel()
      third.join()
    } finally {
      pool.close()
    }
  }
}
