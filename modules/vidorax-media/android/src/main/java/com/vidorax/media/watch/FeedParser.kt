package com.vidorax.media.watch

import java.net.URI
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * #363 RSS Download: the video items of an RSS 2.0, Media RSS or Atom feed. An item's video is its enclosure
 * (`<enclosure>`, `<media:content>`, Atom `<link rel="enclosure">`) or a link that names a video file. Audio-only
 * items (podcasts) are left out: VidoraX saves videos. Pure and tolerant: markup it does not understand is skipped.
 */
internal object FeedParser {
  private val ITEM = Regex("<(item|entry)\\b[\\s\\S]*?</\\1>", RegexOption.IGNORE_CASE)
  private val VIDEO_EXT = Regex("\\.(?:mp4|m4v|mov|webm|mkv|flv|ts|m3u8|mpd|avi|wmv|3gp)(?:$|[?#])", RegexOption.IGNORE_CASE)

  fun isFeed(text: String): Boolean {
    val head = text.trimStart('\uFEFF', ' ', '\n', '\r', '\t').take(2048).lowercase()
    return head.contains("<rss") || (head.contains("<feed") && head.contains("www.w3.org/2005/atom")) || head.contains("<rdf:rdf")
  }

  fun parse(text: String, baseUrl: String): List<FeedItem> {
    val items = mutableListOf<FeedItem>()
    for (match in ITEM.findAll(text)) {
      val block = match.value
      val title = tag(block, "title")
      val link = tag(block, "link") ?: attr(block, "link", "href")
      val id = tag(block, "guid") ?: tag(block, "id") ?: link
      val published = (tag(block, "pubDate") ?: tag(block, "published") ?: tag(block, "updated"))?.let(::parseDate)
      val media = enclosures(block).firstOrNull { isVideo(it.first, it.second) }
        ?: link?.takeIf { VIDEO_EXT.containsMatchIn(it) }?.let { it to null }
        ?: continue
      val url = absolute(media.first, baseUrl) ?: continue
      items += FeedItem(id = (id ?: url).take(512), title = title?.take(300), mediaUrl = url, mediaType = media.second, publishedAt = published)
      if (items.size >= MAX_ITEMS) break
    }
    return items
  }

  /** (url, type) of every enclosure-like element in an item. */
  private fun enclosures(block: String): List<Pair<String, String?>> {
    val out = mutableListOf<Pair<String, String?>>()
    for (element in Regex("<(?:enclosure|media:content)\\b[^>]*>", RegexOption.IGNORE_CASE).findAll(block)) {
      val url = attrOf(element.value, "url") ?: continue
      val medium = attrOf(element.value, "medium")
      val type = attrOf(element.value, "type") ?: medium?.let { if (it.equals("video", true)) "video/*" else it }
      out += url to type
    }
    for (element in Regex("<link\\b[^>]*rel=[\"']enclosure[\"'][^>]*>", RegexOption.IGNORE_CASE).findAll(block)) {
      val url = attrOf(element.value, "href") ?: continue
      out += url to attrOf(element.value, "type")
    }
    return out
  }

  private fun isVideo(url: String, type: String?): Boolean {
    val t = type?.lowercase()
    if (t != null) {
      if (t.startsWith("audio/") || t == "audio") return false
      if (t.startsWith("video/") || t.contains("mpegurl") || t.contains("dash+xml")) return true
    }
    return VIDEO_EXT.containsMatchIn(url)
  }

  private fun tag(block: String, name: String): String? =
    Regex("<$name\\b[^>]*>([\\s\\S]*?)</$name>", RegexOption.IGNORE_CASE).find(block)?.groupValues?.get(1)?.let(::decode)?.ifBlank { null }

  private fun attr(block: String, element: String, name: String): String? =
    Regex("<$element\\b[^>]*>", RegexOption.IGNORE_CASE).find(block)?.value?.let { attrOf(it, name) }

  private fun attrOf(element: String, name: String): String? =
    Regex("\\b$name\\s*=\\s*([\"'])(.*?)\\1", RegexOption.IGNORE_CASE).find(element)?.groupValues?.get(2)?.let(::decode)?.ifBlank { null }

  /**
   * XML entities, then once more the entities a title often carries double-encoded (`&amp;#039;` → `'`): feeds put
   * HTML-escaped text inside XML.
   */
  private fun decode(text: String): String =
    entities(entities(text.replace(Regex("<!\\[CDATA\\[([\\s\\S]*?)]]>"), "$1"))).replace('\u00A0', ' ').trim()

  private val NUMERIC = Regex("&#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}));")

  private fun entities(text: String): String = NUMERIC.replace(text) { m ->
    val code = m.groupValues[1].takeIf { it.isNotEmpty() }?.toIntOrNull(16) ?: m.groupValues[2].toIntOrNull()
    if (code != null && code in 1..0x10FFFF && code !in 0xD800..0xDFFF) String(Character.toChars(code)) else m.value
  }
    .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&nbsp;", "\u00A0")
    .replace("&amp;", "&")

  private fun absolute(raw: String, base: String): String? = runCatching {
    val uri = URI(base).resolve(raw.trim())
    uri.toString().takeIf { uri.scheme == "http" || uri.scheme == "https" }
  }.getOrNull()

  private fun parseDate(text: String): Long? {
    for (pattern in listOf("EEE, dd MMM yyyy HH:mm:ss Z", "EEE, dd MMM yyyy HH:mm Z", "yyyy-MM-dd'T'HH:mm:ssXXX", "yyyy-MM-dd'T'HH:mm:ss.SSSXXX")) {
      runCatching { return SimpleDateFormat(pattern, Locale.US).parse(text.trim())?.time }
    }
    return null
  }

  const val MAX_ITEMS = 50
}
