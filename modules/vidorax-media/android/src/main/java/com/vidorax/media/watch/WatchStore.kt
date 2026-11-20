package com.vidorax.media.watch

import android.content.Context
import org.json.JSONArray

/**
 * The watched links, on the device only (SharedPreferences `vidorax_watches`, key `links`, a JSON array). At most
 * [MAX_LINKS]; each one is a few hundred bytes plus a feed's last items.
 */
internal class WatchStore(private val storage: Storage) {
  interface Storage {
    fun read(): String?
    fun write(json: String)

    companion object {
      fun memory(): Storage = object : Storage {
        @Volatile private var value: String? = null
        override fun read(): String? = value
        override fun write(json: String) {
          value = json
        }
      }

      fun preferences(context: Context): Storage = object : Storage {
        private val prefs = context.applicationContext.getSharedPreferences("vidorax_watches", Context.MODE_PRIVATE)
        override fun read(): String? = prefs.getString("links", null)
        override fun write(json: String) {
          prefs.edit().putString("links", json).apply()
        }
      }
    }
  }

  @Synchronized
  fun list(): List<WatchedLink> {
    val raw = runCatching { storage.read() }.getOrNull() ?: return emptyList()
    return runCatching {
      val array = JSONArray(raw)
      (0 until array.length()).mapNotNull { WatchedLink.fromJson(array.getJSONObject(it)) }
    }.getOrDefault(emptyList())
  }

  @Synchronized
  fun find(id: String): WatchedLink? = list().firstOrNull { it.id == id }

  /** Adds [link], or returns the one already watching the same URL. Null when the list is full. */
  @Synchronized
  fun add(link: WatchedLink): WatchedLink? {
    val links = list()
    links.firstOrNull { it.url == link.url }?.let { return it }
    if (links.size >= MAX_LINKS) return null
    save(links + link)
    return link
  }

  @Synchronized
  fun update(id: String, change: (WatchedLink) -> WatchedLink): WatchedLink? {
    val links = list()
    val index = links.indexOfFirst { it.id == id }
    if (index < 0) return null
    val next = change(links[index])
    save(links.toMutableList().also { it[index] = next })
    return next
  }

  @Synchronized
  fun remove(id: String): Boolean {
    val links = list()
    val kept = links.filterNot { it.id == id }
    if (kept.size == links.size) return false
    save(kept)
    return true
  }

  private fun save(links: List<WatchedLink>) {
    runCatching { storage.write(JSONArray().apply { links.forEach { put(it.toJson()) } }.toString()) }
  }

  companion object {
    const val MAX_LINKS = 100
  }
}
