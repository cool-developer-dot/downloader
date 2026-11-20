package com.vidorax.media.transfer

import com.vidorax.media.model.DownloadSettings
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** #344 Disk write cache and #350 Buffer size: what reaches the sink, when, and at which position. */
class WriteCacheTest {
  private class Sink {
    val calls = mutableListOf<Pair<Long, ByteArray>>()
    val fn: (Long, ByteArray, Int, Int) -> Unit = { position, bytes, offset, length -> calls += position to bytes.copyOfRange(offset, offset + length) }
  }

  @After fun reset() = TransferTuning.apply(DownloadSettings.DEFAULT)

  @Test fun withoutACacheEveryWriteGoesStraightThrough() {
    val sink = Sink()
    val cache = WriteCache(0, sink = sink.fn)
    cache.write(0, byteArrayOf(1, 2, 3), 0, 3)
    cache.write(3, byteArrayOf(4, 5), 0, 2)
    assertEquals(listOf(0L, 3L), sink.calls.map { it.first })
    assertEquals(0, cache.pending)
    assertEquals(0, cache.flush())
  }

  @Test fun writesAreGatheredUntilTheCacheIsFullThenHandedOnInOneBlock() {
    val sink = Sink()
    val cache = WriteCache(8, now = { 0L }, sink = sink.fn)
    cache.write(100, byteArrayOf(1, 2, 3, 4, 5), 0, 5)
    assertEquals(0, sink.calls.size)
    assertEquals(5, cache.pending)
    cache.write(105, byteArrayOf(6, 7, 8, 9, 10), 0, 5)
    assertEquals(1, sink.calls.size)
    assertEquals(100L, sink.calls[0].first)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5, 6, 7, 8), sink.calls[0].second)
    assertEquals(2, cache.pending)
    assertEquals(2, cache.flush())
    assertEquals(108L, sink.calls[1].first)
    assertArrayEquals(byteArrayOf(9, 10), sink.calls[1].second)
  }

  @Test fun aWriteElsewhereFlushesWhatWasGatheredFirst() {
    val sink = Sink()
    val cache = WriteCache(64, now = { 0L }, sink = sink.fn)
    cache.write(0, byteArrayOf(1, 2), 0, 2)
    cache.write(50, byteArrayOf(3), 0, 1)
    assertEquals(listOf(0L), sink.calls.map { it.first })
    cache.flush()
    assertEquals(listOf(0L, 50L), sink.calls.map { it.first })
  }

  @Test fun gatheredBytesNeverWaitLongerThanTheHoldTime() {
    val sink = Sink()
    var clock = 0L
    val cache = WriteCache(1024, now = { clock }, sink = sink.fn)
    cache.write(0, byteArrayOf(1), 0, 1)
    clock = TransferTuning.MAX_CACHE_HOLD_MS - 1
    cache.write(1, byteArrayOf(2), 0, 1)
    assertEquals(0, sink.calls.size)
    clock = TransferTuning.MAX_CACHE_HOLD_MS
    cache.write(2, byteArrayOf(3), 0, 1)
    assertEquals(1, sink.calls.size)
    assertArrayEquals(byteArrayOf(1, 2, 3), sink.calls[0].second)
  }

  @Test fun tuningFollowsTheSettingsWithinTheirBounds() {
    TransferTuning.apply(DownloadSettings.DEFAULT.copy(bufferKb = 256, writeCacheKb = 4096))
    assertEquals(256 * 1024, TransferTuning.bufferBytes)
    assertEquals(4096 * 1024, TransferTuning.writeCacheBytes)
    assertEquals(4096 * 1024, TransferTuning.cacheCapacity(TransferTuning.bufferBytes))
    TransferTuning.apply(DownloadSettings.DEFAULT.copy(bufferKb = 1, writeCacheKb = 0))
    assertEquals(DownloadSettings.MIN_BUFFER_KB * 1024, TransferTuning.bufferBytes)
    assertEquals(0, TransferTuning.cacheCapacity(TransferTuning.bufferBytes))
  }
}
