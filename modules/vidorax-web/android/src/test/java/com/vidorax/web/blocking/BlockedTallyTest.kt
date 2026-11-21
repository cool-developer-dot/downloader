package com.vidorax.web.blocking

import org.junit.Assert.assertEquals
import org.junit.Test

class BlockedTallyTest {
  private class MemoryStore(var days: Map<Long, Int> = emptyMap()) : BlockedTally.Store {
    var saves = 0
    override fun load() = days
    override fun save(days: Map<Long, Int>) {
      this.days = days
      saves += 1
    }
  }

  @Test
  fun `counts today and keeps the last seven days only`() {
    var day = 100L
    val store = MemoryStore(mapOf(90L to 50, 94L to 7, 99L to 3))
    val tally = BlockedTally(store, today = { day }, now = { 0L }, flushEveryMs = Long.MAX_VALUE)
    repeat(5) { tally.count() }
    // Days 94..100: 7 + 3 + 5; day 90 is older than a week.
    assertEquals(15, tally.thisWeek())
    assertEquals(mapOf(94L to 7, 99L to 3, 100L to 5), store.days)
    day = 101L
    assertEquals(8, tally.thisWeek())
  }

  @Test
  fun `writes at most once per interval while counting`() {
    var time = 0L
    val store = MemoryStore()
    val tally = BlockedTally(store, today = { 1L }, now = { time }, flushEveryMs = 1_000L)
    repeat(10) { tally.count() }
    val afterBurst = store.saves
    time = 2_000L
    tally.count()
    assertEquals(afterBurst + 1, store.saves)
    assertEquals(11, tally.thisWeek())
  }

  @Test
  fun `works without a store`() {
    val tally = BlockedTally(null, today = { 5L })
    tally.count()
    tally.count()
    assertEquals(2, tally.thisWeek())
  }
}
