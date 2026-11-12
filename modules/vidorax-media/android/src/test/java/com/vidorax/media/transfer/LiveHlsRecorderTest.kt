package com.vidorax.media.transfer

import com.vidorax.media.model.Container
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.plan.HlsSegmentRef
import com.vidorax.media.plan.LiveSegment
import com.vidorax.media.plan.LiveWindow
import java.io.File
import java.io.RandomAccessFile
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * F6: the recorder against a fake live playlist on a fake clock. The playlist is a sliding window of [WINDOW] segments
 * of [SEGMENT_US] each; a new one appears every segment duration. Segments are a few MPEG-TS packets whose payload
 * names their sequence number, so the file shows exactly which segments went in, in which order.
 */
class LiveHlsRecorderTest {
  @get:Rule val tmp = TemporaryFolder()

  private val part get() = File(tmp.root, "download.part")
  private val checkpoint get() = File(tmp.root, "live.checkpoint")

  /** Fake clock, playlist and disk. */
  private open inner class FakeStream(
    /** The first sequence number the stream ever had (the playlist starts at the edge of "now"). */
    private val firstSequence: Long = 100,
    /** The stream ends (EXT-X-ENDLIST) after this sequence; null: never. */
    var endAfter: Long? = null,
    /** Discontinuity number by sequence. */
    val discontinuityOf: (Long) -> Long = { 0 },
    /** The playlist stops getting new segments at this clock (a stall); null: never. */
    var stallAt: Long? = null,
    var free: Long = Long.MAX_VALUE,
    /** Windows that fail with a network error. */
    var failingWindows: Int = 0,
  ) : LiveRecordHost {
    var clock = 0L
    var stop = false
    var windows = 0
    var stopAfterWindows: Int? = null

    private fun newest(at: Long): Long {
      val produced = (minOf(at, stallAt ?: Long.MAX_VALUE) / (SEGMENT_US / 1000))
      val newest = firstSequence + produced
      return endAfter?.let { minOf(it, newest) } ?: newest
    }

    override suspend fun window(): LiveWindow {
      windows++
      if (stopAfterWindows != null && windows > stopAfterWindows!!) stop = true
      if (failingWindows > 0) {
        failingWindows--
        throw MediaNetworkException("offline")
      }
      val last = newest(clock)
      val segments = (maxOf(firstSequence, last - WINDOW + 1)..last).map { seq ->
        LiveSegment(seq, HlsSegmentRef("https://live.example/seg$seq.ts"), SEGMENT_US, discontinuityOf(seq), null)
      }
      return LiveWindow(segments, SEGMENT_US, ended = endAfter != null && last >= endAfter!!)
    }

    override fun now(): Long = clock

    override fun freeBytes(): Long = free

    override val stopRequested: Boolean get() = stop

    override suspend fun pause(ms: Long): Boolean {
      clock += ms
      return stop
    }
  }

  /** Writes [PACKETS] TS packets per segment, the sequence number in the payload; scripted failures by URL. */
  private class FakeIo : LiveSegmentIo {
    val missing = HashSet<Long>()
    val offlineOnce = HashSet<Long>()
    var hang: CompletableDeferred<Unit>? = null
    var hangOn: Long? = null
    val fetched = ArrayList<Long>()

    private fun sequenceOf(url: String) = url.substringAfter("seg").substringBefore(".ts").toLong()

    private fun bytesFor(seq: Long): ByteArray = ByteArray(PACKETS * 188).also { bytes ->
      for (p in 0 until PACKETS) {
        bytes[p * 188] = 0x47
        bytes[p * 188 + 1] = 0x01
        bytes[p * 188 + 2] = 0x00
        bytes[p * 188 + 3] = 0x10
        val tag = seq.toString().toByteArray()
        tag.copyInto(bytes, p * 188 + 4)
      }
    }

    override suspend fun append(raf: RandomAccessFile, writeAt: Long, ref: HlsSegmentRef, onBytes: (Long) -> Unit): Long {
      val seq = sequenceOf(ref.url)
      if (seq in missing) throw MediaHttpException(404, ref.url)
      if (offlineOnce.remove(seq)) throw MediaNetworkException("dropped")
      val bytes = bytesFor(seq)
      raf.seek(writeAt)
      if (seq == hangOn) {
        // Half a segment, then the process dies.
        raf.write(bytes, 0, bytes.size / 2)
        hang?.complete(Unit)
        awaitCancellation()
      }
      raf.write(bytes)
      fetched += seq
      onBytes(writeAt + bytes.size)
      return writeAt + bytes.size
    }

    override suspend fun fetch(ref: HlsSegmentRef, file: File): File {
      file.writeBytes(bytesFor(sequenceOf(ref.url)))
      return file
    }

    override suspend fun appendFetched(raf: RandomAccessFile, writeAt: Long, file: File, url: String, onBytes: (Long) -> Unit): Long {
      val bytes = file.readBytes()
      raf.seek(writeAt)
      raf.write(bytes)
      fetched += sequenceOf(url)
      return writeAt + bytes.size
    }
  }

  /** The sequence numbers in the recorded file, in order. */
  private fun recordedSequences(): List<Long> {
    val bytes = part.readBytes()
    return (0 until bytes.size / (PACKETS * 188)).map { i ->
      val at = i * PACKETS * 188 + 4
      String(bytes, at, bytes.indexOf(0, at) - at).toLong()
    }
  }

  private fun ByteArray.indexOf(value: Byte, from: Int): Int {
    for (i in from until size) if (this[i] == value) return i
    return size
  }

  private fun spec(maxMinutes: Long = 120, connections: Int = 1) =
    LiveRecordSpec(part, checkpoint, maxDurationUs = maxMinutes * 60_000_000, connections = connections)

  @Test fun recordsFromTheLiveEdgeEverySegmentInOrderUntilTheStreamEnds() = runBlocking {
    val stream = FakeStream(endAfter = 120)
    val outcome = LiveHlsRecorder(FakeIo()).record(spec(), stream)

    assertEquals(LiveStopReason.ENDED, outcome.reason)
    // The first playlist ends at 100: the recording starts three segments back, i.e. at 100 (the stream's start).
    assertEquals((100L..120L).toList(), recordedSequences())
    assertEquals(21 * SEGMENT_US, outcome.recordedUs)
    assertEquals(Container.TS, outcome.container)
    assertEquals(part.length(), outcome.bytesWritten)
    assertFalse(outcome.hasDiscontinuities)
    assertEquals(0, outcome.missedSegments)
    val saved = checkNotNull(LiveCheckpoint.read(checkpoint))
    assertEquals(120L, saved.lastSequence)
    assertEquals(part.length(), saved.partBytes)
  }

  @Test fun aStreamAlreadyRunningIsJoinedAtItsEdgeNotFromTheWindowStart() = runBlocking {
    val stream = FakeStream(endAfter = 140).apply { clock = 30 * SEGMENT_US / 1000 } // newest is 130
    LiveHlsRecorder(FakeIo()).record(spec(), stream)
    assertEquals((128L..140L).toList(), recordedSequences())
  }

  @Test fun segmentsFetchedAheadKeepTheirOrder() = runBlocking {
    val stream = FakeStream(endAfter = 140).apply { clock = 30 * SEGMENT_US / 1000 }
    // Fall behind: the playlist is read only after several segments appeared.
    val io = FakeIo()
    LiveHlsRecorder(io).record(spec(connections = 3), stream)
    assertEquals((128L..140L).toList(), recordedSequences())
  }

  @Test fun aDiscontinuityIsRecordedAsOne() = runBlocking {
    val stream = FakeStream(endAfter = 110, discontinuityOf = { seq -> if (seq >= 105) 1 else 0 })
    val outcome = LiveHlsRecorder(FakeIo()).record(spec(), stream)
    assertEquals((100L..110L).toList(), recordedSequences())
    assertTrue(outcome.hasDiscontinuities)
  }

  @Test fun segmentsThatLeftTheWindowOrAreGoneAreCountedAsMissed() = runBlocking {
    val stream = object : FakeStream(endAfter = 130) {
      var jumped = false

      override suspend fun pause(ms: Long): Boolean {
        // Once, the app is not looking for a while: the window slides past 8 segments.
        if (!jumped && clock > 5 * SEGMENT_US / 1000) {
          jumped = true
          clock += 12 * SEGMENT_US / 1000
        }
        return super.pause(ms)
      }
    }
    val io = FakeIo().apply { missing += 125L }
    val outcome = LiveHlsRecorder(io).record(spec(), stream)
    val sequences = recordedSequences()
    assertEquals(LiveStopReason.ENDED, outcome.reason)
    assertTrue("in order: $sequences", sequences.zipWithNext().all { (a, b) -> b > a })
    assertFalse("the 404 is skipped", 125L in sequences)
    assertTrue("a gap and the 404 are missed (${outcome.missedSegments})", outcome.missedSegments >= 2)
    assertEquals(130L, sequences.last())
  }

  @Test fun aDroppedConnectionIsRetriedOnTheNextReload() = runBlocking {
    val stream = FakeStream(endAfter = 110)
    val io = FakeIo().apply { offlineOnce += 104L }
    LiveHlsRecorder(io).record(spec(), stream)
    assertEquals((100L..110L).toList(), recordedSequences())
  }

  @Test fun aStalledStreamEndsTheRecordingWithWhatItHas() = runBlocking {
    val stream = FakeStream(stallAt = 10 * SEGMENT_US / 1000)
    val outcome = LiveHlsRecorder(FakeIo()).record(spec(), stream)
    assertEquals(LiveStopReason.STALLED, outcome.reason)
    assertEquals((100L..110L).toList(), recordedSequences())
    assertTrue("waited at least the stall limit", stream.clock >= 10 * SEGMENT_US / 1000 + LiveHlsRecorder.STALL_MIN_MS)
  }

  @Test fun aNetworkThatStaysDownIsAStallToo() = runBlocking {
    val stream = FakeStream(failingWindows = 1_000)
    val outcome = LiveHlsRecorder(FakeIo()).record(spec(), stream)
    assertEquals(LiveStopReason.STALLED, outcome.reason)
    assertEquals(0L, outcome.bytesWritten)
  }

  @Test fun theMaximumLengthStopsTheRecording() = runBlocking {
    val stream = FakeStream()
    // 1 minute at 6 s segments: 10 segments.
    val outcome = LiveHlsRecorder(FakeIo()).record(spec(maxMinutes = 1), stream)
    assertEquals(LiveStopReason.MAX_DURATION, outcome.reason)
    assertEquals(60_000_000L, outcome.recordedUs)
    assertEquals(10, recordedSequences().size)
  }

  @Test fun stopKeepsWhatWasRecorded() = runBlocking {
    val stream = FakeStream().apply { stopAfterWindows = 4 }
    val outcome = LiveHlsRecorder(FakeIo()).record(spec(), stream)
    assertEquals(LiveStopReason.STOPPED, outcome.reason)
    assertTrue(outcome.bytesWritten > 0)
    assertEquals(part.length(), outcome.bytesWritten)
  }

  @Test fun lowStorageStopsBeforeTheFinalCopyCouldNotFit() = runBlocking {
    val stream = FakeStream().apply { free = LiveHlsRecorder.LIVE_FREE_MARGIN_BYTES + 3 * PACKETS * 188 }
    val outcome = LiveHlsRecorder(FakeIo()).record(spec(), stream)
    assertEquals(LiveStopReason.LOW_STORAGE, outcome.reason)
    // Room for the margin plus what is recorded: it stops once recorded bytes eat into the margin.
    assertTrue(recordedSequences().size in 1..4)
  }

  @Test fun aKilledRecordingLeavesExactlyTheSegmentsItsCheckpointNames() = runBlocking {
    val stream = FakeStream()
    val io = FakeIo().apply {
      hangOn = 103
      hang = CompletableDeferred()
    }
    val job = async { LiveHlsRecorder(io).record(spec(), stream) }
    io.hang!!.await()
    job.cancel()
    runCatching { job.await() }

    val saved = checkNotNull(LiveCheckpoint.read(checkpoint))
    assertEquals("the half segment is cut off", saved.partBytes, part.length())
    assertEquals(102L, saved.lastSequence)
    assertEquals((100L..102L).toList(), recordedSequences())
    assertEquals(3 * SEGMENT_US, saved.recordedUs)
  }

  private companion object {
    const val SEGMENT_US = 6_000_000L
    const val WINDOW = 6
    const val PACKETS = 4
  }
}
