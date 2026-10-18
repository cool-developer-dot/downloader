package com.vidorax.media.process

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.MediaFormatUtil
import androidx.media3.common.util.UnstableApi
import androidx.media3.muxer.BufferInfo
import androidx.media3.muxer.Mp4Muxer
import androidx.media3.muxer.MuxerException
import com.vidorax.media.model.DownloadErrorCode
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/**
 * Re-encodes an MPEG audio Layer II track — which no Android device can decode — to AAC in its own MP4 (F4): Media3's
 * extractor reads the frames, [MpegAudioDecoder] turns them into PCM, the platform's AAC encoder (on every Android
 * device) encodes it and Media3's `Mp4Muxer` writes it. Like [TransformerTranscoder]'s, the output starts at zero; the
 * processor puts it back where the source track started. A frame that does not decode becomes silence of its length,
 * so the sound stays in sync with the picture; a stream with no decodable frame fails.
 */
@OptIn(UnstableApi::class)
internal class MpegAudioTranscoder : Transcoder {
  override suspend fun transcode(request: TranscodeRequest, output: File, onProgress: (Double) -> Unit): TranscodeOutcome {
    if (request.track != TrackKind.AUDIO) {
      throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "only an MPEG audio track is converted here")
    }
    return withContext(Dispatchers.IO) {
      val context = currentCoroutineContext()
      output.delete()
      output.parentFile?.mkdirs()
      var done = false
      try {
        convert(request.input, output, onProgress) { context.ensureActive() }
        done = true
        TranscodeOutcome(output, MimeTypes.AUDIO_AAC)
      } catch (e: ProcessingException) {
        throw e
      } catch (e: CancellationException) {
        throw e
      } catch (e: IOException) {
        if (isOutOfSpace(e)) throw ProcessingException(DownloadErrorCode.NO_SPACE, "Not enough storage left to finish this video", e)
        throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "audio conversion failed: ${e.message}", e)
      } catch (e: RuntimeException) {
        // MediaCodec/extractor state errors: a failed conversion, never a crash of the download worker.
        throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "audio conversion failed: ${e.message}", e)
      } finally {
        if (!done) output.delete()
      }
    }
  }

  private fun convert(input: File, output: File, onProgress: (Double) -> Unit, ensureActive: () -> Unit) {
    val extractor = MediaFiles.open(input, TrackContainers.sniff(input))
    var encoder: MediaCodec? = null
    var muxer: Mp4Muxer? = null
    val stream = FileOutputStream(output)
    try {
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME) == MpegAudioDecoder.MIME_TYPE
      } ?: throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "no MPEG audio Layer II track")
      val trackFormat = extractor.getTrackFormat(track)
      val durationUs = if (trackFormat.containsKey(MediaFormat.KEY_DURATION)) trackFormat.getLong(MediaFormat.KEY_DURATION) else 0L
      extractor.selectTrack(track)

      val decoder = MpegAudioDecoder()
      val frame = ByteBuffer.allocate(MAX_FRAME_BYTES)
      val pcm = ShortArray(MpegAudioDecoder.SAMPLES_PER_FRAME * 2)
      val queue = PcmQueue()
      var sampleRate = 0
      var channels = 0
      var framesRead = 0
      var framesLost = 0
      var lostBeforeFormat = 0
      var inputDone = false
      var eosQueued = false
      var samplesQueued = 0L // per channel, into the encoder
      var muxerTrack = -1
      val info = MediaCodec.BufferInfo()

      while (true) {
        ensureActive()
        // Read and decode until there is enough sound for the encoder, or the track ends.
        while (!inputDone && queue.frames(channels) < QUEUE_LOW_FRAMES) {
          if (extractor.sampleTrackIndex < 0) {
            inputDone = true
            break
          }
          frame.clear()
          val size = extractor.readSampleData(frame, 0)
          val timeUs = extractor.sampleTime
          extractor.advance()
          if (size <= 0) continue
          framesRead++
          val decoded = decoder.decode(frame.array(), frame.arrayOffset(), size, pcm)
          if (decoded == null) {
            framesLost++
            if (channels == 0) lostBeforeFormat++ else queue.appendSilence(MpegAudioDecoder.SAMPLES_PER_FRAME * channels)
            continue
          }
          if (encoder == null) {
            sampleRate = decoded.sampleRate
            channels = decoded.channels
            encoder = startEncoder(sampleRate, channels)
            // Frames lost before the first good one keep their place as silence.
            queue.appendSilence(lostBeforeFormat * MpegAudioDecoder.SAMPLES_PER_FRAME * channels)
          } else if (decoded.sampleRate != sampleRate || decoded.channels != channels) {
            throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "the MPEG audio format changes mid-stream")
          }
          queue.append(pcm, decoded.samplesPerChannel * decoded.channels)
          if (durationUs > 0 && timeUs >= 0) onProgress((timeUs.toDouble() / durationUs).coerceIn(0.0, 0.99))
        }
        val codec = encoder ?: throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "no decodable MPEG audio frame")
        if (framesRead > MIN_FRAMES_FOR_LOSS_CHECK && framesLost * 2 > framesRead) {
          throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "most MPEG audio frames do not decode ($framesLost of $framesRead)")
        }

        // Feed the encoder: PCM while there is some, then the end of stream.
        if (!eosQueued && (queue.isNotEmpty() || inputDone)) {
          val index = codec.dequeueInputBuffer(CODEC_TIMEOUT_US)
          if (index >= 0) {
            val buffer = checkNotNull(codec.getInputBuffer(index))
            buffer.clear()
            val ptsUs = samplesQueued * 1_000_000L / sampleRate
            if (queue.isNotEmpty()) {
              val frames = minOf(queue.frames(channels), buffer.remaining() / (2 * channels))
              queue.drainInto(buffer, frames * channels)
              codec.queueInputBuffer(index, 0, frames * channels * 2, ptsUs, 0)
              samplesQueued += frames
            } else {
              codec.queueInputBuffer(index, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              eosQueued = true
            }
          }
        }

        // Drain whatever the encoder has ready.
        var ended = false
        while (true) {
          val index = codec.dequeueOutputBuffer(info, if (eosQueued) CODEC_TIMEOUT_US else 0L)
          if (index == MediaCodec.INFO_TRY_AGAIN_LATER) break
          if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            val built = muxer ?: openMuxer(stream).also { muxer = it }
            muxerTrack = try {
              built.addTrack(MediaFormatUtil.createFormatFromMediaFormat(codec.outputFormat))
            } catch (e: MuxerException) {
              throw ProcessingException(DownloadErrorCode.MUX_FAILED, "could not add the AAC track: ${e.message}", e)
            }
            continue
          }
          if (index < 0) continue
          val buffer = codec.getOutputBuffer(index)
          val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (buffer != null && info.size > 0 && !isConfig) {
            if (muxerTrack < 0) throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "the AAC encoder gave no format")
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            try {
              checkNotNull(muxer).writeSampleData(muxerTrack, buffer, BufferInfo(info.presentationTimeUs, info.size, C.BUFFER_FLAG_KEY_FRAME))
            } catch (e: MuxerException) {
              throw ProcessingException(DownloadErrorCode.MUX_FAILED, "writing an AAC sample failed: ${e.message}", e)
            }
          }
          codec.releaseOutputBuffer(index, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
            ended = true
            break
          }
        }
        if (ended) break
      }
      try {
        checkNotNull(muxer) { "no AAC output" }.close()
      } catch (e: MuxerException) {
        throw ProcessingException(DownloadErrorCode.MUX_FAILED, "finishing the AAC file failed: ${e.message}", e)
      }
      muxer = null
      onProgress(1.0)
    } finally {
      muxer?.let { runCatching { it.close() } }
      encoder?.let {
        runCatching { it.stop() }
        runCatching { it.release() }
      }
      runCatching { stream.close() }
      extractor.release()
    }
  }

  private fun startEncoder(sampleRate: Int, channels: Int): MediaCodec {
    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, AAC_BITRATE_PER_CHANNEL * channels)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, MpegAudioDecoder.SAMPLES_PER_FRAME * channels * 2 * 4)
    }
    val codec = try {
      MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    } catch (e: Exception) {
      throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "no AAC encoder on this device", e)
    }
    try {
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
    } catch (e: Exception) {
      codec.release()
      throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "the AAC encoder refused ${sampleRate} Hz × $channels: ${e.message}", e)
    }
    return codec
  }

  private fun openMuxer(stream: FileOutputStream): Mp4Muxer =
    // `moov` at the end, as the remuxer writes it.
    Mp4Muxer.Builder(stream).setSampleCopyingEnabled(true).setAttemptStreamableOutputEnabled(false).build()

  private fun isOutOfSpace(e: Throwable): Boolean =
    generateSequence(e) { it.cause }.mapNotNull { it.message }.any { it.contains("ENOSPC") || it.contains("No space left", ignoreCase = true) }

  /** Decoded, interleaved 16-bit samples waiting for the encoder. */
  private class PcmQueue {
    private var data = ShortArray(MpegAudioDecoder.SAMPLES_PER_FRAME * 2 * 8)
    private var start = 0
    private var end = 0

    fun isNotEmpty(): Boolean = end > start

    /** Whole sample frames (one sample per channel) queued; 0 before the format is known. */
    fun frames(channels: Int): Int = if (channels == 0) 0 else (end - start) / channels

    fun append(samples: ShortArray, count: Int) {
      ensureRoom(count)
      System.arraycopy(samples, 0, data, end, count)
      end += count
    }

    fun appendSilence(count: Int) {
      if (count <= 0) return
      ensureRoom(count)
      data.fill(0, end, end + count)
      end += count
    }

    fun drainInto(buffer: ByteBuffer, count: Int) {
      val out = buffer.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
      out.put(data, start, count)
      buffer.position(buffer.position() + count * 2)
      start += count
      if (start == end) {
        start = 0
        end = 0
      }
    }

    private fun ensureRoom(count: Int) {
      if (end + count <= data.size) return
      val live = end - start
      if (live + count > data.size) data = data.copyOf(maxOf(data.size * 2, live + count))
      System.arraycopy(data, start, data, 0, live)
      start = 0
      end = live
    }
  }

  companion object {
    /** AAC-LC: 80 kb/s per channel (160 kb/s stereo) — more than MP2 needs to keep its quality. */
    const val AAC_BITRATE_PER_CHANNEL = 80_000

    /** A Layer II frame is at most 1,729 bytes (384 kb/s at 32 kHz, padded). */
    private const val MAX_FRAME_BYTES = 4096
    private const val QUEUE_LOW_FRAMES = MpegAudioDecoder.SAMPLES_PER_FRAME * 4
    private const val CODEC_TIMEOUT_US = 10_000L
    private const val MIN_FRAMES_FOR_LOSS_CHECK = 20
  }
}
