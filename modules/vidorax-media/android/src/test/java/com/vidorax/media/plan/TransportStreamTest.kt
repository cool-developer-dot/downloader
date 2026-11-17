package com.vidorax.media.plan

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.verify.Verifier
import com.vidorax.media.verify.VerifyExpectation
import com.vidorax.media.verify.VerifyResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * MPEG-TS files downloaded on their own (`.ts` links): the program map says which kinds of track the file has, and
 * scrambled packets (conditional access) are protection. Fixtures are ffmpeg files in `media/process`: `av.ts`
 * (H.264 + AAC), `video.ts` (H.264 only), `audio.ts` (AAC only).
 */
class TransportStreamTest {
  @get:Rule val tmp = TemporaryFolder()

  @Test fun readsTheKindsOfTrackFromTheProgramMap() {
    assertEquals(TransportStream.Tracks(hasVideo = true, hasAudio = true), TransportStream.tracks(fixture("av.ts")))
    assertEquals(TransportStream.Tracks(hasVideo = true, hasAudio = false), TransportStream.tracks(fixture("video.ts")))
    assertEquals(TransportStream.Tracks(hasVideo = false, hasAudio = true), TransportStream.tracks(fixture("audio.ts")))
  }

  @Test fun aStreamWithoutAProgramMapProvesNothing() {
    // Packets of an elementary stream only (no PAT/PMT in the bytes read).
    val av = fixture("av.ts")
    val withoutTables = (0 until av.size / 188)
      .map { av.copyOfRange(it * 188, it * 188 + 188) }
      .filter { pidOf(it, 0) != 0 && pidOf(it, 0) != PMT_PID }
      .fold(ByteArray(0)) { acc, packet -> acc + packet }
    assertNull(TransportStream.tracks(withoutTables))
    assertFalse(MediaSniffer.isAudioOnly(withoutTables))
  }

  @Test fun clearStreamsAreNotScrambled() {
    for (name in listOf("av.ts", "video.ts", "audio.ts", "h264-mp2.ts")) {
      assertFalse(name, TransportStream.isScrambled(fixture(name)))
    }
  }

  @Test fun scrambledPacketsAreProtection() {
    assertTrue(TransportStream.isScrambled(scramble(fixture("av.ts"))))
  }

  @Test fun aStreamThatTurnsScrambledAfterTheProbedBytesIsRefusedWhenFinished() {
    // Over 64 KiB of clear packets first: the probe's read sees a clear stream; the finished file is checked further.
    val clear = fixture("av.ts")
    val file = tmp.newFile("late.ts").apply { writeBytes(clear + clear + scramble(clear)) }
    val verdict = Verifier.verify(file, VerifyExpectation(container = Container.TS))
    assertTrue("got $verdict", verdict is VerifyResult.Invalid)
    assertEquals(ProbeFailure.DRM_PROTECTED, (verdict as VerifyResult.Invalid).reason)
  }

  @Test fun aClearStreamIsAValidFinishedFileWhateverTheCallerExpected() {
    val file = tmp.newFile("clear.ts").apply { writeBytes(fixture("av.ts")) }
    assertEquals(VerifyResult.Valid, Verifier.verify(file, VerifyExpectation(container = Container.TS)))
    assertEquals(VerifyResult.Valid, Verifier.verify(file))
  }

  private fun fixture(name: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream("/media/process/$name")) { "missing fixture $name" }.use { it.readBytes() }

  companion object {
    /** ffmpeg's program map PID. */
    private const val PMT_PID = 0x1000

    private fun pidOf(data: ByteArray, at: Int): Int = ((data[at + 1].toInt() and 0x1F) shl 8) or (data[at + 2].toInt() and 0xFF)

    /** [ts] with the scrambling bits of every elementary-stream packet set (tables and padding stay clear). */
    fun scramble(ts: ByteArray): ByteArray {
      val out = ts.copyOf()
      var at = 0
      while (at + 188 <= out.size) {
        val pid = pidOf(out, at)
        if (pid >= 0x20 && pid != PMT_PID && pid != 0x1FFF) out[at + 3] = (out[at + 3].toInt() or 0x80).toByte()
        at += 188
      }
      return out
    }
  }
}
