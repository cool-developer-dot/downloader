package com.vidorax.media.watch

import com.vidorax.media.model.RequestContext
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRefusedException
import com.vidorax.media.net.MediaRequest
import java.security.MessageDigest

/** What one check of a watched link found. */
internal data class LinkCheck(
  /** "ok", "not_found" or "error". */
  val status: String,
  /** Null when nothing could be read (a failed check never counts as a change). */
  val fingerprint: String?,
  /** A feed's video items, newest as the feed lists them. */
  val items: List<FeedItem> = emptyList(),
  /** For a new link: what it turned out to be. */
  val kind: WatchKind? = null,
  val title: String? = null,
)

/**
 * Looks at a watched link without downloading it: a file by its first byte (validator, length), a page by the video
 * links in its HTML (ads and counters around them do not count), a feed by its items. Public addresses only, like
 * every other request VidoraX makes.
 */
internal class LinkChecker(private val http: HttpClient) {
  private val context = RequestContext(null, null, null, emptyMap(), useCookies = false)

  fun check(url: String, kind: WatchKind?): LinkCheck = try {
    when (kind) {
      WatchKind.FILE -> checkFile(url)
      WatchKind.PAGE, WatchKind.FEED, null -> checkDocument(url, kind)
    }
  } catch (e: MediaRefusedException) {
    LinkCheck("error", null)
  } catch (e: MediaNetworkException) {
    LinkCheck("error", null)
  } catch (e: java.io.IOException) {
    LinkCheck("error", null)
  }

  private fun checkFile(url: String): LinkCheck =
    http.execute(MediaRequest(url = url, context = context, rangeStart = 0L, rangeEnd = 0L)).use { response ->
      when (response.status) {
        404, 410 -> LinkCheck("not_found", "missing")
        in 200..299 -> {
          val length = response.contentRange?.total ?: response.contentLength
          LinkCheck("ok", "${response.validator ?: ""}|${length ?: ""}", kind = WatchKind.FILE)
        }
        else -> LinkCheck("error", null)
      }
    }

  private fun checkDocument(url: String, expected: WatchKind?): LinkCheck =
    http.execute(MediaRequest(url = url, context = context)).use { response ->
      when (response.status) {
        404, 410 -> return LinkCheck("not_found", "missing")
        in 200..299 -> Unit
        else -> return LinkCheck("error", null)
      }
      val type = response.contentType?.lowercase().orEmpty()
      val isText = type.isEmpty() || type.startsWith("text/") || type.contains("xml") || type.contains("json") || type.contains("rss")
      if (expected == null && !isText) {
        // A new link that is a media file: watched as a file from now on.
        val length = response.contentRange?.total ?: response.contentLength
        return LinkCheck("ok", "${response.validator ?: ""}|${length ?: ""}", kind = WatchKind.FILE)
      }
      val bytes = response.readBounded(MAX_DOCUMENT_BYTES) ?: return LinkCheck("error", null)
      val text = String(bytes, Charsets.UTF_8)
      val base = response.finalUrl
      if (expected == WatchKind.FEED || (expected == null && FeedParser.isFeed(text))) {
        val items = FeedParser.parse(text, base)
        val title = Regex("<title\\b[^>]*>([\\s\\S]*?)</title>", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1)?.trim()
        LinkCheck("ok", digest(items.joinToString("\n") { it.id }), items, WatchKind.FEED, title?.take(200))
      } else {
        val videos = PageVideos.find(text, base)
        val title = Regex("<title\\b[^>]*>([\\s\\S]*?)</title>", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1)?.trim()
        LinkCheck("ok", digest(videos.joinToString("\n")), kind = WatchKind.PAGE, title = title?.take(200))
      }
    }

  companion object {
    const val MAX_DOCUMENT_BYTES = 2 * 1024 * 1024

    fun digest(text: String): String =
      MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }.take(32)
  }
}

/** The video links a page names in its HTML: `<video>`/`<source>` sources, Open Graph video, links to video files. */
internal object PageVideos {
  private val ATTR = Regex(
    "(?:src|href|content|data-src)\\s*=\\s*[\"']([^\"']+?\\.(?:mp4|m4v|mov|webm|mkv|flv|m3u8|mpd)(?:\\?[^\"']*)?)[\"']",
    RegexOption.IGNORE_CASE,
  )
  private val OG_VIDEO = Regex("<meta[^>]+property=[\"']og:video(?::url|:secure_url)?[\"'][^>]*content=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)

  fun find(html: String, base: String): List<String> {
    val found = sortedSetOf<String>()
    for (match in ATTR.findAll(html) + OG_VIDEO.findAll(html)) {
      val raw = match.groupValues[1].replace("&amp;", "&")
      val url = runCatching { java.net.URI(base).resolve(raw).toString() }.getOrNull() ?: continue
      // Signed query strings change on every load; the file they name is what counts.
      found += url.substringBefore('?')
      if (found.size >= 200) break
    }
    return found.toList()
  }
}
