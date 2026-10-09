package com.vidorax.media.process

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import com.vidorax.media.model.DownloadErrorCode
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * One track to re-encode: the [track] of [input] becomes a single-track MP4 — H.264 for video, AAC for audio. The
 * other tracks are never touched here: the remuxer merges the result with them losslessly.
 */
internal data class TranscodeRequest(
  val input: File,
  val track: TrackKind,
)

internal data class TranscodeOutcome(val output: File, val mimeType: String?)

/** Re-encodes one track an MP4 cannot carry into H.264 video / AAC audio. Throws [ProcessingException]. */
internal fun interface Transcoder {
  suspend fun transcode(request: TranscodeRequest, output: File, onProgress: (Double) -> Unit): TranscodeOutcome

  companion object {
    /** A host without a codec pipeline (JVM tests): every transcode is refused. */
    val UNAVAILABLE = Transcoder { _, _, _ ->
      throw ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "transcoding is not available")
    }
  }
}

/**
 * [Transcoder] over Media3 Transformer: the platform's MediaCodec encoders and decoders (hardware where the device
 * has them), H.264 + AAC in MP4, aspect ratio and rotation kept, tracks that need no conversion transmuxed. Runs on
 * its own looper thread; cancelling the coroutine cancels the export and deletes the partial file.
 */
@OptIn(UnstableApi::class)
internal class TransformerTranscoder(private val context: Context) : Transcoder {
  override suspend fun transcode(request: TranscodeRequest, output: File, onProgress: (Double) -> Unit): TranscodeOutcome {
    output.delete()
    output.parentFile?.mkdirs()
    val thread = HandlerThread("vidorax-transcode").apply { start() }
    val handler = Handler(thread.looper)
    var transformer: Transformer? = null
    try {
      return suspendCancellableCoroutine { continuation ->
        val progress = ProgressHolder()
        val poll = object : Runnable {
          override fun run() {
            val current = transformer ?: return
            if (current.getProgress(progress) == Transformer.PROGRESS_STATE_AVAILABLE) {
              onProgress((progress.progress / 100.0).coerceIn(0.0, 1.0))
            }
            handler.postDelayed(this, PROGRESS_POLL_MS)
          }
        }
        val listener = object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            handler.removeCallbacks(poll)
            if (continuation.isActive) {
              val mime = if (request.track == TrackKind.VIDEO) exportResult.videoMimeType else exportResult.audioMimeType
              continuation.resume(TranscodeOutcome(output, mime))
            }
          }

          override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
            handler.removeCallbacks(poll)
            output.delete()
            if (continuation.isActive) {
              continuation.resumeWithException(
                ProcessingException(
                  DownloadErrorCode.TRANSCODE_FAILED,
                  "conversion failed (${exportException.errorCodeName})",
                  exportException,
                ),
              )
            }
          }
        }
        handler.post {
          try {
            val built = Transformer.Builder(context)
              .setLooper(thread.looper)
              .setVideoMimeType(MimeTypes.VIDEO_H264)
              .setAudioMimeType(MimeTypes.AUDIO_AAC)
              .addListener(listener)
              .build()
            transformer = built
            built.start(composition(request), output.path)
            handler.postDelayed(poll, PROGRESS_POLL_MS)
          } catch (e: Exception) {
            output.delete()
            if (continuation.isActive) {
              continuation.resumeWithException(
                ProcessingException(DownloadErrorCode.TRANSCODE_FAILED, "conversion could not start: ${e.message}", e),
              )
            }
          }
        }
        continuation.invokeOnCancellation {
          handler.post {
            handler.removeCallbacks(poll)
            runCatching { transformer?.cancel() }
            output.delete()
          }
        }
      }
    } finally {
      thread.quitSafely()
    }
  }

  /** The one track asked for, alone in its sequence: the output holds nothing else. */
  private fun composition(request: TranscodeRequest): Composition {
    val item = MediaItem.fromUri(Uri.fromFile(request.input))
    return if (request.track == TrackKind.VIDEO) {
      val videoOnly = EditedMediaItem.Builder(item).setRemoveAudio(true).build()
      Composition.Builder(EditedMediaItemSequence.withVideoFrom(listOf(videoOnly))).build()
    } else {
      val audioOnly = EditedMediaItem.Builder(item).setRemoveVideo(true).build()
      Composition.Builder(EditedMediaItemSequence.withAudioFrom(listOf(audioOnly))).build()
    }
  }

  private companion object {
    const val PROGRESS_POLL_MS = 500L
  }
}
