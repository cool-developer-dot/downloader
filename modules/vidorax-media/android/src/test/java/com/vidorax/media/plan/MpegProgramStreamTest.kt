package com.vidorax.media.plan

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.verify.Verifier
import com.vidorax.media.verify.VerifyExpectation
import com.vidorax.media.verify.VerifyResult
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * F4: recognising MPEG program streams and refusing CSS-scrambled ones. `ps-scrambled.vob` is `ps-dvd.vob` with every
 * video packet's `PES_scrambling_control` set to `01`; `ps-scrambled-late.vob` only from 20 KB on — past what the
 * probe reads, so only the finished-file check can see it.
 */
class MpegProgramStreamTest {
  @get:Rule val tmp = TemporaryFolder()

  private fun bytes(name: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream("/media/process/$name")) { "missing fixture $name" }.use { it.readBytes() }

  private fun file(name: String): File = File(tmp.root, name).apply { writeBytes(bytes(name)) }

  /** What the probe reads: the first 16 KB. */
  private fun probe(name: String): ByteArray = bytes(name).copyOf(16 * 1024)

  @Test fun mpeg1AndMpeg2PackHeadersAreProgramStreams() {
    assertTrue("MPEG-1 system stream", MpegProgramStream.isProgramStream(probe("ps-mpeg1.mpg")))
    assertTrue("MPEG-2 program stream (DVD VOB)", MpegProgramStream.isProgramStream(probe("ps-dvd.vob")))
    assertFalse("an MPEG-TS packet", MpegProgramStream.isProgramStream(byteArrayOf(0x47, 0x40, 0x00, 0x10) + ByteArray(184)))
    assertFalse("a video sequence header alone", MpegProgramStream.isProgramStream(byteArrayOf(0, 0, 1, 0xB3.toByte(), 0x14, 0, 0xF0.toByte(), 0)))
    assertFalse("a pack start code with a bad marker", MpegProgramStream.isProgramStream(byteArrayOf(0, 0, 1, 0xBA.toByte(), 0x00) + ByteArray(16)))
    assertFalse(MpegProgramStream.isProgramStream(ByteArray(3)))
  }

  @Test fun theProbeAcceptsProgramStreamsAndRefusesScrambledOnesAsProtected() {
    for (name in listOf("ps-mpeg1.mpg", "ps-dvd.vob", "ps-ac3.vob")) {
      assertEquals(name, SniffResult.Supported(Container.MPEG_PS), MediaSniffer.sniff(probe(name), "video/mpeg", "https://x.test/$name", null))
    }
    val scrambled = MediaSniffer.sniff(probe("ps-scrambled.vob"), "video/dvd", "https://x.test/movie.vob", null)
    scrambled as SniffResult.Unsupported
    assertEquals(ProbeFailure.DRM_PROTECTED, scrambled.reason)
    assertFalse(MpegProgramStream.isScrambled(bytes("ps-dvd.vob")))
    assertFalse(MpegProgramStream.isScrambled(bytes("ps-mpeg1.mpg")))
    assertTrue(MpegProgramStream.isScrambled(bytes("ps-scrambled.vob")))
  }

  @Test fun theFinishedFileCheckFindsScramblingThatStartsLater() {
    assertEquals(
      "the probe's 16 KB are clear",
      SniffResult.Supported(Container.MPEG_PS),
      MediaSniffer.sniff(probe("ps-scrambled-late.vob"), null, "https://x.test/movie.vob", null),
    )
    val late = Verifier.verify(file("ps-scrambled-late.vob"), VerifyExpectation(container = Container.MPEG_PS))
    late as VerifyResult.Invalid
    assertEquals(ProbeFailure.DRM_PROTECTED, late.reason)
    assertEquals(VerifyResult.Valid, Verifier.verify(file("ps-dvd.vob"), VerifyExpectation(container = Container.MPEG_PS)))
    assertEquals(VerifyResult.Valid, Verifier.verify(file("ps-mpeg1.mpg"), VerifyExpectation(container = Container.MPEG_PS)))
  }

  @Test fun videoPacketsProveAVideo() {
    assertTrue(MpegProgramStream.hasVideoStream(bytes("ps-mpeg1.mpg")))
    assertTrue(MpegProgramStream.hasVideoStream(bytes("ps-dvd.vob")))
    assertFalse("MP2 packets only", MpegProgramStream.hasVideoStream(bytes("ps-audio-only.mpg")))
    assertTrue(MpegProgramStream.hasVideoStream(file("ps-mpeg1.mpg")))
  }

  @Test fun theLibraryLearnsLengthSizeAndCodecFromTheStreamItself() {
    val mpeg1 = checkNotNull(MpegProgramStream.inspect(file("ps-mpeg1.mpg")))
    assertEquals(160, mpeg1.width)
    assertEquals(120, mpeg1.height)
    assertEquals("video/mpeg", mpeg1.videoCodec)
    assertTrue(mpeg1.hasVideo)
    assertTrue("2 s from the clock references (${mpeg1.durationMs} ms)", mpeg1.durationMs!! in 1_700L..2_400L)
    val dvd = checkNotNull(MpegProgramStream.inspect(file("ps-dvd.vob")))
    assertEquals("video/mpeg2", dvd.videoCodec)
    assertEquals(160, dvd.width)
    assertTrue("${dvd.durationMs} ms", dvd.durationMs!! in 1_700L..2_400L)
    val sound = checkNotNull(MpegProgramStream.inspect(file("ps-audio-only.mpg")))
    assertFalse(sound.hasVideo)
    assertEquals(null, sound.videoCodec)
    assertEquals(null, MpegProgramStream.inspect(File(tmp.root, "x.mp4").apply { writeBytes(ByteArray(64)) }))
  }

  @Test fun aDamagedStretchDoesNotStopTheScramblingCheck() {
    // Garbage before the packs: the walk finds the next pack header and still sees the scrambled packets.
    val data = ByteArray(5000) { 0x55 } + bytes("ps-scrambled.vob")
    assertTrue(MpegProgramStream.isScrambled(data))
    assertFalse(MpegProgramStream.isScrambled(ByteArray(5000) { 0x55 } + bytes("ps-dvd.vob")))
  }
}
