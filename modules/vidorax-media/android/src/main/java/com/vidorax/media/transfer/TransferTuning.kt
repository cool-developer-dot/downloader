package com.vidorax.media.transfer

import com.vidorax.media.model.DownloadSettings

/**
 * #350 Buffer size and #344 Disk write cache, as the running engine applies them ([DownloadSettings.effective]). Read
 * by every transfer when it starts a stream, so a change applies to the next read loop; a running stream keeps the
 * values it started with.
 */
internal object TransferTuning {
  @Volatile var bufferBytes: Int = DownloadSettings.DEFAULT_BUFFER_KB * 1024
    private set

  @Volatile var writeCacheBytes: Int = 0
    private set

  fun apply(settings: DownloadSettings) {
    bufferBytes = settings.bufferKb.coerceIn(DownloadSettings.MIN_BUFFER_KB, DownloadSettings.MAX_BUFFER_KB) * 1024
    writeCacheBytes = settings.writeCacheKb.coerceIn(0, DownloadSettings.MAX_WRITE_CACHE_KB) * 1024
  }

  /** Bytes gathered before a write when the cache is on: at least one read's worth. */
  fun cacheCapacity(buffer: Int): Int = if (writeCacheBytes <= 0) 0 else maxOf(writeCacheBytes, buffer)

  /** A cached write never waits longer than this, so play-while-downloading and the stall watchdog see steady growth. */
  const val MAX_CACHE_HOLD_MS = 1_000L
}

/**
 * Gathers sequential writes in memory and hands them to [sink] in one call when [capacity] is reached, when
 * [TransferTuning.MAX_CACHE_HOLD_MS] passed since the first byte was gathered, or on [flush]. With capacity 0 every
 * write goes straight through. [sink] receives the absolute position of the gathered block, so it works for a part's
 * positional writes as well as a file's sequential ones.
 */
internal class WriteCache(
  private val capacity: Int,
  private val now: () -> Long = System::currentTimeMillis,
  private val sink: (position: Long, bytes: ByteArray, offset: Int, length: Int) -> Unit,
) {
  private val block = if (capacity > 0) ByteArray(capacity) else null
  private var length = 0
  private var blockStart = 0L
  private var gatheredSince = 0L

  /** Bytes taken but not yet handed to the sink. */
  val pending: Int get() = length

  /** Writes [bytes] that belong at [position] (the position right after the previous write when gathering). */
  fun write(position: Long, bytes: ByteArray, offset: Int, count: Int): Int {
    val cache = block ?: run {
      sink(position, bytes, offset, count)
      return count
    }
    if (length > 0 && position != blockStart + length) flush()
    var done = 0
    var at = position
    while (done < count) {
      if (length == 0) {
        blockStart = at
        gatheredSince = now()
      }
      val take = minOf(cache.size - length, count - done)
      System.arraycopy(bytes, offset + done, cache, length, take)
      length += take
      done += take
      at += take
      if (length == cache.size) flush()
    }
    if (length > 0 && now() - gatheredSince >= TransferTuning.MAX_CACHE_HOLD_MS) flush()
    return count
  }

  /** Hands everything gathered to the sink; returns how many bytes that was. */
  fun flush(): Int {
    val cache = block ?: return 0
    if (length == 0) return 0
    val flushed = length
    sink(blockStart, cache, 0, length)
    length = 0
    return flushed
  }
}
