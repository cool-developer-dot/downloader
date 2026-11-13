package com.vidorax.media.transfer

import com.vidorax.media.process.MediaFiles
import com.vidorax.media.process.TrackContainer
import com.vidorax.media.process.TrackKind
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * [TsContinuity]: the continuity counters of joined HLS segments, and what Media3's TS reader (the remuxer's) makes of
 * a join before and after renumbering.
 */
@RunWith(RobolectricTestRunner::class)
class TsContinuityTest {
  @get:Rule val tmp = TemporaryFolder()

  private val seg0 = fixture("/media/hls-ts/seg0.ts")
  private val seg1 = fixture("/media/hls-ts/seg1.ts")
  private val other = fixture("/media/hls-ts/other.ts")

  private fun fixture(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing fixture $path" }.use { it.readBytes() }

  private fun packet(pid: Int, counter: Int, payload: Boolean = true, fill: Int = 0xAB): ByteArray =
    ByteArray(TsContinuity.PACKET) { fill.toByte() }.also {
      it[0] = 0x47
      it[1] = ((pid shr 8) and 0x1F).toByte()
      it[2] = (pid and 0xFF).toByte()
      it[3] = ((if (payload) 0x10 else 0x20) or counter).toByte()
    }

  private fun counters(bytes: ByteArray, pid: Int): List<Int> =
    (0 until bytes.size / TsContinuity.PACKET).map { it * TsContinuity.PACKET }
      .filter { (((bytes[it + 1].toInt() and 0x1F) shl 8) or (bytes[it + 2].toInt() and 0xFF)) == pid }
      .map { bytes[it + 3].toInt() and 0x0F }

  private fun samples(bytes: ByteArray): Map<TrackKind, Int> {
    val file = File(tmp.root, "joined-${System.nanoTime()}.ts").apply { writeBytes(bytes) }
    val extractor = MediaFiles.open(file, TrackContainer.TS)
    try {
      val kinds = (0 until extractor.trackCount).associateWith { MediaFiles.track(it, extractor.getTrackFormat(it))!!.kind }
      kinds.keys.forEach { extractor.selectTrack(it) }
      val counts = HashMap<TrackKind, Int>()
      val buffer = ByteBuffer.allocateDirect(1 shl 20)
      while (extractor.sampleTrackIndex >= 0) {
        buffer.clear()
        extractor.readSampleData(buffer, 0)
        counts.merge(kinds.getValue(extractor.sampleTrackIndex), 1, Int::plus)
        extractor.advance()
      }
      return counts
    } finally {
      extractor.release()
    }
  }

  @Test fun everyPacketOfAPidFollowsThePreviousOneAcrossSegments() {
    val continuity = TsContinuity()
    val first = packet(0x100, 7) + packet(0x100, 8) + packet(0x101, 3)
    val second = packet(0x100, 0) + packet(0x101, 0) + packet(0x100, 1)
    continuity.renumberPackets(first, first.size)
    continuity.renumberPackets(second, second.size)

    assertEquals("the first packet keeps its number", listOf(7, 8), counters(first, 0x100))
    assertEquals(listOf(9, 10), counters(second, 0x100))
    assertEquals(listOf(4), counters(second, 0x101))
    assertEquals(mapOf(0x100 to 10, 0x101 to 4), continuity.state)
  }

  @Test fun onlyTheCounterNibbleChanges() {
    val before = packet(0x100, 1) + packet(0x100, 9, fill = 0x5C)
    val after = before.copyOf()
    TsContinuity(mapOf(0x100 to 14)).renumberPackets(after, after.size)
    for (i in before.indices) {
      if (i % TsContinuity.PACKET == 3) {
        assertEquals("flags kept", before[i].toInt() and 0xF0, after[i].toInt() and 0xF0)
      } else {
        assertEquals("byte $i", before[i], after[i])
      }
    }
    assertEquals(listOf(15, 0), counters(after, 0x100))
  }

  @Test fun theNullPidIsLeftAlone() {
    val bytes = packet(0x1FFF, 5) + packet(0x1FFF, 5)
    TsContinuity(mapOf(0x1FFF to 1)).renumberPackets(bytes, bytes.size)
    assertEquals(listOf(5, 5), counters(bytes, 0x1FFF))
  }

  @Test fun renumberingAgainChangesNothing() {
    val once = TsJoin.of(seg0, other, seg1)
    val twice = once.copyOf()
    TsContinuity().renumberPackets(twice, twice.size)
    assertArrayEquals(once, twice)
  }

  @Test fun aRegionThatStopsBeingPacketsIsLeftFromThereAndTheNumberingStartsOver() = runBlocking {
    val file = File(tmp.root, "mixed.part")
    val clean = packet(0x100, 2) + packet(0x100, 9)
    val garbage = ByteArray(TsContinuity.PACKET) { 0x11 }
    file.writeBytes(clean + garbage + packet(0x100, 4))
    val continuity = TsContinuity(mapOf(0x100 to 0))
    RandomAccessFile(file, "rw").use { continuity.renumber(it, 0, file.length()) }

    val bytes = file.readBytes()
    assertEquals(listOf(1, 2, 4), counters(bytes, 0x100))
    assertArrayEquals(garbage, bytes.copyOfRange(clean.size, clean.size + garbage.size))
    assertTrue("state forgotten after the break", continuity.state.isEmpty())
  }

  @Test fun inPlaceRenumberingOfASegmentEqualsTheJoin() = runBlocking {
    val file = File(tmp.root, "download.part")
    file.writeBytes(seg0 + other)
    val continuity = TsContinuity()
    RandomAccessFile(file, "rw").use { raf ->
      continuity.renumber(raf, 0, seg0.size.toLong())
      continuity.renumber(raf, seg0.size.toLong(), file.length())
    }
    assertArrayEquals(TsJoin.of(seg0, other), file.readBytes())
  }

  @Test fun theTsReaderLosesAFrameAtARawJoinAndNoneAfterRenumbering() {
    val alone = samples(seg0).getValue(TrackKind.VIDEO) + samples(other).getValue(TrackKind.VIDEO)
    val raw = samples(seg0 + other).getValue(TrackKind.VIDEO)
    val joined = samples(TsJoin.of(seg0, other)).getValue(TrackKind.VIDEO)

    assertEquals("the counter jump at the raw join drops the frame being assembled", alone - 1, raw)
    assertEquals(alone, joined)
  }
}
