package com.vidorax.media.transfer

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/** Paces the bytes one download reads from the network: called after every read, it suspends while over a limit. */
fun interface Throttle {
  suspend fun take(bytes: Int)

  companion object {
    val NONE = Throttle { }
  }
}

/**
 * Speed limits for downloads (F2, docs/ARCHITECTURE.md §3.6): one token bucket for every download together (the global
 * limit, Settings → Download Settings → "Speed limit"), one per download that has its own limit (Download details), and
 * the **Priority** rule — while the priority download is receiving bytes, all other downloads together get at most
 * [PRIORITY_OTHERS_SHARE] of what it gets (of the global limit when one is set, else of its measured speed). A read
 * consumes from every bucket it belongs to and waits for the slowest, so a per-download limit always sits inside the
 * global one. Buckets may go into debt: a read never splits, the next one waits longer. Thread-safe.
 */
class BandwidthLimiter(
  private val nanoTime: () -> Long = System::nanoTime,
  private val sleep: suspend (nanos: Long) -> Unit = { kotlinx.coroutines.delay((it + 999_999) / 1_000_000) },
) {
  private val global = TokenBucket()
  private val othersWhilePriority = TokenBucket()
  private val perDownload = HashMap<String, TokenBucket>()
  private var priorityId: String? = null

  /** The download that has priority now, if any. */
  val priority: String? @Synchronized get() = priorityId
  private var priorityLastReadNs: Long? = null
  private var priorityWindowStartNs = 0L
  private var priorityWindowBytes = 0L
  private var priorityMeasuredBps = 0L

  @Synchronized
  fun setGlobalLimit(bytesPerSecond: Long?) {
    global.setRate(bytesPerSecond.positiveOrZero(), nanoTime())
  }

  @Synchronized
  fun setDownloadLimit(id: String, bytesPerSecond: Long?) {
    val rate = bytesPerSecond.positiveOrZero()
    if (rate == 0L) {
      perDownload.remove(id)
    } else {
      perDownload.getOrPut(id) { TokenBucket() }.setRate(rate, nanoTime())
    }
  }

  /** At most one download has priority; null clears it. */
  @Synchronized
  fun setPriority(id: String?) {
    if (id == priorityId) return
    priorityId = id
    priorityLastReadNs = null
    priorityWindowBytes = 0
    priorityMeasuredBps = 0
  }

  /** The download is gone (removed or finished): its own limit and priority are dropped. */
  @Synchronized
  fun forget(id: String) {
    perDownload.remove(id)
    if (priorityId == id) setPriority(null)
  }

  fun throttleFor(id: String): Throttle = Throttle { bytes -> acquire(id, bytes) }

  suspend fun acquire(id: String, bytes: Int) {
    if (bytes <= 0) return
    val wait = reserve(id, bytes)
    if (wait > 0) sleep(wait)
  }

  /** Consumes [bytes] for download [id] and returns how long to wait before the next read (nanoseconds). */
  @Synchronized
  internal fun reserve(id: String, bytes: Int): Long {
    val now = nanoTime()
    var wait = global.reserve(bytes, now)
    perDownload[id]?.let { wait = max(wait, it.reserve(bytes, now)) }
    val priority = priorityId
    if (priority != null) {
      if (id == priority) {
        notePriorityRead(bytes, now)
      } else if (priorityActive(now)) {
        othersWhilePriority.setRate(othersRate(), now)
        wait = max(wait, othersWhilePriority.reserve(bytes, now))
      }
    }
    return wait
  }

  private fun notePriorityRead(bytes: Int, now: Long) {
    if (priorityLastReadNs == null || now - priorityWindowStartNs > 2 * PRIORITY_WINDOW_NS) {
      priorityWindowStartNs = now
      priorityWindowBytes = 0
    }
    priorityLastReadNs = now
    priorityWindowBytes += bytes
    val elapsed = now - priorityWindowStartNs
    if (elapsed >= PRIORITY_WINDOW_NS) {
      priorityMeasuredBps = priorityWindowBytes * NANOS_PER_SECOND / elapsed
      priorityWindowStartNs = now
      priorityWindowBytes = 0
    }
  }

  private fun priorityActive(now: Long): Boolean {
    val last = priorityLastReadNs ?: return false
    return now - last <= PRIORITY_ACTIVE_NS
  }

  private fun othersRate(): Long {
    val base = if (global.rate > 0) global.rate else priorityMeasuredBps
    return max(MIN_OTHERS_BYTES_PER_SECOND, (base * PRIORITY_OTHERS_SHARE).toLong())
  }

  private fun Long?.positiveOrZero(): Long = if (this != null && this > 0) this else 0L

  companion object {
    /** While the priority download receives bytes, the others together get at most this share of its bandwidth. */
    const val PRIORITY_OTHERS_SHARE = 0.25
    /** The others are never paced below this together (they keep moving). */
    const val MIN_OTHERS_BYTES_PER_SECOND = 32L * 1024
    /** The priority download counts as receiving while it read within this long. */
    const val PRIORITY_ACTIVE_NS = 2_000_000_000L
    private const val PRIORITY_WINDOW_NS = 1_000_000_000L
    internal const val NANOS_PER_SECOND = 1_000_000_000L
  }
}

/**
 * Bytes per second with a short burst ([BURST_SECONDS] of the rate, at least [MIN_BURST_BYTES]). A rate of 0 is
 * unlimited. Tokens may go negative (debt): the caller waits until the debt is paid.
 */
internal class TokenBucket {
  var rate = 0L
    private set
  private var tokens = 0.0
  private var lastNs: Long? = null

  private val capacity: Double get() = max(rate * BURST_SECONDS, MIN_BURST_BYTES.toDouble())

  fun setRate(bytesPerSecond: Long, now: Long) {
    if (bytesPerSecond == rate) return
    refill(now)
    val wasUnlimited = rate == 0L
    rate = bytesPerSecond
    tokens = if (wasUnlimited) capacity else min(tokens, capacity)
  }

  fun reserve(bytes: Int, now: Long): Long {
    if (rate <= 0) return 0
    refill(now)
    tokens -= bytes
    return if (tokens >= 0) 0 else ceil(-tokens * BandwidthLimiter.NANOS_PER_SECOND / rate).toLong()
  }

  private fun refill(now: Long) {
    val last = lastNs
    lastNs = now
    if (rate <= 0) return
    if (last == null) {
      tokens = capacity
      return
    }
    tokens = min(capacity, tokens + (now - last).coerceAtLeast(0) * rate.toDouble() / BandwidthLimiter.NANOS_PER_SECOND)
  }

  private companion object {
    const val BURST_SECONDS = 0.25
    const val MIN_BURST_BYTES = 16 * 1024
  }
}
