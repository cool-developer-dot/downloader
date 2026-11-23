package com.vidorax.media.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class VidoraAudioProcessorTest {
  private val stereo16 = AudioFormat(48_000, 2, C.ENCODING_PCM_16BIT)

  private fun pcm(frames: Int, value: Short = 1000): ByteBuffer {
    val buffer = ByteBuffer.allocateDirect(frames * 4).order(ByteOrder.nativeOrder())
    repeat(frames * 2) { buffer.putShort(value) }
    buffer.flip()
    return buffer
  }

  private fun VidoraAudioProcessor.run(input: ByteBuffer): ByteBuffer {
    queueInput(input)
    return getOutput()
  }

  @Test
  fun delayPlanMovesTowardTheTarget() {
    assertEquals(4_800, DelayPlan.targetFrames(100, 1f, 48_000))
    assertEquals(9_600, DelayPlan.targetFrames(100, 2f, 48_000))
    assertEquals(-2_205, DelayPlan.targetFrames(-50, 1f, 44_100))
    assertEquals(DelayPlan.Step(4_800, 0), DelayPlan.step(4_800, 0, 1_024, 48_000))
    assertEquals(DelayPlan.Step(48_000, 0), DelayPlan.step(96_000, 0, 1_024, 48_000))
    assertEquals(DelayPlan.Step(0, 1_024), DelayPlan.step(-4_800, 0, 1_024, 48_000))
    assertEquals(DelayPlan.Step(0, 800), DelayPlan.step(-4_800, -4_000, 1_024, 48_000))
    assertEquals(DelayPlan.Step(0, 0), DelayPlan.step(4_800, 4_800, 1_024, 48_000))
  }

  @Test
  fun bypassesWhatIsNotPcm() {
    val processor = VidoraAudioProcessor()
    processor.configure(AudioFormat(48_000, 6, C.ENCODING_AC3))
    assertFalse(processor.isActive)
    processor.configure(stereo16)
    assertTrue(processor.isActive)
  }

  @Test
  fun passesSoundThroughUnchangedWithoutADelay() {
    val processor = VidoraAudioProcessor()
    processor.configure(stereo16)
    processor.flush()
    val out = processor.run(pcm(256))
    assertEquals(256 * 4, out.remaining())
    assertEquals(1000.toShort(), out.order(ByteOrder.nativeOrder()).getShort(0))
  }

  @Test
  fun aPositiveDelayPutsSilenceFirstOnceThenAgainAfterASeek() {
    val processor = VidoraAudioProcessor()
    processor.configure(stereo16)
    processor.flush()
    processor.setDelay(10, 1f) // 480 frames at 48 kHz
    val first = processor.run(pcm(256))
    assertEquals((480 + 256) * 4, first.remaining())
    assertEquals(0.toShort(), first.getShort(0))
    assertEquals(1000.toShort(), first.getShort(480 * 4))
    val second = processor.run(pcm(256))
    assertEquals(256 * 4, second.remaining())
    processor.flush()
    assertEquals((480 + 256) * 4, processor.run(pcm(256)).remaining())
  }

  @Test
  fun aNegativeDelayDropsTheStartOfTheSound() {
    val processor = VidoraAudioProcessor()
    processor.configure(stereo16)
    processor.flush()
    processor.setDelay(-10, 1f) // drop 480 frames
    assertEquals(0, processor.run(pcm(256)).remaining())
    assertEquals((256 - 224) * 4, processor.run(pcm(256)).remaining())
    assertEquals(256 * 4, processor.run(pcm(256)).remaining())
  }

  @Test
  fun loweringTheDelayWhilePlayingSkipsTheDifference() {
    val processor = VidoraAudioProcessor()
    processor.configure(stereo16)
    processor.flush()
    processor.setDelay(10, 1f)
    processor.run(pcm(256))
    processor.setDelay(5, 1f) // 240 frames fewer
    assertEquals((256 - 240) * 4, processor.run(pcm(256)).remaining())
  }

  @Test
  fun anEmptyBufferDoesNothing() {
    // Media3's pipeline polls each processor with AudioProcessor.EMPTY_BUFFER; writing it into an empty output (the
    // same shared buffer) threw "The source buffer is this buffer" and stopped playback (found on the device).
    val processor = VidoraAudioProcessor()
    processor.configure(stereo16)
    processor.flush()
    processor.queueInput(androidx.media3.common.audio.AudioProcessor.EMPTY_BUFFER)
    assertEquals(0, processor.getOutput().remaining())
    processor.setDelay(10, 1f)
    processor.queueInput(androidx.media3.common.audio.AudioProcessor.EMPTY_BUFFER)
    assertEquals(0, processor.getOutput().remaining())
    // The delay waits for the sound itself.
    assertEquals((480 + 16) * 4, processor.run(pcm(16)).remaining())
  }

  @Test
  fun aBufferDroppedWholeLeavesNothingAndDoesNotThrow() {
    val processor = VidoraAudioProcessor()
    processor.configure(stereo16)
    processor.flush()
    processor.setDelay(-100, 1f)
    assertEquals(0, processor.run(pcm(16)).remaining())
  }

  @Test
  fun clampsTheDelay() {
    val processor = VidoraAudioProcessor()
    processor.configure(stereo16)
    processor.flush()
    processor.setDelay(60_000, 1f)
    // At most one second of silence per buffer; the clamp is 3 s.
    assertEquals((48_000 + 16) * 4, processor.run(pcm(16)).remaining())
  }
}
