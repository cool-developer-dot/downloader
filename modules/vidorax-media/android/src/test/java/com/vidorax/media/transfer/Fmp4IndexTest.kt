package com.vidorax.media.transfer

import java.io.File
import java.io.RandomAccessFile
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Indexing concatenated fMP4 segments without touching a sample byte. */
class Fmp4IndexTest {
  @get:Rule val tmp = TemporaryFolder()

  private val init = fixture("/media/hls-fmp4/video-init.mp4")
  private val fragment = fixture("/media/hls-fmp4/video0.m4s")

  private fun fixture(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing $path" }.use { it.readBytes() }

  /** Assembles like the transfer does: init, reserved index, segments with their own `sidx` renamed. */
  private fun assemble(segments: List<ByteArray>, reserveFor: Int = segments.size): Pair<File, Long> {
    val file = tmp.newFile()
    RandomAccessFile(file, "rw").use { raf ->
      raf.write(init)
      val indexOffset = raf.filePointer
      var end = Fmp4Index.writePlaceholder(raf, indexOffset, reserveFor)
      for (segment in segments) {
        raf.seek(end)
        raf.write(segment)
        Fmp4Index.neutralizeSegmentIndexes(raf, end, end + segment.size)
        end += segment.size
      }
    }
    return file to init.size.toLong()
  }

  @Test fun eachSegmentsOwnIndexBecomesAFreeBoxOfTheSameSize() {
    val (file, _) = assemble(listOf(fragment, fragment))
    val bytes = file.readBytes()
    assertEquals(init.size + Fmp4Index.placeholderSize(2) + 2 * fragment.size, bytes.size.toLong())
    assertEquals("no segment sidx survives", 0, Fmp4Boxes.topLevel(bytes).count { it.type == "sidx" })
    assertEquals(2, Fmp4Boxes.topLevel(bytes).count { it.type == "moof" })
    // Media bytes are untouched: only the four type bytes of each segment's sidx changed.
    val tail = bytes.copyOfRange(bytes.size - fragment.size, bytes.size)
    assertEquals(fragment.size, tail.size)
    assertEquals(4, fragment.indices.count { fragment[it] != tail[it] })
  }

  @Test fun theReservedBoxBecomesOneIndexOverEveryFragment() {
    val (file, indexOffset) = assemble(listOf(fragment, fragment, fragment))
    val indexed = RandomAccessFile(file, "rw").use {
      Fmp4Index.writeGlobalIndex(it, indexOffset, Fmp4Index.placeholderSize(3), totalDurationUs = 6_000_000)
    }
    assertTrue(indexed)

    val bytes = file.readBytes()
    val sidx = Fmp4Boxes.sidx(bytes, indexOffset.toInt())
    assertEquals(1L, sidx.trackId)
    assertEquals(10_240L, sidx.timescale)
    assertEquals(3, sidx.sizes.size)
    val firstMoof = Fmp4Boxes.topLevel(bytes).first { it.type == "moof" }.offset
    assertEquals("first_offset lands on the first fragment", firstMoof.toLong(), indexOffset + sidx.boxSize + sidx.firstOffset)
    assertEquals("the references cover the file to its end", bytes.size.toLong() - firstMoof, sidx.sizes.sum())
    assertEquals(1, Fmp4Boxes.topLevel(bytes).count { it.type == "sidx" })
  }

  @Test fun moreFragmentsThanRoomAreGroupedAndTheRestIsPadded() {
    val (file, indexOffset) = assemble(List(5) { fragment }, reserveFor = 2)
    RandomAccessFile(file, "rw").use { assertTrue(Fmp4Index.writeGlobalIndex(it, indexOffset, Fmp4Index.placeholderSize(2), 10_000_000)) }
    val bytes = file.readBytes()
    val sidx = Fmp4Boxes.sidx(bytes, indexOffset.toInt())
    assertEquals(2, sidx.sizes.size)
    assertEquals(bytes.size.toLong() - Fmp4Boxes.topLevel(bytes).first { it.type == "moof" }.offset, sidx.sizes.sum())
  }

  @Test fun rewritingTheIndexIsIdempotent() {
    val (file, indexOffset) = assemble(listOf(fragment, fragment))
    RandomAccessFile(file, "rw").use { Fmp4Index.writeGlobalIndex(it, indexOffset, Fmp4Index.placeholderSize(2), 4_000_000) }
    val once = file.readBytes()
    RandomAccessFile(file, "rw").use { Fmp4Index.writeGlobalIndex(it, indexOffset, Fmp4Index.placeholderSize(2), 4_000_000) }
    assertArrayEquals(once, file.readBytes())
  }

  @Test fun withoutAVideoTrackTheFileIsLeftPlayableButUnindexed() {
    val file = tmp.newFile()
    RandomAccessFile(file, "rw").use { raf ->
      raf.write(Fmp4Boxes.box("ftyp", "iso5".toByteArray() + ByteArray(4)))
      raf.write(Fmp4Boxes.box("moov", ByteArray(0)))
      val at = raf.filePointer
      val end = Fmp4Index.writePlaceholder(raf, at, 1)
      raf.seek(end)
      raf.write(fragment)
      assertFalse(Fmp4Index.writeGlobalIndex(raf, at, Fmp4Index.placeholderSize(1), 2_000_000))
    }
    assertEquals(0, Fmp4Boxes.topLevel(file.readBytes()).count { it.type == "sidx" && it.offset < 100 })
  }
}

/** Minimal ISO-BMFF reading for assertions. */
internal object Fmp4Boxes {
  data class Box(val type: String, val offset: Int, val size: Int)

  data class Sidx(val boxSize: Long, val trackId: Long, val timescale: Long, val firstOffset: Long, val sizes: List<Long>, val durations: List<Long>)

  fun topLevel(bytes: ByteArray): List<Box> {
    val out = mutableListOf<Box>()
    var offset = 0
    while (offset + 8 <= bytes.size) {
      val size = u32(bytes, offset).toInt()
      if (size < 8) break
      out += Box(String(bytes, offset + 4, 4, Charsets.ISO_8859_1), offset, size)
      offset += size
    }
    return out
  }

  fun sidx(bytes: ByteArray, at: Int): Sidx {
    check(String(bytes, at + 4, 4, Charsets.ISO_8859_1) == "sidx") { "no sidx at $at" }
    // size 4, type 4, version/flags 4, reference_ID 4 (@12), timescale 4 (@16), EPT 8 (@20), first_offset 8 (@28),
    // reserved 2 (@36), reference_count 2 (@38), then 12-byte references from @40.
    val count = ((bytes[at + 38].toInt() and 0xFF) shl 8) or (bytes[at + 39].toInt() and 0xFF)
    val sizes = (0 until count).map { u32(bytes, at + 40 + 12 * it) and 0x7FFFFFFF }
    val durations = (0 until count).map { u32(bytes, at + 44 + 12 * it) }
    return Sidx(u32(bytes, at), u32(bytes, at + 12), u32(bytes, at + 16), u64(bytes, at + 28), sizes, durations)
  }

  fun box(type: String, payload: ByteArray): ByteArray {
    val size = 8 + payload.size
    return byteArrayOf((size ushr 24).toByte(), (size ushr 16).toByte(), (size ushr 8).toByte(), size.toByte()) +
      type.toByteArray(Charsets.US_ASCII) + payload
  }

  private fun u32(b: ByteArray, o: Int): Long =
    ((b[o].toLong() and 0xFF) shl 24) or ((b[o + 1].toLong() and 0xFF) shl 16) or ((b[o + 2].toLong() and 0xFF) shl 8) or (b[o + 3].toLong() and 0xFF)

  private fun u64(b: ByteArray, o: Int): Long {
    var v = 0L
    for (i in 0 until 8) v = (v shl 8) or (b[o + i].toLong() and 0xFF)
    return v
  }
}
