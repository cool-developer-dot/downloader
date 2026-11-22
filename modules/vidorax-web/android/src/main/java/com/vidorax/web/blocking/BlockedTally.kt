package com.vidorax.web.blocking

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Design 5 "Privacy & security": how many ads and trackers the blockers stopped this week (the last 7 days, today
 * included), counted on the phone only. One bucket per day; [count] runs on network threads (an atomic increment,
 * no I/O), and the buckets are written through [store] at most every [flushEveryMs] and whenever [thisWeek] is read.
 * Buckets older than a week are dropped. Nothing leaves the device.
 */
internal class BlockedTally(
  private val store: Store?,
  private val today: () -> Long = { System.currentTimeMillis() / DAY_MS },
  private val now: () -> Long = System::currentTimeMillis,
  private val flushEveryMs: Long = 30_000L,
) {
  interface Store {
    fun load(): Map<Long, Int>
    fun save(days: Map<Long, Int>)
  }

  private val days = ConcurrentHashMap<Long, AtomicInteger>()
  private val lastFlush = AtomicLong(0L)
  @Volatile private var loaded = false

  /** Network threads: one more request blocked today. */
  fun count() {
    ensureLoaded()
    days.computeIfAbsent(today()) { AtomicInteger() }.incrementAndGet()
    val time = now()
    val last = lastFlush.get()
    if (time - last >= flushEveryMs && lastFlush.compareAndSet(last, time)) flush()
  }

  /** Requests blocked over the last 7 days. */
  fun thisWeek(): Int {
    ensureLoaded()
    val first = today() - (WEEK_DAYS - 1)
    flush()
    return days.entries.filter { it.key >= first }.sumOf { it.value.get() }
  }

  private fun ensureLoaded() {
    if (loaded) return
    synchronized(this) {
      if (loaded) return
      runCatching { store?.load() }.getOrNull()?.forEach { (day, value) ->
        days.computeIfAbsent(day) { AtomicInteger() }.addAndGet(value)
      }
      loaded = true
    }
  }

  private fun flush() {
    val first = today() - (WEEK_DAYS - 1)
    days.keys.filter { it < first }.forEach { days.remove(it) }
    val snapshot = days.mapValues { it.value.get() }
    runCatching { store?.save(snapshot) }
  }

  companion object {
    const val DAY_MS = 86_400_000L
    const val WEEK_DAYS = 7
  }
}
