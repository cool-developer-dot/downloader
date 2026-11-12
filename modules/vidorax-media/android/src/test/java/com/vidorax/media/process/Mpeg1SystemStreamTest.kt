package com.vidorax.media.process

import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.plan.MpegProgramStream
import java.io.ByteArrayOutputStream
import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** F4: MPEG-1 system streams re-packaged as MPEG-2 program streams — headers only, every payload byte kept. */
class Mpeg1SystemStreamTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun fixture(name: String): File {
    val bytes = checkNotNull(javaClass.getResourceAsStream("/media/process/$name")) { "missing fixture $name" }.use { it.readBytes() }
    return File(tmp.root, name).apply { writeBytes(bytes) }
  }

  /** Per stream id: its payload bytes in order, and its PTS values (90 kHz), read from either packaging. */
  private class Streams(val payloads: Map<Int, ByteArray>, val pts: Map<Int, List<Long>>)

  private fun streams(data: ByteArray): Streams {
    val payloads = HashMap<Int, ByteArrayOutputStream>()
    val pts = HashMap<Int, MutableList<Long>>()
    var at = 0
    while (at + 6 <= data.size) {
      check(data[at].toInt() == 0 && data[at + 1].toInt() == 0 && data[at + 2].toInt() == 1) { "lost sync at $at" }
      val id = data[at + 3].toInt() and 0xFF
      if (id == 0xBA) {
        at += if (data[at + 4].toInt() and 0xC0 == 0x40) 14 + (data[at + 13].toInt() and 7) else 12
        continue
      }
      if (id == 0xB9) {
        at += 4
        continue
      }
      val length = ((data[at + 4].toInt() and 0xFF) shl 8) or (data[at + 5].toInt() and 0xFF)
      val end = at + 6 + length
      if (id in 0xC0..0xEF) {
        var p = at + 6
        var timestamp: Int? = null
        if (data[p].toInt() and 0xC0 == 0x80) { // MPEG-2
          if (data[p + 1].toInt() and 0x80 != 0) timestamp = p + 3
          p += 3 + (data[p + 2].toInt() and 0xFF)
        } else { // MPEG-1
          while (data[p].toInt() and 0xFF == 0xFF) p++
          if (data[p].toInt() and 0xC0 == 0x40) p += 2
          when (data[p].toInt() and 0xF0) {
            0x20 -> { timestamp = p; p += 5 }
            0x30 -> { timestamp = p; p += 10 }
            else -> p += 1
          }
        }
        timestamp?.let { t ->
          val v = ((data[t].toLong() shr 1) and 0x7) shl 30 or
            (((data[t + 1].toLong() and 0xFF) shl 7) or ((data[t + 2].toLong() and 0xFF) shr 1)) shl 15 or
            (((data[t + 3].toLong() and 0xFF) shl 7) or ((data[t + 4].toLong() and 0xFF) shr 1))
          pts.getOrPut(id) { mutableListOf() } += v
        }
        payloads.getOrPut(id) { ByteArrayOutputStream() }.write(data, p, end - p)
      }
      at = end
    }
    return Streams(payloads.mapValues { it.value.toByteArray() }, pts)
  }

  @Test fun repackagesEveryPacketKeepingPayloadsAndTimestamps() {
    val input = fixture("ps-mpeg1.mpg")
    assertTrue(Mpeg1SystemStream.isMpeg1(input))
    val output = File(tmp.root, "out.vob")
    Mpeg1SystemStream.rewrap(input, output)

    val bytes = output.readBytes()
    assertTrue(MpegProgramStream.isProgramStream(bytes))
    assertEquals("an MPEG-2 pack header", 0x40, bytes[4].toInt() and 0xC0)
    assertFalse(Mpeg1SystemStream.isMpeg1(output))
    assertFalse("never marked scrambled", MpegProgramStream.isScrambled(bytes))

    val before = streams(input.readBytes())
    val after = streams(bytes)
    assertEquals(setOf(0xC0, 0xE0), before.payloads.keys)
    assertEquals(before.payloads.keys, after.payloads.keys)
    for (id in before.payloads.keys) {
      assertArrayEquals("stream ${id.toString(16)}: payload byte for byte", before.payloads.getValue(id), after.payloads.getValue(id))
      assertEquals("stream ${id.toString(16)}: same PTS", before.pts[id], after.pts[id])
    }
    assertTrue(after.pts.getValue(0xE0).size > 10)
  }

  @Test fun aCutLastPacketKeepsEverythingBeforeIt() {
    val whole = fixture("ps-mpeg1.mpg").readBytes()
    val cut = File(tmp.root, "cut.mpg").apply { writeBytes(whole.copyOf(whole.size - 1000)) }
    val output = File(tmp.root, "cut.vob")
    Mpeg1SystemStream.rewrap(cut, output)
    val video = streams(output.readBytes()).payloads.getValue(0xE0)
    assertTrue("most of the video survives (${video.size} bytes)", video.size > 40_000)
  }

  @Test fun bytesThatAreNotAStreamAreRefused() {
    val junk = File(tmp.root, "junk.mpg").apply { writeBytes(ByteArray(4096) { 0x55 }) }
    try {
      Mpeg1SystemStream.rewrap(junk, File(tmp.root, "junk.vob"))
      fail("junk was re-packaged")
    } catch (e: ProcessingException) {
      assertEquals(DownloadErrorCode.INVALID_MEDIA, e.code)
    }
    assertFalse(File(tmp.root, "junk.vob").exists())
    assertFalse(Mpeg1SystemStream.isMpeg1(fixture("ps-dvd.vob")))
  }
}
