package com.vidorax.media.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Faran's P17 / P19: the PCM processor expo-video's audio sink runs first (scripts/patch-expo-video.js →
 * VideoPlayerHooks.audioProcessors), one per player. It handles 16-bit and float PCM; anything else (passthrough to an
 * HDMI receiver, offload) bypasses it untouched.
 *
 * P17 #554 Audio Delay — how the shift works: ExoPlayer times the picture by the audio it has played. Silence put in
 * front of the sound makes the clock run ahead of what is heard, so the picture leads the sound by that much (a
 * positive delay: the sound comes later); dropping sound at the start makes the clock fall behind, so the sound leads
 * (a negative delay). The processor keeps the net frames it added or dropped since the last flush (`applied`) and
 * moves it toward the target at each buffer; after a seek (flush) it applies the whole target again. A change while
 * playing is a short silence or a short skip, like every player's audio-delay control. The target is in input frames
 * scaled by the speed, so the delay stays the same in real time at 2× as at 1×.
 *
 * Settings are written from the main thread and read on the playback thread (volatile fields; each buffer reads them
 * once).
 */
@OptIn(UnstableApi::class)
class VidoraAudioProcessor : BaseAudioProcessor() {
  @Volatile private var delayMs = 0
  @Volatile private var speed = 1f

  /** Net frames added (+) or dropped (−) since the last flush. Playback thread only. */
  private var applied = 0L

  /** P17 #554: the sound later (+) or earlier (−) than the picture, in ms, at this playback speed. */
  fun setDelay(delayMs: Int, speed: Float) {
    this.delayMs = delayMs.coerceIn(MIN_DELAY_MS, MAX_DELAY_MS)
    this.speed = if (speed.isFinite() && speed > 0f) speed else 1f
  }

  override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat =
    if (inputAudioFormat.encoding == C.ENCODING_PCM_16BIT || inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) {
      inputAudioFormat
    } else {
      AudioFormat.NOT_SET
    }

  override fun queueInput(inputBuffer: ByteBuffer) {
    // Nothing to process (the pipeline also polls with an empty buffer): the delay waits for the sound itself.
    // Writing anyway would put AudioProcessor.EMPTY_BUFFER into itself.
    if (!inputBuffer.hasRemaining()) return
    val format = inputAudioFormat
    val frameSize = format.bytesPerFrame
    if (frameSize <= 0) {
      val output = replaceOutputBuffer(inputBuffer.remaining())
      output.put(inputBuffer)
      output.flip()
      return
    }
    val inputFrames = inputBuffer.remaining() / frameSize
    val step = DelayPlan.step(
      target = DelayPlan.targetFrames(delayMs, speed, format.sampleRate),
      applied = applied,
      inputFrames = inputFrames.toLong(),
      maxSilenceFrames = format.sampleRate.toLong(),
    )
    applied += step.silenceFrames - step.droppedFrames

    val keepFrames = inputFrames - step.droppedFrames.toInt()
    val output = replaceOutputBuffer(((step.silenceFrames + keepFrames) * frameSize).toInt())
    output.order(ByteOrder.nativeOrder())
    // Silence is zero bytes for both 16-bit and float PCM.
    var silenceBytes = (step.silenceFrames * frameSize).toInt()
    while (silenceBytes > 0) {
      val chunk = minOf(silenceBytes, ZEROS.size)
      output.put(ZEROS, 0, chunk)
      silenceBytes -= chunk
    }
    inputBuffer.position(inputBuffer.position() + (step.droppedFrames * frameSize).toInt())
    if (inputBuffer.hasRemaining()) {
      output.put(inputBuffer)
    }
    output.flip()
  }

  override fun onFlush() {
    // A seek or a new stream: the sink starts its clock again, so the whole delay is applied again.
    applied = 0
  }

  override fun onReset() {
    applied = 0
  }

  companion object {
    const val MIN_DELAY_MS = -3_000
    const val MAX_DELAY_MS = 3_000
    private val ZEROS = ByteArray(8_192)
  }
}

/** Pure arithmetic of the audio delay (JVM-tested). */
object DelayPlan {
  data class Step(val silenceFrames: Long, val droppedFrames: Long)

  /** The net frames the delay needs at this speed and sample rate (positive: silence, negative: dropped sound). */
  fun targetFrames(delayMs: Int, speed: Float, sampleRate: Int): Long =
    (delayMs / 1000.0 * speed * sampleRate).roundToLong()

  /**
   * What this buffer does to move `applied` toward `target`: some silence in front of it (at most `maxSilenceFrames`,
   * the rest at the next buffers), or some of its frames dropped (at most all of them).
   */
  fun step(target: Long, applied: Long, inputFrames: Long, maxSilenceFrames: Long): Step {
    val missing = target - applied
    return when {
      missing > 0 -> Step(silenceFrames = minOf(missing, maxSilenceFrames), droppedFrames = 0)
      missing < 0 -> Step(silenceFrames = 0, droppedFrames = minOf(abs(missing), inputFrames))
      else -> Step(0, 0)
    }
  }
}
