package com.vidorax.media.transfer

import com.vidorax.media.model.RequestContext
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRequest
import com.vidorax.media.net.Redact
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job

/** One progressive download to a `.part` file. Resumable, large-file safe, and never falsely reports success. */
internal data class TransferSpec(
  val url: String,
  val context: RequestContext,
  /** Working file; bytes are streamed here. The finished file is produced by [ProgressiveTransfer.finalizeToFile]. */
  val partFile: File,
  /** Validator (ETag/Last-Modified) to replay as `If-Range` on a resume, so it can't splice bytes from a changed
   *  resource. Null reads the one recorded beside the `.part` ([ResumeValidator]). */
  val validator: String? = null,
)

internal sealed interface TransferOutcome {
  /** The whole resource is on disk in [TransferSpec.partFile]. Verify it before finalizing/COMPLETED. */
  data class Completed(
    val bytesWritten: Long,
    val totalBytes: Long?,
    /** Validator to persist for a future resume; null when the server sent none. */
    val validator: String?,
    val finalUrl: String,
  ) : TransferOutcome
}

/**
 * Streams a progressive file straight to disk with bounded memory and correct HTTP Range semantics:
 *
 * - A fresh download requests the whole resource; an existing `.part` requests `bytes=<len>-` with `If-Range`
 *   (the validator recorded beside the `.part` when its bytes started, so it survives a process death).
 * - A `206` is appended only after its `Content-Range` is proven to start exactly at the partial's length.
 * - A `200` to a ranged request (server ignored Range, or `If-Range` no longer matches) is a full resource from
 *   byte 0: the `.part` is truncated and rewritten — bytes are never appended onto it.
 * - Cancellation (pause) and transport errors leave the `.part` in place for a later resume; neither is reported
 *   as completion. A short read against a known total is treated as a transient failure, not a finished file.
 *
 * Transport failures surface as [MediaNetworkException] (transient); proven HTTP status failures as
 * [MediaHttpException]; a write the disk refused (full, gone) as [StorageWriteException]. Finalization to the
 * destination is a separate, atomic step the caller runs only after verification passes.
 */
internal class ProgressiveTransfer(private val http: HttpClient) {
  suspend fun transfer(
    spec: TransferSpec,
    onProgress: (bytesDone: Long, totalBytes: Long?) -> Unit = { _, _ -> },
  ): TransferOutcome.Completed {
    val resumeFrom = if (spec.partFile.exists()) spec.partFile.length() else 0L
    val resumeValidator = if (resumeFrom > 0) spec.validator ?: ResumeValidator.read(spec.partFile) else null
    var fromZero = false

    while (true) {
      val rangeStart = if (!fromZero && resumeFrom > 0) resumeFrom else null
      val response = http.execute(
        MediaRequest(
          url = spec.url,
          context = spec.context,
          rangeStart = rangeStart,
          ifRange = if (rangeStart != null) resumeValidator else null,
        ),
      )

      val restart = response.use {
        val status = it.status
        val contentRange = it.contentRange
        val writeAt: Long? = when {
          status == 200 -> 0L
          status == 206 && contentRange != null && contentRange.start == (rangeStart ?: 0L) -> contentRange.start
          status == 206 && contentRange == null && rangeStart == null -> 0L
          // 206 whose range does not line up, or 416: the partial can't be continued — retry once from byte 0.
          status == 206 || status == 416 -> if (fromZero) throw noResume(spec.url) else null
          status in 200..299 -> 0L
          else -> throw MediaHttpException.of(status, spec.url)
        }

        if (writeAt == null) {
          true // fall out of `use` (closes/cancels the call) and loop again from zero
        } else {
          val total = contentRange?.total
            ?: if (status == 200) it.contentLength else it.contentLength?.let { len -> writeAt + len }
          return stream(spec, it.byteStream(), writeAt, total, it.validator, it.finalUrl, onProgress)
        }
      }

      if (restart) fromZero = true
    }
  }

  private suspend fun stream(
    spec: TransferSpec,
    input: java.io.InputStream,
    writeAt: Long,
    totalBytes: Long?,
    validator: String?,
    finalUrl: String,
    onProgress: (Long, Long?) -> Unit,
  ): TransferOutcome.Completed {
    // A worker that was paused while it waited for response headers must not touch the `.part` now: a resumed
    // worker may already own it, and the truncation below would cut that worker's bytes out from under it.
    currentCoroutineContext().ensureActive()
    val file = diskWrite { RandomAccessFile(spec.partFile, "rw") }
    // A pause must stop the network now, even mid-read: closing the body unblocks a read waiting on a stalled
    // connection. The close runs on its own thread — closing a body that another thread is reading blocks until
    // that read gives up, and the thread cancelling us (the user's Pause) must never wait for the network.
    val onCancel = currentCoroutineContext().job.invokeOnCompletion {
      CLOSERS.execute { runCatching { input.close() } }
    }
    try {
      // Truncate to the write offset: 0 discards a stale partial on restart; the partial's length keeps a resume.
      diskWrite {
        file.setLength(writeAt)
        file.seek(writeAt)
      }
      // Bytes from 0 belong to this response now: its validator is what a later resume must match.
      if (writeAt == 0L) ResumeValidator.write(spec.partFile, validator)
      var written = writeAt
      val buffer = ByteArray(BUFFER_BYTES)
      while (true) {
        currentCoroutineContext().ensureActive() // pause/cancel: throws, `.part` kept by the finally below
        val read = input.read(buffer)
        if (read < 0) break
        diskWrite { file.write(buffer, 0, read) }
        written += read
        onProgress(written, totalBytes)
      }
      diskWrite { file.fd.sync() }
      // A short read against a known length is a truncated transfer, not a finished file — keep the `.part`.
      if (totalBytes != null && written < totalBytes) {
        throw MediaNetworkException("truncated transfer of ${Redact.url(spec.url)}: $written/$totalBytes")
      }
      return TransferOutcome.Completed(
        bytesWritten = written,
        totalBytes = totalBytes,
        validator = validator ?: spec.validator,
        finalUrl = finalUrl,
      )
    } catch (io: IOException) {
      // A stream closed by the cancellation above is a pause, not a transport failure.
      currentCoroutineContext().ensureActive()
      // A full disk is not a network problem: waiting and retrying the connection would never fix it.
      if (io is MediaNetworkException || io is StorageWriteException) throw io
      throw MediaNetworkException("transfer of ${Redact.url(spec.url)} interrupted", io)
    } finally {
      onCancel.dispose()
      runCatching { file.close() }
    }
  }

  /**
   * Atomically promotes a fully-downloaded, verified `.part` to its destination. Callers run this only after the
   * Verifier passes, so an interrupted finalize can never leave a half file where a completed one is expected.
   */
  fun finalizeToFile(partFile: File, destFile: File) {
    destFile.parentFile?.mkdirs()
    val from = partFile.toPath()
    val to = destFile.toPath()
    try {
      Files.move(from, to, StandardCopyOption.ATOMIC_MOVE)
    } catch (e: AtomicMoveNotSupportedException) {
      Files.move(from, to, StandardCopyOption.REPLACE_EXISTING)
    }
  }

  private fun noResume(url: String) = MediaNetworkException("server would not resume ${Redact.url(url)}")

  private companion object {
    const val BUFFER_BYTES = 64 * 1024

    /** Daemon threads: aborting a socket read must not keep the process alive or block a caller. */
    val CLOSERS: ExecutorService = Executors.newCachedThreadPool { runnable ->
      Thread(runnable, "vidorax-transfer-close").apply { isDaemon = true }
    }
  }
}
