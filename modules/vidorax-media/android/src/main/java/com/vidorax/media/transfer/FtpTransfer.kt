package com.vidorax.media.transfer

import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.net.DataTlsRefused
import com.vidorax.media.net.DownloadCredentials
import com.vidorax.media.net.FtpConnector
import com.vidorax.media.net.FtpSession
import com.vidorax.media.net.FtpUrl
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRefusedException
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext

/**
 * #304: one file from an FTP server into the download's `.part`, on one connection. A resume continues at the
 * `.part`'s length (REST) when the file is still the one it was started from — the same size and MDTM time, kept
 * beside the `.part` as its validator ([ResumeValidator], `ftp <size> <mdtm>`); a changed file, or a server that
 * will not restart at an offset, is downloaded again from byte 0, never spliced. Same guarantees as
 * [ProgressiveTransfer]: a short read against the known size is a dropped connection (the `.part` stays), a pause
 * closes the sockets at once, a full disk is a [StorageWriteException].
 */
internal class FtpTransfer(private val connector: FtpConnector = FtpConnector()) {
  suspend fun transfer(
    spec: TransferSpec,
    onProgress: (bytesDone: Long, totalBytes: Long?) -> Unit = { _, _ -> },
  ): TransferOutcome.Completed = withContext(Dispatchers.IO) {
    val url = FtpUrl.parse(spec.url) ?: throw MediaRefusedException(ProbeFailure.UNSUPPORTED_FORMAT, "not an FTP link")
    val login = DownloadCredentials.ftpLoginFor(spec.context.authKey, url)
    val session = connector.open(url, login)
    try {
      download(session, spec, onProgress)
    } catch (e: DataTlsRefused) {
      session.close()
      connector.open(url, login, protectData = false).let { clear ->
        try {
          download(clear, spec, onProgress)
        } finally {
          clear.close()
        }
      }
    } finally {
      session.close()
    }
  }

  private suspend fun download(session: FtpSession, spec: TransferSpec, onProgress: (Long, Long?) -> Unit): TransferOutcome.Completed {
    val size = session.size()
    // Spaces on purpose: ResumeValidator quotes a space-less value as an ETag, and then it would never match again.
    val validator = size?.let { "ftp $it ${session.modified() ?: "-"}" }
    val onDisk = if (spec.partFile.isFile) spec.partFile.length() else 0L
    val sameFile = validator != null && ResumeValidator.read(spec.partFile) == validator
    if (sameFile && size != null && onDisk == size && size > 0) {
      onProgress(size, size)
      return TransferOutcome.Completed(size, size, validator, url(session))
    }
    var writeAt = if (sameFile && onDisk > 0 && (size == null || onDisk < size)) onDisk else 0L
    val stream = session.retrieve(writeAt) ?: run {
      // The server will not restart at an offset: the whole file again, from byte 0.
      writeAt = 0L
      session.retrieve(0L)
    } ?: throw MediaNetworkException("FTP server sent nothing for ${session.url.redacted}")
    return stream(session, stream, spec, writeAt, size, validator, onProgress)
  }

  private fun url(session: FtpSession) = session.url.withoutUserInfo

  private suspend fun stream(
    session: FtpSession,
    input: InputStream,
    spec: TransferSpec,
    writeAt: Long,
    size: Long?,
    validator: String?,
    onProgress: (Long, Long?) -> Unit,
  ): TransferOutcome.Completed {
    currentCoroutineContext().ensureActive()
    val file = diskWrite { RandomAccessFile(spec.partFile, "rw") }
    // A pause stops the network now: the sockets are closed on their own thread, never by the pausing one.
    val onCancel = currentCoroutineContext().job.invokeOnCompletion {
      CLOSERS.execute {
        runCatching { input.close() }
        session.abort()
      }
    }
    try {
      diskWrite {
        file.setLength(writeAt)
        file.seek(writeAt)
      }
      if (writeAt == 0L) ResumeValidator.write(spec.partFile, validator)
      var written = writeAt
      val buffer = ByteArray(TransferTuning.bufferBytes)
      while (true) {
        currentCoroutineContext().ensureActive()
        val read = input.read(buffer)
        if (read < 0) break
        spec.throttle.take(read)
        diskWrite { file.write(buffer, 0, read) }
        written += read
        onProgress(written, size)
      }
      runCatching { input.close() }
      // 226: the server says the whole file was sent. Without a size that is the only proof of a complete file.
      val confirmed = session.completed()
      diskWrite { file.fd.sync() }
      if (size != null && written < size) {
        throw MediaNetworkException("truncated FTP transfer of ${session.url.redacted}: $written/$size")
      }
      if (size == null && !confirmed) {
        throw MediaNetworkException("FTP transfer of ${session.url.redacted} was not confirmed")
      }
      return TransferOutcome.Completed(written, size ?: written, validator, url(session))
    } catch (io: IOException) {
      currentCoroutineContext().ensureActive()
      if (io is MediaNetworkException || io is StorageWriteException) throw io
      throw MediaNetworkException("FTP transfer of ${session.url.redacted} interrupted", io)
    } finally {
      onCancel.dispose()
      runCatching { input.close() }
      runCatching { file.close() }
    }
  }

  private companion object {
    const val BUFFER_BYTES = 64 * 1024

    val CLOSERS: ExecutorService = Executors.newCachedThreadPool { runnable ->
      Thread(runnable, "vidorax-ftp-close").apply { isDaemon = true }
    }
  }
}
