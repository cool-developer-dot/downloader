package com.vidorax.media.plan

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.DownloadCredentials
import com.vidorax.media.net.FtpConnector
import com.vidorax.media.net.FtpSession
import com.vidorax.media.net.FtpUrl
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRefusedException
import java.io.IOException
import java.io.InputStream

/**
 * #304: classifies one file on an FTP server the way [Probe] classifies an http(s) file — from its size (SIZE) and
 * its first [Probe.PROBE_BYTES] (RETR, read and dropped), through the same [MediaSniffer] allowlist. So an FTP link is
 * DOWNLOADABLE only when its bytes are a video: an audio-only file, a playlist, an encrypted MP4 (its trailing `moov`
 * read with a REST offset when the server can) and a length-less TS/FLV (a live feed) are refused with the usual codes.
 *
 * Sign-in comes from the link itself (a probe before the download exists) or from the download's own
 * [DownloadCredentials] ([RequestContext.authKey]); anonymous otherwise. Never a password in a result or a message.
 */
internal class FtpProbe(private val connector: FtpConnector = FtpConnector()) {
  fun probe(rawUrl: String, context: RequestContext): ProbeResult {
    val url = FtpUrl.parse(rawUrl) ?: return failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "Not a usable FTP link")
    val login = DownloadCredentials.ftpLoginFor(context.authKey, url)
    return try {
      connector.withSession(url, login) { classify(it) }
    } catch (e: MediaRefusedException) {
      failure(e.reason, null, e.message)
    } catch (e: MediaHttpException) {
      when (e.statusCode) {
        401 -> failure(ProbeFailure.HTTP_403, 401, "The FTP server refused the sign-in")
        404 -> failure(ProbeFailure.HTTP_404, 404, "Not found on the FTP server")
        else -> failure(ProbeFailure.HTTP_ERROR, e.statusCode, "FTP server error")
      }
    } catch (e: IOException) {
      failure(ProbeFailure.NETWORK, null, "Could not reach the FTP server")
    }
  }

  private fun classify(session: FtpSession): ProbeResult {
    val url = session.url
    val size = session.size()
    val prefix = readFrom(session, 0L, Probe.PROBE_BYTES)
      ?: return failure(ProbeFailure.HTTP_ERROR, null, "The FTP server would not send the file")
    if (MediaSniffer.isHlsPlaylist(prefix) || MediaSniffer.isDashManifest(prefix)) {
      return failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "A playlist, not a video file")
    }
    val verdict = MediaSniffer.sniff(prefix, null, url.withoutUserInfo, size)
    if (verdict is SniffResult.Unsupported) return failure(verdict.reason, null, verdict.detail)
    verdict as SniffResult.Supported
    if (MediaSniffer.isAudioOnly(prefix)) {
      return failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "Audio only: the file has no video track")
    }
    if (size == null && (verdict.container == Container.TS ||
        (verdict.container == Container.FLV && (MediaSniffer.flvMetadataDurationSeconds(prefix) ?: 0.0) <= 0.0))
    ) {
      return failure(ProbeFailure.LIVE_UNSUPPORTED, null, "Live stream: the server gives no length")
    }
    val resumable = session.canResume()
    if ((verdict.container == Container.MP4 || verdict.container == Container.MOV) && size != null && resumable) {
      val offset = MediaSniffer.trailingBoxesOffset(prefix)
      if (offset != null && offset in 1 until size) {
        val tail = runCatching { readFrom(session, offset, Probe.TAIL_PROBE_BYTES.toInt()) }.getOrNull()
        tail?.let { MediaSniffer.trailingMoovVerdict(it) }?.let { refusal ->
          return failure(refusal.reason, null, refusal.detail)
        }
      }
    }
    return ProbeResult.Success(
      kind = SourceKind.FTP,
      finalUrl = url.withoutUserInfo,
      contentType = null,
      container = verdict.container,
      sizeBytes = size,
      resumable = resumable,
      variants = emptyList(),
      audioTracks = emptyList(),
      durationMs = null,
    )
  }

  /**
   * Up to [max] bytes of the file from [offset], then the data connection is dropped and the server's reply to the
   * cut transfer consumed, so the session can send its next command. Null when the server would not start there.
   */
  private fun readFrom(session: FtpSession, offset: Long, max: Int): ByteArray? {
    val stream = session.retrieve(offset) ?: return null
    val bytes = try {
      readUpTo(stream, max)
    } catch (e: IOException) {
      throw MediaNetworkException("FTP read from ${session.url.redacted} failed", e)
    } finally {
      runCatching { stream.close() }
    }
    session.completed()
    return bytes
  }

  private fun readUpTo(input: InputStream, max: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    var total = 0
    while (total < max) {
      val read = input.read(buffer, 0, minOf(buffer.size, max - total))
      if (read < 0) break
      out.write(buffer, 0, read)
      total += read
    }
    return out.toByteArray()
  }

  private fun failure(reason: ProbeFailure, status: Int?, message: String?) = ProbeResult.Failure(reason, status, message)
}
