package com.vidorax.media.plan

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SourceKind
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRefusedException
import com.vidorax.media.net.MediaRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** A DASH manifest resolved to the one file a download would fetch, with that file's own classification. */
internal sealed interface DashResolution {
  data class Ready(val plan: DashPlan, val media: ProbeResult.Success) : DashResolution

  data class Refused(val failure: ProbeResult.Failure) : DashResolution
}

/**
 * The one classifier every source goes through: a bounded, allowlist decision that ends in exactly one of
 * DOWNLOADABLE (a [ProbeResult.Success]), PROTECTED (`DRM_PROTECTED`), UNSUPPORTED (`UNSUPPORTED_FORMAT`,
 * `LIVE_UNSUPPORTED`, `NOT_MEDIA`, `POLICY_BLOCKED`) or a transient failure (`NETWORK`, `HTTP_403`, `HTTP_ERROR`).
 *
 * Progressive sources are classified from the first [PROBE_BYTES] (headers and magic bytes, never the extension
 * alone — extensionless CDN URLs are the norm). HLS and DASH — requested as such, or discovered because the bytes
 * are a playlist or a manifest — go to [HlsPlanner] and [DashPlanner]. A DASH verdict is only DOWNLOADABLE when the
 * representation it would download is itself classified here as a complete progressive video file.
 */
internal class Probe(
  private val http: HttpClient,
  private val hls: HlsPlanner = HlsPlanner(http),
  private val dash: DashPlanner = DashPlanner(http),
) {
  suspend fun probe(request: ProbeRequest): ProbeResult =
    withContext(Dispatchers.IO) { probeBlocking(request, request.variant) }

  /** The file a DASH download would fetch, for the engine; [probe] reports the same verdict for the manifest. */
  suspend fun resolveDash(url: String, context: RequestContext, choice: VariantChoice?): DashResolution =
    withContext(Dispatchers.IO) { resolveDashBlocking(url, context, choice) }

  private suspend fun probeBlocking(request: ProbeRequest, choice: VariantChoice?): ProbeResult {
    // An inline manifest cannot be downloaded later: a download is always re-resolved from a URL.
    if (request.manifestText != null) {
      return failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "Inline DASH manifests are not supported")
    }
    if (isPolicyBlockedHost(request.url)) {
      return failure(ProbeFailure.POLICY_BLOCKED, null, "This source is not supported")
    }
    return when (request.kind) {
      SourceKind.HLS -> planHls(request.url, request.request, choice)
      SourceKind.DASH -> planDash(request.url, request.request, choice)
      else -> when (val file = probeFile(request.url, request.request)) {
        is FileProbe.Classified -> file.result
        // The bytes are a playlist or a manifest (an extensionless or mislabelled URL): classify the stream it is.
        FileProbe.HlsPlaylist -> planHls(request.url, request.request, choice)
        FileProbe.DashManifest -> planDash(request.url, request.request, choice)
      }
    }
  }

  private sealed interface FileProbe {
    data class Classified(val result: ProbeResult) : FileProbe

    data object HlsPlaylist : FileProbe

    data object DashManifest : FileProbe
  }

  /** What the first read of a file showed, kept past closing that response. */
  private class FirstRead(
    val status: Int,
    val finalUrl: String,
    val contentType: String?,
    val totalSize: Long?,
    val resumable: Boolean,
    val prefix: ByteArray,
  )

  /** Classifies one file from its first bytes; a playlist or manifest is reported as such, never as a file. */
  private fun probeFile(url: String, context: RequestContext): FileProbe {
    val response = try {
      http.execute(MediaRequest(url = url, context = context, rangeStart = 0L))
    } catch (e: MediaRefusedException) {
      return FileProbe.Classified(failure(e.reason, null, "This source is not supported"))
    } catch (e: MediaNetworkException) {
      // Transport failure: transient, not a verdict on the media.
      return FileProbe.Classified(failure(ProbeFailure.NETWORK, null, "Could not reach the server"))
    }

    // The first response is a `bytes=0-` stream: it is closed once its prefix is read, before any further request.
    val first = response.use {
      when (val status = it.status) {
        403, 401 -> return FileProbe.Classified(failure(ProbeFailure.HTTP_403, status, "Access denied"))
        404, 410 -> return FileProbe.Classified(failure(ProbeFailure.HTTP_404, status, "Not found"))
        in 200..299 -> Unit
        else -> return FileProbe.Classified(failure(ProbeFailure.HTTP_ERROR, status, "Server error"))
      }
      // A 206 must start where we asked; mid-file bytes would be classified as something they are not.
      val range = it.contentRange
      if (it.status == 206 && range != null && range.start != 0L) {
        return FileProbe.Classified(failure(ProbeFailure.HTTP_ERROR, it.status, "Server returned the wrong byte range"))
      }
      val prefix = try {
        it.readPrefix(PROBE_BYTES)
      } catch (e: java.io.IOException) {
        return FileProbe.Classified(failure(ProbeFailure.NETWORK, null, "Could not read from the server"))
      }
      FirstRead(
        status = it.status,
        finalUrl = it.finalUrl,
        contentType = it.contentType,
        // Content-Range carries the true total on a 206; a 200 gives the full length in Content-Length.
        totalSize = range?.total ?: if (it.status == 200) it.contentLength else null,
        resumable = it.supportsRanges,
        prefix = prefix,
      )
    }
    val prefix = first.prefix

    if (MediaSniffer.isHlsPlaylist(prefix)) return FileProbe.HlsPlaylist
    if (MediaSniffer.isDashManifest(prefix)) return FileProbe.DashManifest
    val verdict = MediaSniffer.sniff(prefix, first.contentType, first.finalUrl, first.totalSize)
    // Pages that split a stream into separate audio and video files expose the audio file on its own. After
    // the sniff, so an encrypted one is still reported as protected.
    if (verdict is SniffResult.Supported && MediaSniffer.isAudioOnly(prefix)) {
      return FileProbe.Classified(failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "Audio only: the file has no video track"))
    }
    if (verdict is SniffResult.Supported && (verdict.container == Container.MP4 || verdict.container == Container.MOV)) {
      trailingMoovVerdict(first.finalUrl, context, prefix, first.totalSize, first.status)?.let { refusal ->
        return FileProbe.Classified(failure(refusal.reason, null, refusal.detail))
      }
    }
    return FileProbe.Classified(
      when (verdict) {
        is SniffResult.Supported -> ProbeResult.Success(
          kind = SourceKind.PROGRESSIVE,
          finalUrl = first.finalUrl,
          contentType = first.contentType,
          container = verdict.container,
          sizeBytes = first.totalSize,
          resumable = first.resumable,
          variants = emptyList(),
          audioTracks = emptyList(),
          durationMs = null,
        )
        is SniffResult.Unsupported -> failure(verdict.reason, null, verdict.detail)
      },
    )
  }

  /**
   * An MP4/MOV saved without "fast start" keeps its track list after the media data, out of the first read. One
   * bounded range read of the boxes that follow classifies it too: an encrypted file is refused before any of it is
   * downloaded or offered, and the audio half of a split stream is not taken for a video. Only a server that honours
   * ranges is asked; a read that fails, or answers other bytes, proves nothing (the Verifier still checks the file).
   */
  private fun trailingMoovVerdict(
    url: String,
    context: RequestContext,
    prefix: ByteArray,
    totalSize: Long?,
    firstStatus: Int,
  ): SniffResult.Unsupported? {
    if (firstStatus != 206 || totalSize == null) return null
    val offset = MediaSniffer.trailingBoxesOffset(prefix) ?: return null
    if (offset >= totalSize) return null
    val end = minOf(totalSize, offset + TAIL_PROBE_BYTES) - 1
    val response = try {
      http.execute(MediaRequest(url = url, context = context, rangeStart = offset, rangeEnd = end))
    } catch (e: MediaRefusedException) {
      return null
    } catch (e: MediaNetworkException) {
      return null
    }
    return response.use {
      val range = it.contentRange
      if (it.status != 206 || range == null || range.start != offset) return@use null
      val tail = try {
        it.readPrefix(TAIL_PROBE_BYTES.toInt())
      } catch (e: java.io.IOException) {
        return@use null
      }
      MediaSniffer.trailingMoovVerdict(tail)
    }
  }

  private suspend fun planHls(url: String, context: RequestContext, choice: VariantChoice?): ProbeResult =
    when (val result = hls.plan(url, context, choice)) {
      // Before anything is enqueued, the bytes must agree that this playlist is a video (not subtitles or audio).
      is HlsPlanResult.Ready -> hls.confirmMedia(result.plan, context) ?: HlsPlanner.toProbeResult(result.plan)
      is HlsPlanResult.Refused -> result.failure
    }

  private suspend fun planDash(url: String, context: RequestContext, choice: VariantChoice?): ProbeResult =
    when (val resolved = resolveDashBlocking(url, context, choice)) {
      is DashResolution.Ready -> DashPlanner.toProbeResult(resolved.plan, resolved.media)
      is DashResolution.Refused -> resolved.failure
    }

  /**
   * The manifest decides which representation; the representation's own bytes decide whether it is a video file
   * the engine can finish (complete, unencrypted, with a video track) — the same test as any progressive source.
   */
  private suspend fun resolveDashBlocking(url: String, context: RequestContext, choice: VariantChoice?): DashResolution {
    val plan = when (val planned = dash.plan(url, context, choice)) {
      is DashPlanResult.Ready -> planned.plan
      is DashPlanResult.Refused -> return DashResolution.Refused(planned.failure)
    }
    return when (val file = probeFile(plan.mediaUrl, context)) {
      is FileProbe.Classified -> when (val result = file.result) {
        is ProbeResult.Success -> DashResolution.Ready(plan, result)
        is ProbeResult.Failure -> DashResolution.Refused(result)
      }
      FileProbe.HlsPlaylist, FileProbe.DashManifest ->
        DashResolution.Refused(failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "DASH representation is not a media file"))
    }
  }

  private fun failure(reason: ProbeFailure, httpStatus: Int?, message: String?): ProbeResult.Failure =
    ProbeResult.Failure(reason = reason, httpStatus = httpStatus, message = message)

  internal companion object {
    /** 64 KiB: enough for an ftyp+moov header or a manifest, small enough to stay off the heap. */
    const val PROBE_BYTES = 64 * 1024

    /**
     * 2 MiB of the boxes after the media data: a `moov` is metadata, and its encryption boxes sit in the sample
     * descriptions near its start, so even a longer one is classified from its head.
     */
    const val TAIL_PROBE_BYTES = 2L * 1024 * 1024

    val BLOCKED_HOSTS = listOf("youtube.com", "youtu.be", "googlevideo.com")

    /** YouTube is refused by product policy, whatever its format. */
    fun isPolicyBlockedHost(url: String): Boolean {
      val host = url.toHttpUrlOrNull()?.host?.lowercase() ?: return false
      return BLOCKED_HOSTS.any { host == it || host.endsWith(".$it") }
    }
  }
}
