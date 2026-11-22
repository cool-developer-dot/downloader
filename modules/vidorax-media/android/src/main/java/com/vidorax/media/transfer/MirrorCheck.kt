package com.vidorax.media.transfer

import com.vidorax.media.model.RequestContext
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.MediaRequest
import com.vidorax.media.plan.Probe
import java.security.MessageDigest

/**
 * #347: which of a download's mirrors are the same file as its main link. A mirror is accepted only when it serves
 * byte ranges of a resource of exactly [total] bytes whose first [CHECK_BYTES] have the same SHA-256 as the main link's
 * — checked again at every start, so a mirror that changed since it was added is never used. A mirror must be a
 * public http(s) link the downloader may fetch ([HttpClient.allows], never YouTube) and not the main link itself.
 *
 * The main link's own first bytes are read the same way; when they cannot be (a refused range, another length), no
 * mirror is used and the download runs as it always did. Nothing here is a failure of the download.
 */
internal object MirrorCheck {
  /** 64 KiB: the head of the file (its container header), compared byte for byte through SHA-256. */
  const val CHECK_BYTES = 64 * 1024

  data class Accepted(val url: String, val validator: String?)

  data class Outcome(val accepted: List<Accepted>, val rejected: Int)

  fun check(http: HttpClient, mainUrl: String, context: RequestContext, total: Long, mirrors: List<String>): Outcome {
    val candidates = mirrors.map { it.trim() }.filter { it.isNotEmpty() }.distinct().filter { it != mainUrl }
    if (candidates.isEmpty() || total <= 0) return Outcome(emptyList(), candidates.size)
    val length = minOf(CHECK_BYTES.toLong(), total).toInt()
    val main = head(http, mainUrl, context, total, length) ?: return Outcome(emptyList(), candidates.size)
    val accepted = candidates.mapNotNull { mirror ->
      if (!http.allows(mirror) || Probe.isPolicyBlockedHost(mirror)) return@mapNotNull null
      val head = head(http, mirror, context, total, length) ?: return@mapNotNull null
      if (MessageDigest.isEqual(head.sha256, main.sha256)) Accepted(mirror, head.validator) else null
    }
    return Outcome(accepted, candidates.size - accepted.size)
  }

  private class Head(val sha256: ByteArray, val validator: String?)

  /** SHA-256 of `bytes=0-(length-1)` of [url], when it answers exactly that range of a [total]-byte resource. */
  private fun head(http: HttpClient, url: String, context: RequestContext, total: Long, length: Int): Head? = runCatching {
    http.execute(MediaRequest(url = url, context = context, rangeStart = 0L, rangeEnd = length - 1L)).use { response ->
      val range = response.contentRange
      if (response.status != 206 || range == null || range.start != 0L || range.total != total) return@use null
      val bytes = response.readBounded(length) ?: return@use null
      if (bytes.size != length) return@use null
      Head(MessageDigest.getInstance("SHA-256").digest(bytes), response.validator)
    }
  }.getOrNull()
}
