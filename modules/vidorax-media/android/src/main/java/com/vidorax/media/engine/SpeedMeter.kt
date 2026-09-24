package com.vidorax.media.engine

/**
 * Download speed over a sliding window. A transfer reports every 64 KiB it writes, so the speed between two of those
 * reports swings from zero to several times the real rate; what the Downloads row and the notification show is the
 * bytes gained over the last [windowMs] instead. Bytes going backwards (a server that ignored Range, a restart from
 * zero) start a new measurement rather than reporting a negative or inflated speed.
 */
internal class SpeedMeter(
  private val windowMs: Long = WINDOW_MS,
  private val minSpanMs: Long = MIN_SPAN_MS,
) {
  private val times = ArrayDeque<Long>()
  private val bytes = ArrayDeque<Long>()
  private var speed = 0L

  /** Records that [bytesDone] were on disk at [timeMs]; returns the current speed in bytes per second. */
  fun add(timeMs: Long, bytesDone: Long): Long {
    if (bytes.isNotEmpty() && bytesDone < bytes.last()) reset()
    // One sample per [SAMPLE_GAP_MS] is enough for the window and keeps it small on a fast connection.
    if (times.isEmpty() || timeMs - times.last() >= SAMPLE_GAP_MS) {
      times.addLast(timeMs)
      bytes.addLast(bytesDone)
    }
    // Keep the newest sample that is at least a window old as the base, so the span covers the whole window.
    while (times.size > 2 && timeMs - times[1] >= windowMs) {
      times.removeFirst()
      bytes.removeFirst()
    }
    val span = timeMs - times.first()
    if (span >= minSpanMs) {
      speed = ((bytesDone - bytes.first()) * 1000 / span).coerceAtLeast(0)
    }
    return speed
  }

  fun reset() {
    times.clear()
    bytes.clear()
    speed = 0L
  }

  companion object {
    const val WINDOW_MS = 2_000L
    const val MIN_SPAN_MS = 500L
    const val SAMPLE_GAP_MS = 50L
  }
}
