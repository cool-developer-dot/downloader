package com.vidorax.media.watch

import org.json.JSONArray
import org.json.JSONObject

/** What a watched link is: a file, a web page, or a feed (RSS/Atom, #363). */
enum class WatchKind(val wire: String) {
  FILE("file"),
  PAGE("page"),
  FEED("feed"),
  ;

  companion object {
    fun fromWire(value: String?): WatchKind? = entries.firstOrNull { it.wire == value }
  }
}

/** One item of a feed: its id (guid, else its link) and the video it carries. */
data class FeedItem(val id: String, val title: String?, val mediaUrl: String, val mediaType: String?, val publishedAt: Long?) {
  fun toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("title", title)
    .put("mediaUrl", mediaUrl)
    .put("mediaType", mediaType)
    .put("publishedAt", publishedAt)

  companion object {
    fun fromJson(json: JSONObject): FeedItem? {
      val id = json.optString("id").ifBlank { return null }
      val url = json.optString("mediaUrl").ifBlank { return null }
      return FeedItem(
        id,
        json.optString("title").ifBlank { null },
        url,
        json.optString("mediaType").ifBlank { null },
        json.optLong("publishedAt", 0L).takeIf { it > 0 },
      )
    }
  }
}

/**
 * #362 Link Polling / #504 Update Detection / #363 RSS Download: a link VidoraX checks by itself every
 * [intervalHours]. [fingerprint] is what the last check saw (a file's validator and length, a page's video links, a
 * feed's item ids); a different one is a change. [autoDownload] downloads a changed file or a feed's new videos.
 */
data class WatchedLink(
  val id: String,
  val url: String,
  val kind: WatchKind,
  val title: String?,
  val intervalHours: Int,
  val autoDownload: Boolean,
  val fingerprint: String? = null,
  val lastCheckedAt: Long? = null,
  val lastChangedAt: Long? = null,
  /** "ok", "not_found", "error" — how the last check went. */
  val lastStatus: String? = null,
  val createdAt: Long,
  /** A feed's newest items (at most [MAX_ITEMS]), for the list in the app. */
  val items: List<FeedItem> = emptyList(),
) {
  fun isDue(now: Long): Boolean = lastCheckedAt == null || now - lastCheckedAt >= intervalHours * HOUR_MS

  fun toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("url", url)
    .put("kind", kind.wire)
    .put("title", title)
    .put("intervalHours", intervalHours)
    .put("autoDownload", autoDownload)
    .put("fingerprint", fingerprint)
    .put("lastCheckedAt", lastCheckedAt)
    .put("lastChangedAt", lastChangedAt)
    .put("lastStatus", lastStatus)
    .put("createdAt", createdAt)
    .put("items", JSONArray().apply { items.forEach { put(it.toJson()) } })

  companion object {
    const val HOUR_MS = 60L * 60 * 1000
    const val MAX_ITEMS = 20
    val INTERVALS_HOURS = listOf(1, 6, 24, 168)

    fun fromJson(json: JSONObject): WatchedLink? = runCatching {
      val items = json.optJSONArray("items")
      WatchedLink(
        id = json.getString("id"),
        url = json.getString("url"),
        kind = WatchKind.fromWire(json.optString("kind")) ?: return null,
        title = json.optString("title").ifBlank { null },
        intervalHours = json.optInt("intervalHours", 24).coerceIn(1, 24 * 30),
        autoDownload = json.optBoolean("autoDownload", false),
        fingerprint = json.optString("fingerprint").ifBlank { null },
        lastCheckedAt = json.optLong("lastCheckedAt", 0L).takeIf { it > 0 },
        lastChangedAt = json.optLong("lastChangedAt", 0L).takeIf { it > 0 },
        lastStatus = json.optString("lastStatus").ifBlank { null },
        createdAt = json.optLong("createdAt", 0L),
        items = (0 until (items?.length() ?: 0)).mapNotNull { FeedItem.fromJson(items!!.getJSONObject(it)) },
      )
    }.getOrNull()
  }
}
