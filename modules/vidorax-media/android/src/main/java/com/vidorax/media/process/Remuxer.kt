package com.vidorax.media.process

import android.media.MediaExtractor
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi
import androidx.media3.container.Mp4OrientationData
import androidx.media3.inspector.MediaExtractorCompat
import androidx.media3.muxer.BufferInfo
import androidx.media3.muxer.Mp4Muxer
import androidx.media3.muxer.Muxer
import androidx.media3.muxer.MuxerException
import androidx.media3.muxer.SeekableMuxerOutput
import androidx.media3.muxer.WebmMuxer
import com.vidorax.media.model.DownloadErrorCode
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer

/** One input of a remux: a downloaded file and which of its tracks go into the output. */
internal data class RemuxSource(
  val file: File,
  val container: TrackContainer,
  val takeVideo: Boolean = true,
  val takeAudio: Boolean = true,
  /**
   * Added to this file's sample times before the files are aligned (a DASH `presentationTimeOffset`, the ID3 timestamp
   * of an HLS packed-audio rendition). Files cut from one timeline keep their offset against each other.
   */
  val timeOffsetUs: Long = 0,
)

internal enum class OutputContainer { MP4, WEBM }

internal data class RemuxOutcome(
  val output: File,
  val container: OutputContainer,
  val videoFormat: Format,
  val audioFormat: Format?,
  /** First and last presentation times written per track, on the output timeline. */
  val videoSpanUs: LongRange,
  val audioSpanUs: LongRange?,
  val samplesWritten: Long,
)

/** A remux that cannot produce the file, with the code the download fails with. */
internal class ProcessingException(val code: DownloadErrorCode, message: String, cause: Throwable? = null) :
  Exception(message, cause)

/**
 * Moves encoded samples from one or more files into one MP4 (or WebM) without re-encoding: the lossless, fast path
 * behind every container change (MPEG-TS, fragmented MP4, AVI → MP4) and every merge of a separately downloaded video
 * and audio track.
 *
 * - Samples are read with Media3's extractors (the player's own) and written with Media3's `Mp4Muxer`/`WebmMuxer`
 *   in decode order per track, interleaved across tracks by time, so A/V sync is what the sources carry.
 * - Every file's timeline is kept, shifted by its [RemuxSource.timeOffsetUs] (and by the start delays of a fragmented
 *   MP4's edit lists, which Media3 leaves out: [FragmentEdits]), and the whole output is moved so its
 *   earliest sample starts at zero; a track that starts later keeps its delay (an edit list), so a video and an audio
 *   rendition cut from the same encode stay in sync even when their first timestamps differ.
 * - One video track (the first) and at most one audio track (the first) are written; subtitles and data tracks are
 *   dropped. Encrypted samples are never written ([DownloadErrorCode.DRM_PROTECTED]).
 * - Cancellable between samples ([ensureActive] throws); the partial output is deleted on any failure.
 */
@OptIn(UnstableApi::class)
internal class Remuxer {
  fun remux(
    sources: List<RemuxSource>,
    output: File,
    container: OutputContainer,
    onProgress: (Double) -> Unit = {},
    ensureActive: () -> Unit = {},
  ): RemuxOutcome {
    require(sources.isNotEmpty()) { "nothing to remux" }
    output.delete()
    val readers = ArrayList<SourceReader>(sources.size)
    var muxer: Muxer? = null
    var completed = false
    try {
      var videoTaken = false
      var audioTaken = false
      for (source in sources) {
        val reader = SourceReader.open(source)
        readers += reader
        val info = reader.tracks
        if (source.takeVideo && !videoTaken) {
          info.firstOrNull { it.kind == TrackKind.VIDEO }?.let { reader.select(it, TrackKind.VIDEO); videoTaken = true }
        }
        if (source.takeAudio && !audioTaken) {
          info.firstOrNull { it.kind == TrackKind.AUDIO }?.let { reader.select(it, TrackKind.AUDIO); audioTaken = true }
        }
      }
      if (!videoTaken) throw ProcessingException(DownloadErrorCode.VIDEO_TRACK_MISSING, "no video track to write")
      if (sources.any { it.takeAudio && !it.takeVideo } && !audioTaken) {
        throw ProcessingException(DownloadErrorCode.AUDIO_TRACK_MISSING, "the audio file has no audio track")
      }
      if (readers.any { it.encrypted }) throw ProcessingException(DownloadErrorCode.DRM_PROTECTED, "encrypted media")

      // Where each selected track starts on the shared timeline, from a timestamps-only pass.
      val starts = readers.flatMap { reader -> reader.firstTimes().map { (track, first) -> track to first + track.offsetUs } }
      val origin = starts.minOfOrNull { it.second } ?: 0L
      val durationUs = readers.flatMap { r -> r.selected.map { it.track.durationUs ?: 0L } }.maxOrNull()?.takeIf { it > 0 }
      readers.forEach { it.rewind() }

      val built = openMuxer(output, container)
      muxer = built
      val selected = readers.flatMap { it.selected }
      // A codec configuration the container carries in-band (AVI, FLV) is recovered from the first key frame.
      for (reader in readers) {
        for (entry in reader.selected) {
          if (entry.format.initializationData.isEmpty() && entry.track.mimeType in IN_BAND_CONFIG) {
            reader.firstSample(entry)?.let { sample ->
              CodecConfig.fromFirstSample(entry.track.mimeType, sample)?.let { config ->
                entry.format = entry.format.buildUpon().setInitializationData(config).build()
              }
            }
          }
        }
      }
      for (entry in selected) {
        entry.muxerTrack = try {
          built.addTrack(entry.format)
        } catch (e: MuxerException) {
          throw ProcessingException(DownloadErrorCode.MUX_FAILED, "${entry.track.mimeType} cannot be written: ${e.message}", e)
        } catch (e: IllegalArgumentException) {
          throw ProcessingException(DownloadErrorCode.MUX_FAILED, "${entry.track.mimeType} cannot be written: ${e.message}", e)
        }
      }
      val video = selected.first { it.kind == TrackKind.VIDEO }
      val rotation = video.format.rotationDegrees
      if (container == OutputContainer.MP4 && rotation in ROTATIONS && rotation != 0) {
        built.addMetadataEntry(Mp4OrientationData(rotation))
      }

      var buffer = ByteBuffer.allocateDirect(INITIAL_BUFFER_BYTES)
      var written = 0L
      var lastReported = -1.0
      var lastTimeUs = 0L
      while (true) {
        // The reader whose next sample comes first on the output timeline.
        var next: SourceReader? = null
        var nextTime = Long.MAX_VALUE
        for (reader in readers) {
          if (!reader.hasSample) continue
          val t = reader.sampleTimeUs + reader.currentOffsetUs
          if (next == null || t < nextTime) {
            next = reader
            nextTime = t
          }
        }
        if (next == null) break
        val entry = next.currentEntry()
        if (entry == null) {
          next.advance()
          continue
        }
        if (next.sampleEncrypted) throw ProcessingException(DownloadErrorCode.DRM_PROTECTED, "encrypted samples")
        val size = next.sampleSize
        if (size > 0) {
          if (buffer.capacity() < size) buffer = ByteBuffer.allocateDirect(size.toInt() + INITIAL_BUFFER_BYTES)
          buffer.clear()
          val read = next.extractor.readSampleData(buffer, 0)
          if (read > 0) {
            buffer.position(0)
            buffer.limit(read)
            val timeUs = next.sampleTimeUs + entry.offsetUs - origin
            val flags = if (next.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) C.BUFFER_FLAG_KEY_FRAME else 0
            try {
              built.writeSampleData(entry.muxerTrack, buffer, BufferInfo(timeUs, read, flags))
            } catch (e: MuxerException) {
              throw ProcessingException(DownloadErrorCode.MUX_FAILED, "writing a ${entry.track.mimeType} sample failed: ${e.message}", e)
            }
            entry.record(timeUs)
            written++
            lastTimeUs = timeUs
          }
        }
        next.advance()
        if (written % CANCEL_CHECK_SAMPLES == 0L) {
          ensureActive()
          if (durationUs != null) {
            val fraction = (lastTimeUs.toDouble() / durationUs).coerceIn(0.0, 1.0)
            if (fraction - lastReported >= 0.01) {
              lastReported = fraction
              onProgress(fraction)
            }
          }
        }
      }
      ensureActive()
      if (video.firstUs == null) throw ProcessingException(DownloadErrorCode.VIDEO_TRACK_MISSING, "the video track has no samples")
      val audio = selected.firstOrNull { it.kind == TrackKind.AUDIO }
      if (audio != null && audio.firstUs == null) {
        throw ProcessingException(DownloadErrorCode.AUDIO_TRACK_MISSING, "the audio track has no samples")
      }
      try {
        built.close()
      } catch (e: MuxerException) {
        throw ProcessingException(DownloadErrorCode.MUX_FAILED, "finishing the file failed: ${e.message}", e)
      }
      muxer = null
      onProgress(1.0)
      completed = true
      return RemuxOutcome(
        output = output,
        container = container,
        videoFormat = video.format,
        audioFormat = audio?.format,
        videoSpanUs = video.span(),
        audioSpanUs = audio?.span(),
        samplesWritten = written,
      )
    } catch (e: ProcessingException) {
      throw if (e.code == DownloadErrorCode.MUX_FAILED && isOutOfSpace(e)) {
        ProcessingException(DownloadErrorCode.NO_SPACE, "Not enough storage left to finish this video", e)
      } else {
        e
      }
    } catch (e: kotlinx.coroutines.CancellationException) {
      throw e
    } catch (e: java.io.IOException) {
      if (isOutOfSpace(e)) throw ProcessingException(DownloadErrorCode.NO_SPACE, "Not enough storage left to finish this video", e)
      throw ProcessingException(DownloadErrorCode.MUX_FAILED, "reading the downloaded tracks failed: ${e.message}", e)
    } catch (e: RuntimeException) {
      // Extractor/muxer state errors on malformed input: a failed remux, never a crash of the download worker.
      throw ProcessingException(DownloadErrorCode.MUX_FAILED, "remux failed: ${e.message}", e)
    } finally {
      muxer?.let { runCatching { it.close() } }
      readers.forEach { it.release() }
      if (!completed) output.delete()
    }
  }

  /** The disk filled up while writing the output (ENOSPC anywhere in the cause chain). */
  private fun isOutOfSpace(e: Throwable): Boolean =
    generateSequence(e) { it.cause }.mapNotNull { it.message }.any { it.contains("ENOSPC") || it.contains("No space left", ignoreCase = true) }

  private fun openMuxer(output: File, container: OutputContainer): Muxer {
    output.parentFile?.mkdirs()
    val stream = FileOutputStream(output)
    return try {
      when (container) {
        // `moov` at the end: a local library file loses nothing, and a front `moov` would mean a fixed reserved
        // `free` box (~400 KB) in every file.
        OutputContainer.MP4 -> Mp4Muxer.Builder(stream)
          .setSampleCopyingEnabled(true)
          .setAttemptStreamableOutputEnabled(false)
          .build()
        OutputContainer.WEBM -> WebmMuxer.Builder(SeekableMuxerOutput.of(stream))
          .setSampleCopyEnabled(true)
          .build()
      }
    } catch (e: RuntimeException) {
      runCatching { stream.close() }
      throw ProcessingException(DownloadErrorCode.MUX_FAILED, "could not create the output file: ${e.message}", e)
    }
  }

  /** One selected track of one source, with what has been written for it. */
  private class Selected(val track: MediaTrack, val kind: TrackKind, val offsetUs: Long) {
    /** The format written: the track's own, completed with an in-band codec configuration when needed. */
    var format: Format = track.format
    var muxerTrack: Int = -1
    var firstUs: Long? = null
    var lastUs: Long? = null

    fun record(timeUs: Long) {
      firstUs = firstUs?.let { minOf(it, timeUs) } ?: timeUs
      lastUs = lastUs?.let { maxOf(it, timeUs) } ?: timeUs
    }

    fun span(): LongRange = (firstUs ?: 0L)..(lastUs ?: 0L)
  }

  /** An extractor over one source file, restricted to the tracks this remux takes from it. */
  private class SourceReader(
    val source: RemuxSource,
    var extractor: MediaExtractorCompat,
    val tracks: List<MediaTrack>,
    /** Edit-list start delays the extractor leaves out ([FragmentEdits]). */
    private val editsUs: Map<TrackKind, Long>,
  ) {
    val selected = ArrayList<Selected>(2)
    val encrypted: Boolean get() = extractor.drmInitData != null || tracks.any { it.format.drmInitData != null }

    val hasSample: Boolean get() = extractor.sampleTrackIndex >= 0
    val sampleTimeUs: Long get() = extractor.sampleTime
    val sampleSize: Long get() = extractor.sampleSize
    val sampleFlags: Int get() = extractor.sampleFlags
    val sampleEncrypted: Boolean get() = extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_ENCRYPTED != 0

    /** Where the current sample's track sits on the shared timeline, relative to the extractor's times. */
    val currentOffsetUs: Long get() = currentEntry()?.offsetUs ?: source.timeOffsetUs

    fun select(track: MediaTrack, kind: TrackKind) {
      selected += Selected(track, kind, source.timeOffsetUs + (editsUs[kind] ?: 0L))
      extractor.selectTrack(track.index)
    }

    fun currentEntry(): Selected? {
      val index = extractor.sampleTrackIndex
      return selected.firstOrNull { it.track.index == index }
    }

    fun advance() {
      extractor.advance()
    }

    /**
     * The earliest presentation time of each selected track among its first samples (B-frames are stored out of
     * presentation order, so the first sample read is not always the first shown). Reads timestamps only.
     */
    fun firstTimes(): List<Pair<Selected, Long>> {
      val first = HashMap<Selected, Long>()
      val seen = HashMap<Selected, Int>()
      while (hasSample) {
        val entry = currentEntry()
        if (entry != null) {
          val count = seen.getOrDefault(entry, 0)
          if (count < FIRST_TIME_SAMPLES) {
            first[entry] = first[entry]?.let { minOf(it, sampleTimeUs) } ?: sampleTimeUs
            seen[entry] = count + 1
          }
        }
        if (selected.all { seen.getOrDefault(it, 0) >= FIRST_TIME_SAMPLES }) break
        advance()
      }
      return first.entries.map { it.key to it.value }
    }

    /** The first sample of [entry]'s track, read with a separate extractor (the main one is left where it is). */
    fun firstSample(entry: Selected): ByteArray? {
      val peek = try {
        MediaFiles.open(source.file, source.container)
      } catch (e: Exception) {
        return null
      }
      return try {
        peek.selectTrack(entry.track.index)
        val size = peek.sampleSize.takeIf { it > 0 } ?: return null
        val buffer = ByteBuffer.allocate(size.toInt())
        val read = peek.readSampleData(buffer, 0)
        if (read <= 0) null else ByteArray(read).also { buffer.position(0); buffer.get(it) }
      } catch (e: Exception) {
        null
      } finally {
        peek.release()
      }
    }

    /** Back to the first sample: a fresh extractor (not every container is seekable). */
    fun rewind() {
      extractor.release()
      extractor = MediaFiles.open(source.file, source.container)
      for (entry in selected) extractor.selectTrack(entry.track.index)
    }

    fun release() {
      runCatching { extractor.release() }
    }

    companion object {
      fun open(source: RemuxSource): SourceReader {
        val extractor = try {
          MediaFiles.open(source.file, source.container)
        } catch (e: Exception) {
          throw ProcessingException(DownloadErrorCode.INVALID_MEDIA, "the downloaded file cannot be read: ${e.message}", e)
        }
        val tracks = try {
          (0 until extractor.trackCount).mapNotNull { MediaFiles.track(it, extractor.getTrackFormat(it)) }
        } catch (e: RuntimeException) {
          extractor.release()
          throw ProcessingException(DownloadErrorCode.INVALID_MEDIA, "the downloaded file's tracks cannot be read", e)
        }
        return SourceReader(source, extractor, tracks, FragmentEdits.correctionsUs(source.file, source.container))
      }
    }
  }

  companion object {
    private const val INITIAL_BUFFER_BYTES = 256 * 1024
    private const val CANCEL_CHECK_SAMPLES = 64L
    private const val FIRST_TIME_SAMPLES = 48
    private val ROTATIONS = setOf(0, 90, 180, 270)

    /** Video codecs whose configuration may be in-band only (recovered by [CodecConfig]). */
    private val IN_BAND_CONFIG = setOf("video/mp4v-es", "video/avc", "video/hevc")

    /** Sample types an MP4 written by [Mp4Muxer] can carry. */
    val MP4_VIDEO: Set<String> = Mp4Muxer.SUPPORTED_VIDEO_SAMPLE_MIME_TYPES.toSet()
    val MP4_AUDIO: Set<String> = Mp4Muxer.SUPPORTED_AUDIO_SAMPLE_MIME_TYPES.toSet() - setOf("audio/raw")

    /** Sample types a WebM written by [WebmMuxer] can carry. */
    val WEBM_VIDEO = setOf("video/x-vnd.on2.vp8", "video/x-vnd.on2.vp9")
    val WEBM_AUDIO = setOf("audio/opus", "audio/vorbis")
  }
}
