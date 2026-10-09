package com.vidorax.media.plan

import com.vidorax.media.process.CodecConfig
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the first bytes of a split stream's track file say about it, and codec configs recovered from a frame. */
class TrackSummaryTest {
  private fun fixture(path: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream(path)) { "missing $path" }.use { it.readBytes() }

  private fun prefix(bytes: ByteArray) = bytes.copyOf(minOf(bytes.size, Probe.PROBE_BYTES))

  @Test fun aFastStartVideoFileStatesItsLengthSizeAndTracks() {
    val file = fixture("/media/process/long-video.mp4")
    val summary = MediaSniffer.trackSummary(prefix(file), file.size.toLong())
    assertEquals(true, summary.hasVideo)
    assertEquals(false, summary.hasAudio)
    assertEquals(6_000_000L, summary.durationUs)
    assertEquals(96, summary.width)
    assertEquals(54, summary.height)
    assertFalse(summary.encrypted)
  }

  @Test fun anAudioFileIsSoundOnly() {
    val file = fixture("/media/process/short-audio.m4a")
    val summary = MediaSniffer.trackSummary(prefix(file), file.size.toLong())
    assertEquals(false, summary.hasVideo)
    assertEquals(true, summary.hasAudio)
    assertTrue("~2 s (${summary.durationUs})", summary.durationUs!! in 1_900_000L..2_200_000L)
  }

  @Test fun anOnDemandFileIsMeasuredByTheSidxThatIndexesAllOfIt() {
    val file = fixture("/media/process/global-sidx-video.mp4")
    val summary = MediaSniffer.trackSummary(prefix(file), file.size.toLong())
    assertTrue("~3 s from the global sidx (${summary.durationUs})", summary.durationUs!! in 2_900_000L..3_100_000L)
  }

  @Test fun aPerFragmentSidxSaysNothingAboutTheWholeFile() {
    // Two fragments, each with its own sidx: the first one covers one second of a two-second file.
    val file = fixture("/media/process/split-video.mp4")
    assertNull(MediaSniffer.trackSummary(prefix(file), file.size.toLong()).durationUs)
  }

  @Test fun webmStatesItsTracks() {
    val file = fixture("/media/formats/audio-only.webm")
    val summary = MediaSniffer.trackSummary(prefix(file), file.size.toLong())
    assertEquals(false, summary.hasVideo)
    assertEquals(true, summary.hasAudio)
  }

  @Test fun packedAudioIsSound() {
    val summary = MediaSniffer.trackSummary(byteArrayOf('I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), 4, 0, 0, 0, 0, 0, 0))
    assertEquals(true, summary.hasAudio)
    assertEquals(false, summary.hasVideo)
  }

  @Test fun h264ParameterSetsAreRecoveredFromAnAnnexBKeyFrame() {
    val sps = byteArrayOf(0x67, 0x42, 0x00, 0x1E, 0x11)
    val pps = byteArrayOf(0x68, 0xCE.toByte(), 0x3C, 0x80.toByte())
    val idr = byteArrayOf(0x65, 0x11, 0x22)
    val frame = byteArrayOf(0, 0, 0, 1) + sps + byteArrayOf(0, 0, 1) + pps + byteArrayOf(0, 0, 0, 1) + idr
    val config = CodecConfig.fromFirstSample("video/avc", frame)!!
    assertArrayEquals(byteArrayOf(0, 0, 0, 1) + sps, config[0])
    assertArrayEquals(byteArrayOf(0, 0, 0, 1) + pps, config[1])
    assertNull("no parameter sets, no config", CodecConfig.fromFirstSample("video/avc", byteArrayOf(0, 0, 1) + idr))
  }

  @Test fun mpeg4HeadersBeforeTheFirstVopAreTheDecoderConfig() {
    val vos = byteArrayOf(0, 0, 1, 0xB0.toByte(), 0x01)
    val vol = byteArrayOf(0, 0, 1, 0x20, 0x08, 0xC8.toByte())
    val vop = byteArrayOf(0, 0, 1, 0xB6.toByte(), 0x10)
    val config = CodecConfig.fromFirstSample("video/mp4v-es", vos + vol + vop)!!
    assertArrayEquals(vos + vol, config.single())
    assertNull(CodecConfig.fromFirstSample("video/mp4v-es", vop))
  }
}
