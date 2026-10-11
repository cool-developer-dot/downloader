package com.vidorax.media.transfer

import com.vidorax.media.model.RequestContext
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.HttpResponse
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
  /**
   * Connections this file may use at once (Settings → Download Settings → "Connections per file"). Above 1 the
   * first request asks for `bytes=<from>-`, and when the server proves ranges (a `206` with the total size, at least
   * [RangedDownload.MIN_PARALLEL_BYTES] left, a strong validator) the rest is fetched in parallel ranges
   * ([RangedDownload]). An existing multi-connection `.part` always resumes as one, with at most this many at once.
   */
  val connections: Int = 1,
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
 * - A fresh download requests the whole resource (`bytes=0-` when it may use several connections); an existing
 *   `.part` requests `bytes=<len>-` with `If-Range` (the validator recorded beside the `.part` when its bytes
 *   started, so it survives a process death).
 * - With [TransferSpec.connections] above 1 and an answer that proves ranges, the rest of the file is fetched as
 *   parallel byte ranges into the pre-sized `.part` ([RangedDownload], resumable per part). A server that stops
 *   serving ranges, refuses extra connections or changes the resource is continued on one connection — never a
 *   failure.
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
internal class ProgressiveTransfer(
  private val http: HttpClient,
  /** Opens the `.part` for a multi-connection download's positional writes (tests fail the disk through it). */
  private val writerFor: (File) -> PartWriter = PartWriter.FILE,
  private val retryDelay: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
) {
  suspend fun transfer(
    spec: TransferSpec,
    onProgress: (bytesDone: Long, totalBytes: Long?) -> Unit = { _, _ -> },
  ): TransferOutcome.Completed {
    val parts = PartsCheckpoint.read(spec.partFile)
    if (parts != null) {
      if (parts.describes(spec.partFile)) return runParts(spec, parts.total, parts.validator, parts.parts, null, onProgress)
      keepSinglePrefix(spec.partFile, parts)
    }
    return single(spec, onProgress, allowParallel = spec.connections > 1)
  }

  /**
   * A parts checkpoint that does not describe the `.part` (a crash between writing it and sizing the file): keep the
   * bytes it proves were written contiguously from 0 as a one-connection partial, when they are this resource's.
   */
  private fun keepSinglePrefix(partFile: File, parts: PartsCheckpoint) {
    val sameResource = ResumeValidator.read(partFile) == parts.validator
    val keep = if (sameResource && partFile.isFile) minOf(partFile.length(), parts.contiguousPrefix) else 0L
    PartsCheckpoint.delete(partFile)
    if (keep > 0) diskWrite { RandomAccessFile(partFile, "rw").use { it.setLength(keep) } } else partFile.delete()
  }

  /** One connection — or, when [allowParallel] and the first answer proves ranges, the switch to [RangedDownload]. */
  private suspend fun single(
    spec: TransferSpec,
    onProgress: (Long, Long?) -> Unit,
    allowParallel: Boolean,
  ): TransferOutcome.Completed {
    val resumeFrom = if (spec.partFile.exists()) spec.partFile.length() else 0L
    val resumeValidator = if (resumeFrom > 0) spec.validator ?: ResumeValidator.read(spec.partFile) else null
    var fromZero = false
    // A fresh download that may use several connections asks for `bytes=0-`: the answer proves (or not) the ranges.
    var askOpenRange = allowParallel

    while (true) {
      val rangeStart = when {
        !fromZero && resumeFrom > 0 -> resumeFrom
        askOpenRange -> 0L
        else -> null
      }
      val response = http.execute(
        MediaRequest(
          url = spec.url,
          context = spec.context,
          rangeStart = rangeStart,
          ifRange = if (rangeStart != null && rangeStart > 0) resumeValidator else null,
        ),
      )

      // Some signed links answer any Range with 403/416: such a source gets the plain request it always had.
      if (rangeStart == 0L && response.status in OPEN_RANGE_REFUSALS) {
        response.close()
        askOpenRange = false
        continue
      }
      if (allowParallel && rangeStart != null) {
        parallelStart(response, rangeStart, resumeValidator)?.let { (total, validator) ->
          return startParts(spec, rangeStart, total, validator, response, onProgress)
        }
      }

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

      if (restart) {
        fromZero = true
        askOpenRange = false
      }
    }
  }

  /**
   * The total size and validator when [response] proves the server serves ranges of this resource and enough is left
   * to be worth several connections: a `206` starting at [from] with a known total, at least
   * [RangedDownload.MIN_PARALLEL_BYTES] left, and a strong validator (the one the partial was started with).
   */
  private fun parallelStart(response: HttpResponse, from: Long, resumeValidator: String?): Pair<Long, String>? {
    if (response.status != 206) return null
    val range = response.contentRange ?: return null
    val total = range.total ?: return null
    val validator = response.validator ?: return null
    if (range.start != from || total - from < RangedDownload.MIN_PARALLEL_BYTES) return null
    if (from > 0 && resumeValidator != null && resumeValidator != validator) return null
    return total to validator
  }

  /** Sizes the `.part` to the whole file (bytes before [from] stay) and downloads the rest in parallel parts. */
  private suspend fun startParts(
    spec: TransferSpec,
    from: Long,
    total: Long,
    validator: String,
    first: HttpResponse,
    onProgress: (Long, Long?) -> Unit,
  ): TransferOutcome.Completed {
    try {
      // A worker superseded while it waited for headers must not touch the `.part` a newer one may own.
      currentCoroutineContext().ensureActive()
      if (from == 0L) ResumeValidator.write(spec.partFile, validator)
      val plan = RangedDownload.plan(from, total, spec.connections)
      PartsCheckpoint.write(spec.partFile, PartsCheckpoint(total, validator, plan))
      diskWrite { RandomAccessFile(spec.partFile, "rw").use { it.setLength(total) } }
      return runParts(spec, total, validator, plan, first, onProgress)
    } catch (e: Throwable) {
      first.close()
      throw e
    }
  }

  /**
   * Runs (or resumes) a multi-connection download. A server that stops serving ranges is continued on one connection
   * from the bytes written contiguously from 0; a changed resource starts over from 0 on one connection (the
   * existing restart rule) — never a failure of the download.
   */
  private suspend fun runParts(
    spec: TransferSpec,
    total: Long,
    validator: String,
    parts: List<PartsCheckpoint.Part>,
    first: HttpResponse?,
    onProgress: (Long, Long?) -> Unit,
  ): TransferOutcome.Completed {
    val writer = writerFor(spec.partFile)
    val outcome = try {
      RangedDownload(
        http = http,
        url = spec.url,
        spec = spec,
        total = total,
        validator = validator,
        initialParts = parts,
        connections = spec.connections,
        writer = writer,
        onProgress = onProgress,
        retryDelay = retryDelay,
      ).run(first)
    } catch (e: RangesRefusedException) {
      writer.close()
      val prefix = PartsCheckpoint.read(spec.partFile)?.contiguousPrefix ?: 0L
      return onOneConnection(spec, keep = prefix, onProgress)
    } catch (e: SourceChangedException) {
      writer.close()
      ResumeValidator.write(spec.partFile, null)
      return onOneConnection(spec, keep = 0L, onProgress)
    } finally {
      writer.close()
    }
    // Marked complete before the parts checkpoint goes, so no crash in between can make the file look partial.
    TrackDone.mark(spec.partFile)
    PartsCheckpoint.delete(spec.partFile)
    return outcome
  }

  private suspend fun onOneConnection(spec: TransferSpec, keep: Long, onProgress: (Long, Long?) -> Unit): TransferOutcome.Completed {
    currentCoroutineContext().ensureActive()
    PartsCheckpoint.delete(spec.partFile)
    diskWrite { RandomAccessFile(spec.partFile, "rw").use { it.setLength(keep) } }
    return single(spec.copy(connections = 1), onProgress, allowParallel = false)
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

    /** Answers to a fresh `bytes=0-` that mean "not with a Range" rather than "not at all". */
    val OPEN_RANGE_REFUSALS = setOf(403, 416)

    /** Daemon threads: aborting a socket read must not keep the process alive or block a caller. */
    val CLOSERS: ExecutorService = Executors.newCachedThreadPool { runnable ->
      Thread(runnable, "vidorax-transfer-close").apply { isDaemon = true }
    }
  }
}
