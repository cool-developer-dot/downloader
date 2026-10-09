package com.vidorax.media.process

import android.media.MediaCodecList
import android.media.MediaFormat
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import com.vidorax.media.model.Container
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.ProcessingStage
import java.io.File
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** A downloaded track file and how to read it. */
internal data class TrackFile(
  val file: File,
  val container: TrackContainer,
  /** See [RemuxSource.timeOffsetUs]. */
  val timeOffsetUs: Long = 0,
)

/** What a download produced before processing. */
internal sealed interface ProcessingInput {
  /** One file with everything in it (a progressive download, a muxed HLS/DASH stream). */
  data class Single(val track: TrackFile) : ProcessingInput

  /** Video and audio downloaded separately (split files, HLS/DASH separate audio): always merged. */
  data class Split(val video: TrackFile, val audio: TrackFile) : ProcessingInput
}

internal enum class ProcessingOperation { KEEP, REMUX, MERGE, TRANSCODE }

internal sealed interface ProcessingResult {
  /**
   * The finished file. For [ProcessingOperation.KEEP] it is the input file itself (byte for byte, nothing was
   * written) and [container] is only a hint — the caller keeps the container it classified; otherwise a new file in
   * the work folder.
   */
  data class Done(val file: File, val container: Container, val operation: ProcessingOperation, val note: String? = null) :
    ProcessingResult

  data class Failed(val code: DownloadErrorCode, val message: String) : ProcessingResult
}

/** Whether this device can decode a sample type; transcoding needs it. Best effort: unknown answers "yes". */
internal fun interface CodecSupport {
  fun canDecode(mimeType: String): Boolean

  companion object {
    val ASSUME_ALL = CodecSupport { true }
  }
}

internal object AndroidCodecSupport : CodecSupport {
  private val list by lazy { runCatching { MediaCodecList(MediaCodecList.REGULAR_CODECS) }.getOrNull() }

  override fun canDecode(mimeType: String): Boolean {
    val codecs = list ?: return true
    return codecs.codecInfos.any { info -> !info.isEncoder && info.supportedTypes.any { it.equals(mimeType, ignoreCase = true) } }
  }
}

/**
 * Turns what the transfers downloaded into the one playable file the library keeps:
 *
 * - **Keep** a file that already is one: progressive MP4/MOV/M4V (not fragmented), WebM/MKV, 3GP — the original
 *   bytes, untouched. A container Media3 cannot read at all (ASF/WMV) is kept as downloaded: there is nothing to
 *   convert it with, and it opens in apps that can play it.
 * - **Remux** (no re-encoding) a file whose container plays or seeks poorly: MPEG-TS (HLS), fragmented MP4 (HLS fMP4,
 *   standalone fMP4), AVI, FLV → MP4.
 * - **Merge** a separately downloaded video and audio track into one MP4 (or WebM for VP8/VP9 + Opus/Vorbis), keeping
 *   their timelines — the tracks are checked to be one video's (lengths agree) before a byte is written.
 * - **Transcode** only a track the output cannot carry (MP3/AC-3 audio in MP4, MPEG-2 video…) to AAC / H.264 with the
 *   platform codecs; everything else is copied.
 *
 * Every produced file is re-read and checked (a video track, the audio track when one went in, the expected length)
 * before it is reported as done. Failures carry the code the download fails with.
 */
@OptIn(UnstableApi::class)
internal class MediaProcessor(
  private val remuxer: Remuxer = Remuxer(),
  private val transcoder: Transcoder = Transcoder.UNAVAILABLE,
  private val codecs: CodecSupport = CodecSupport.ASSUME_ALL,
) {
  suspend fun process(
    input: ProcessingInput,
    workDir: File,
    onProgress: (ProcessingStage, Double?) -> Unit = { _, _ -> },
  ): ProcessingResult = withContext(Dispatchers.IO) {
    try {
      when (input) {
        is ProcessingInput.Single -> single(input.track, workDir, onProgress)
        is ProcessingInput.Split -> split(input.video, input.audio, workDir, onProgress)
      }
    } catch (e: ProcessingException) {
      ProcessingResult.Failed(e.code, e.message ?: "processing failed")
    }
  }

  // --- one file ---

  private suspend fun single(track: TrackFile, workDir: File, onProgress: (ProcessingStage, Double?) -> Unit): ProcessingResult {
    val info = MediaFiles.read(track.file, track.container)
      ?: return keep(track, "container not readable by Media3; kept as downloaded")
    if (info.encrypted) return ProcessingResult.Failed(DownloadErrorCode.DRM_PROTECTED, "This video is protected")
    val video = info.video ?: return ProcessingResult.Failed(DownloadErrorCode.VIDEO_TRACK_MISSING, "This file has no video")
    val audio = info.audio

    val needsContainer = when (track.container) {
      TrackContainer.MP4 -> info.fragmented
      TrackContainer.TS, TrackContainer.AVI, TrackContainer.FLV, TrackContainer.PACKED_AUDIO -> true
      TrackContainer.WEBM, TrackContainer.MKV, TrackContainer.THREE_GP, TrackContainer.UNKNOWN -> false
    }
    if (!needsContainer) return keep(track, null)

    val output = File(workDir, PROCESSED_MP4)
    val videoFits = mp4Carries(video)
    val audioFits = audio == null || audio.mimeType in Remuxer.MP4_AUDIO
    if (videoFits && audioFits) {
      onProgress(ProcessingStage.REMUXING, 0.0)
      val outcome = remux(listOf(RemuxSource(track.file, track.container, timeOffsetUs = track.timeOffsetUs)), output, OutputContainer.MP4) {
        onProgress(ProcessingStage.REMUXING, it)
      }
      return verified(outcome.output, expectAudio = audio != null, expectedDurationUs = info.durationUs, operation = ProcessingOperation.REMUX, onProgress)
    }
    // A track an MP4 cannot hold: convert only that one, when this device can decode it; the other is copied.
    val transcodeVideo = !videoFits
    val transcodeAudio = !audioFits
    if ((transcodeVideo && !codecs.canDecode(video.mimeType)) || (transcodeAudio && audio != null && !codecs.canDecode(audio.mimeType))) {
      return keep(track, "no decoder for ${if (transcodeVideo) video.mimeType else audio?.mimeType}; kept as downloaded")
    }
    val merged = transcodeAndMerge(
      video = track,
      audio = if (audio != null) track else null,
      transcodeVideo = transcodeVideo,
      transcodeAudio = transcodeAudio,
      workDir = workDir,
      onProgress = onProgress,
    )
    return verified(merged.output, expectAudio = audio != null, expectedDurationUs = info.durationUs, operation = ProcessingOperation.TRANSCODE, onProgress)
  }

  /**
   * Re-encodes only the tracks that need it — each into its own single-track file — and merges them losslessly with
   * the tracks that are copied as they are. A re-encoded track keeps its place on the source's timeline (the
   * transcoder starts its output at zero), so audio and video stay in sync.
   */
  private suspend fun transcodeAndMerge(
    video: TrackFile,
    audio: TrackFile?,
    transcodeVideo: Boolean,
    transcodeAudio: Boolean,
    workDir: File,
    onProgress: (ProcessingStage, Double?) -> Unit,
  ): RemuxOutcome {
    val parts = (if (transcodeVideo) 1 else 0) + (if (transcodeAudio && audio != null) 1 else 0)
    var done = 0
    suspend fun convert(source: TrackFile, kind: TrackKind): RemuxSource {
      onProgress(ProcessingStage.TRANSCODING, done.toDouble() / parts)
      val out = File(workDir, if (kind == TrackKind.VIDEO) TRANSCODED_VIDEO else TRANSCODED_AUDIO)
      transcoder.transcode(TranscodeRequest(source.file, kind), out) { onProgress(ProcessingStage.TRANSCODING, (done + it) / parts) }
      done += 1
      // The converted file starts at zero: it goes back where the source track started (edit-list delay included).
      val start = (firstSampleTimeUs(source, kind) ?: 0L) + (FragmentEdits.correctionsUs(source.file, source.container)[kind] ?: 0L)
      return RemuxSource(
        out,
        TrackContainer.MP4,
        takeVideo = kind == TrackKind.VIDEO,
        takeAudio = kind == TrackKind.AUDIO,
        timeOffsetUs = start + source.timeOffsetUs,
      )
    }
    val videoSource = if (transcodeVideo) {
      convert(video, TrackKind.VIDEO)
    } else {
      RemuxSource(video.file, video.container, takeVideo = true, takeAudio = false, timeOffsetUs = video.timeOffsetUs)
    }
    val audioSource = audio?.let {
      if (transcodeAudio) {
        convert(it, TrackKind.AUDIO)
      } else {
        RemuxSource(it.file, it.container, takeVideo = false, takeAudio = true, timeOffsetUs = it.timeOffsetUs)
      }
    }
    onProgress(ProcessingStage.MERGING, 0.0)
    return remux(listOfNotNull(videoSource, audioSource), File(workDir, PROCESSED_MP4), OutputContainer.MP4) {
      onProgress(ProcessingStage.MERGING, it)
    }
  }

  /** Where [kind]'s first sample sits on [source]'s own timeline (the earliest of its first samples). */
  private fun firstSampleTimeUs(source: TrackFile, kind: TrackKind): Long? {
    val extractor = try {
      MediaFiles.open(source.file, source.container)
    } catch (e: Exception) {
      return null
    }
    return try {
      val index = (0 until extractor.trackCount).firstOrNull { MediaFiles.track(it, extractor.getTrackFormat(it))?.kind == kind }
        ?: return null
      extractor.selectTrack(index)
      var first: Long? = null
      var n = 0
      while (extractor.sampleTrackIndex >= 0 && n++ < 48) {
        first = first?.let { minOf(it, extractor.sampleTime) } ?: extractor.sampleTime
        extractor.advance()
      }
      first
    } catch (e: Exception) {
      null
    } finally {
      extractor.release()
    }
  }

  /**
   * An MP4 can carry this video track as it is. VP9 needs its codec configuration (`vpcC`), which a track read from
   * WebM does not have: such a track is not copied into an MP4.
   */
  private fun mp4Carries(track: MediaTrack): Boolean =
    track.mimeType in Remuxer.MP4_VIDEO && (track.mimeType != "video/x-vnd.on2.vp9" || track.format.initializationData.isNotEmpty())

  private fun keep(track: TrackFile, note: String?): ProcessingResult =
    ProcessingResult.Done(track.file, keptContainer(track.container), ProcessingOperation.KEEP, note)

  // --- separate video + audio ---

  private suspend fun split(
    videoFile: TrackFile,
    audioFile: TrackFile,
    workDir: File,
    onProgress: (ProcessingStage, Double?) -> Unit,
  ): ProcessingResult {
    val videoInfo = MediaFiles.read(videoFile.file, videoFile.container)
      ?: return ProcessingResult.Failed(DownloadErrorCode.INVALID_MEDIA, "The downloaded video track cannot be read")
    val audioInfo = MediaFiles.read(audioFile.file, audioFile.container)
      ?: return ProcessingResult.Failed(DownloadErrorCode.INVALID_MEDIA, "The downloaded audio track cannot be read")
    if (videoInfo.encrypted || audioInfo.encrypted) {
      return ProcessingResult.Failed(DownloadErrorCode.DRM_PROTECTED, "This video is protected")
    }
    val video = videoInfo.video
      ?: return ProcessingResult.Failed(DownloadErrorCode.VIDEO_TRACK_MISSING, "The video track has no picture")
    val audio = audioInfo.audio
      ?: return ProcessingResult.Failed(DownloadErrorCode.AUDIO_TRACK_MISSING, "The audio track has no sound")
    // Never merge the tracks of two different videos: their lengths must agree.
    val vd = videoInfo.durationUs
    val ad = audioInfo.durationUs
    if (vd != null && ad != null && !lengthsAgree(vd, ad)) {
      return ProcessingResult.Failed(
        DownloadErrorCode.TRACK_MISMATCH,
        "The audio (${ad / 1000} ms) does not belong to this video (${vd / 1000} ms)",
      )
    }

    val sources = listOf(
      RemuxSource(videoFile.file, videoFile.container, takeVideo = true, takeAudio = false, timeOffsetUs = videoFile.timeOffsetUs),
      RemuxSource(audioFile.file, audioFile.container, takeVideo = false, takeAudio = true, timeOffsetUs = audioFile.timeOffsetUs),
    )
    // The picture decides how long the video is; a padded or trimmed audio track does not.
    val expected = vd ?: ad
    when {
      // VP8/VP9 with Opus/Vorbis stay WebM: that is what they were made for, and a VP9 track read from WebM has no
      // codec configuration record an MP4 could carry.
      video.mimeType in Remuxer.WEBM_VIDEO && audio.mimeType in Remuxer.WEBM_AUDIO -> {
        onProgress(ProcessingStage.MERGING, 0.0)
        val out = remux(sources, File(workDir, PROCESSED_WEBM), OutputContainer.WEBM) { onProgress(ProcessingStage.MERGING, it) }
        return verified(out.output, expectAudio = true, expectedDurationUs = expected, operation = ProcessingOperation.MERGE, onProgress, out)
      }
      mp4Carries(video) && audio.mimeType in Remuxer.MP4_AUDIO -> {
        onProgress(ProcessingStage.MERGING, 0.0)
        val out = remux(sources, File(workDir, PROCESSED_MP4), OutputContainer.MP4) { onProgress(ProcessingStage.MERGING, it) }
        return verified(out.output, expectAudio = true, expectedDurationUs = expected, operation = ProcessingOperation.MERGE, onProgress, out)
      }
    }
    val transcodeVideo = !mp4Carries(video)
    val transcodeAudio = audio.mimeType !in Remuxer.MP4_AUDIO
    if (transcodeVideo && !codecs.canDecode(video.mimeType)) {
      return ProcessingResult.Failed(DownloadErrorCode.TRANSCODE_FAILED, "This device cannot decode ${video.mimeType}")
    }
    if (transcodeAudio && !codecs.canDecode(audio.mimeType)) {
      return ProcessingResult.Failed(DownloadErrorCode.TRANSCODE_FAILED, "This device cannot decode ${audio.mimeType}")
    }
    val merged = transcodeAndMerge(videoFile, audioFile, transcodeVideo, transcodeAudio, workDir, onProgress)
    return verified(merged.output, expectAudio = true, expectedDurationUs = expected, operation = ProcessingOperation.TRANSCODE, onProgress, merged)
  }

  // --- helpers ---

  private suspend fun remux(
    sources: List<RemuxSource>,
    output: File,
    container: OutputContainer,
    onProgress: (Double) -> Unit,
  ): RemuxOutcome {
    val context = currentCoroutineContext()
    // Blocking, on this IO thread; cancellation is honoured between samples (never by interrupting file I/O).
    return remuxer.remux(sources, output, container, onProgress, ensureActive = { context.ensureActive() })
  }

  /**
   * The produced file is only "done" when it reads back as what was meant: a video track, the audio when one went in,
   * about the length of its sources, and (merged) audio and video that start together.
   */
  private fun verified(
    output: File,
    expectAudio: Boolean,
    expectedDurationUs: Long?,
    operation: ProcessingOperation,
    onProgress: (ProcessingStage, Double?) -> Unit,
    remux: RemuxOutcome? = null,
  ): ProcessingResult {
    onProgress(ProcessingStage.VERIFYING, null)
    val container = if (output.name.endsWith(".webm")) TrackContainer.WEBM else TrackContainer.MP4
    val info = MediaFiles.read(output, container)
    if (info == null || !output.isFile || output.length() == 0L) {
      output.delete()
      return ProcessingResult.Failed(DownloadErrorCode.INVALID_MEDIA, "The processed file cannot be read back")
    }
    if (info.video == null) {
      output.delete()
      return ProcessingResult.Failed(DownloadErrorCode.VIDEO_TRACK_MISSING, "The processed file has no video")
    }
    if (expectAudio && info.audio == null) {
      output.delete()
      return ProcessingResult.Failed(DownloadErrorCode.AUDIO_TRACK_MISSING, "The processed file lost its audio")
    }
    val produced = info.durationUs
    if (remux?.audioSpanUs == null && expectedDurationUs != null && produced != null && !lengthsAgree(expectedDurationUs, produced)) {
      output.delete()
      return ProcessingResult.Failed(
        DownloadErrorCode.INVALID_MEDIA,
        "The processed file is ${produced / 1000} ms long, expected ${expectedDurationUs / 1000} ms",
      )
    }
    // Merged tracks start together and last as long as each other: otherwise they are not one video's (fragmented
    // sources often state no length up front, so this is decided from the samples that were actually written).
    val audioSpan = remux?.audioSpanUs
    if (audioSpan != null) {
      val videoSpan = remux.videoSpanUs
      if (abs(videoSpan.first - audioSpan.first) > MAX_START_SKEW_US) {
        output.delete()
        return ProcessingResult.Failed(DownloadErrorCode.TRACK_MISMATCH, "The audio and video do not start together")
      }
      val videoLength = videoSpan.last - videoSpan.first
      val audioLength = audioSpan.last - audioSpan.first
      if (!lengthsAgree(videoLength, audioLength)) {
        output.delete()
        return ProcessingResult.Failed(
          DownloadErrorCode.TRACK_MISMATCH,
          "The audio (${audioLength / 1000} ms) does not belong to this video (${videoLength / 1000} ms)",
        )
      }
    }
    return ProcessingResult.Done(output, if (container == TrackContainer.WEBM) Container.WEBM else Container.MP4, operation)
  }

  companion object {
    const val PROCESSED_MP4 = "processed.mp4"
    const val PROCESSED_WEBM = "processed.webm"
    const val TRANSCODED_VIDEO = "transcoded-video.mp4"
    const val TRANSCODED_AUDIO = "transcoded-audio.mp4"

    /** Audio and video of one video end within this of each other (encoders pad audio; players trim). */
    private const val MIN_LENGTH_SLACK_US = 1_500_000L
    private const val LENGTH_SLACK_FRACTION = 0.05

    /** Merged tracks whose first samples are further apart than this were not cut from one timeline. */
    const val MAX_START_SKEW_US = 2_000_000L

    fun lengthsAgree(a: Long, b: Long): Boolean {
      val slack = maxOf(MIN_LENGTH_SLACK_US, (maxOf(a, b) * LENGTH_SLACK_FRACTION).toLong())
      return abs(a - b) <= slack
    }

    /** The container a downloaded file is recorded as when it is kept. */
    fun keptContainer(container: TrackContainer): Container = when (container) {
      TrackContainer.MP4 -> Container.MP4
      TrackContainer.WEBM -> Container.WEBM
      TrackContainer.MKV -> Container.MKV
      TrackContainer.TS -> Container.TS
      TrackContainer.AVI -> Container.AVI
      TrackContainer.FLV -> Container.FLV
      TrackContainer.THREE_GP -> Container.THREE_GP
      TrackContainer.PACKED_AUDIO, TrackContainer.UNKNOWN -> Container.UNKNOWN
    }

    /** How the engine reads a file it downloaded as [container]. */
    fun trackContainer(container: Container): TrackContainer = when (container) {
      Container.MP4, Container.MOV -> TrackContainer.MP4
      Container.WEBM -> TrackContainer.WEBM
      Container.MKV -> TrackContainer.MKV
      Container.TS -> TrackContainer.TS
      Container.AVI -> TrackContainer.AVI
      Container.FLV -> TrackContainer.FLV
      Container.THREE_GP -> TrackContainer.THREE_GP
      Container.WMV, Container.UNKNOWN -> TrackContainer.UNKNOWN
    }
  }
}
