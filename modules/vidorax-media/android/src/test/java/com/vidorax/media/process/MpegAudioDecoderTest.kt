package com.vidorax.media.process

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Layer II decoder against its reference. Fixtures: 1 s streams from ffmpeg's `mp2` encoder covering every
 * allocation table — 48 kHz stereo 192 kb/s (a 1 kHz sine left, pink noise right; table B.2a), 44.1 kHz mono 48 kb/s
 * (low rate, B.2c), 32 kHz stereo 256 kb/s (30 subbands, B.2b) and MPEG-2 24 kHz stereo 96 kb/s (13818-3 B.1). The
 * expected hashes are minimp3's own output for the same files (C, scalar path, no fused multiply-add), which agrees
 * with ffmpeg's decoder to ≥ 70 dB SNR (2 LSB at most): the port must match it sample for sample.
 */
class MpegAudioDecoderTest {
  private class Decoded(val pcm: ShortArray, val frames: Int, val sampleRate: Int, val channels: Int)

  private fun bytes(name: String): ByteArray =
    checkNotNull(javaClass.getResourceAsStream("/media/process/$name")) { "missing fixture $name" }.use { it.readBytes() }

  /** Frame by frame, as Media3 hands them over (one frame per sample). */
  private fun decode(data: ByteArray): Decoded {
    val decoder = MpegAudioDecoder()
    val out = ArrayList<Short>()
    val pcm = ShortArray(MpegAudioDecoder.SAMPLES_PER_FRAME * 2)
    var at = 0
    var frames = 0
    var rate = 0
    var channels = 0
    while (at < data.size) {
      val header = MpegAudioDecoder.Header.read(data, at, data.size - at) ?: break
      val size = header.frameBytes
      val info = decoder.decode(data, at, size, pcm) ?: break
      for (i in 0 until info.samplesPerChannel * info.channels) out += pcm[i]
      rate = info.sampleRate
      channels = info.channels
      frames++
      at += size
    }
    return Decoded(out.toShortArray(), frames, rate, channels)
  }

  private fun sha256(pcm: ShortArray): String {
    val buffer = ByteBuffer.allocate(pcm.size * 2).order(ByteOrder.LITTLE_ENDIAN)
    pcm.forEach { buffer.putShort(it) }
    return MessageDigest.getInstance("SHA-256").digest(buffer.array()).joinToString("") { "%02x".format(it) }
  }

  private fun assertMatchesReference(name: String, frames: Int, rate: Int, channels: Int, sha: String) {
    val decoded = decode(bytes(name))
    assertEquals("$name frames", frames, decoded.frames)
    assertEquals("$name sample rate", rate, decoded.sampleRate)
    assertEquals("$name channels", channels, decoded.channels)
    assertEquals("$name samples", frames * 1152 * channels, decoded.pcm.size)
    assertEquals("$name is minimp3's output, sample for sample", sha, sha256(decoded.pcm))
  }

  @Test fun mpeg1StereoAt48kHz() =
    assertMatchesReference("mp2-s48-stereo.mp2", 42, 48_000, 2, "c3f1bd23af2953ca030676474a26a4d6d863594441f2fa65cd560b525ce35d97")

  @Test fun mpeg1MonoAtALowBitrate() =
    assertMatchesReference("mp2-s44-mono-lowrate.mp2", 39, 44_100, 1, "1ed91c629cac412802b9039a8898b53dc862dde53e7d178dff220af663107762")

  @Test fun mpeg1HighRateUsesThirtySubbands() =
    assertMatchesReference("mp2-s32-stereo-high.mp2", 28, 32_000, 2, "88dbc875f19974fefaa2eaf9c07e57f6ac41ade278662f4ffeb1ccbc78e4d72b")

  @Test fun mpeg2LowSamplingFrequency() =
    assertMatchesReference("mp2-s24-lsf.mp2", 21, 24_000, 2, "13d54fd56f0411298b1dcaee738596cebbb3377cf430224a185eaa41dd6d7bda")

  @Test fun theLeftChannelIsTheSineThatWentIn() {
    val decoded = decode(bytes("mp2-s48-stereo.mp2"))
    // Zero crossings of the left channel over the middle half second: a 1 kHz tone crosses 1000 times.
    var crossings = 0
    var previous = decoded.pcm[2 * 12_000].toInt()
    for (i in 12_001 until 36_000) {
      val sample = decoded.pcm[2 * i].toInt()
      if ((previous < 0) != (sample < 0)) crossings++
      previous = sample
    }
    assertTrue("$crossings crossings in 0.5 s", crossings in 990..1010)
  }

  @Test fun onlyWholeLayerTwoFramesAreDecoded() {
    val data = bytes("mp2-s48-stereo.mp2")
    val header = checkNotNull(MpegAudioDecoder.Header.read(data, 0, data.size))
    assertEquals(2, header.layer)
    assertTrue(MpegAudioDecoder.isLayer2Frame(data, 0, header.frameBytes))
    val pcm = ShortArray(MpegAudioDecoder.SAMPLES_PER_FRAME * 2)
    assertNull("a cut frame", MpegAudioDecoder().decode(data, 0, header.frameBytes - 10, pcm))
    assertNull("not a frame", MpegAudioDecoder().decode(ByteArray(64), 0, 64, pcm))
    // An MP3 (Layer III) header is not Layer II.
    val layer3 = byteArrayOf(0xFF.toByte(), 0xFB.toByte(), 0x90.toByte(), 0x64) + ByteArray(413)
    assertFalse(MpegAudioDecoder.isLayer2Frame(layer3))
    assertNull(MpegAudioDecoder().decode(layer3, 0, layer3.size, pcm))
  }
}
