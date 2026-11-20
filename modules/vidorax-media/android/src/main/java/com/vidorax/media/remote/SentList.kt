package com.vidorax.media.remote

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.security.SecureRandom

interface SentItemStorage {
  fun load(): List<SentItem>

  fun save(items: List<SentItem>)
}

class InMemorySentItemStorage : SentItemStorage {
  var saved: List<SentItem> = emptyList()
    private set

  override fun load(): List<SentItem> = saved

  override fun save(items: List<SentItem>) {
    saved = items
  }
}

class SharedPreferencesSentItemStorage(context: Context) : SentItemStorage {
  private val prefs = context.applicationContext.getSharedPreferences(RemotePrefs.FILE, Context.MODE_PRIVATE)

  override fun load(): List<SentItem> = runCatching {
    val array = JSONArray(prefs.getString(KEY, null) ?: return emptyList())
    (0 until array.length()).mapNotNull { index ->
      val item = array.optJSONObject(index) ?: return@mapNotNull null
      SentItem(
        id = item.optString("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null,
        title = item.optString("title"),
        url = item.optString("url").takeIf { it.isNotBlank() },
        libraryItemId = item.optString("libraryItemId").takeIf { it.isNotBlank() },
        sizeBytes = item.optLong("sizeBytes", -1L).takeIf { it >= 0 },
        sentAt = item.optLong("sentAt"),
      )
    }
  }.getOrDefault(emptyList())

  override fun save(items: List<SentItem>) {
    val array = JSONArray()
    items.forEach {
      array.put(
        JSONObject()
          .put("id", it.id)
          .put("title", it.title)
          .put("url", it.url ?: "")
          .put("libraryItemId", it.libraryItemId ?: "")
          .put("sizeBytes", it.sizeBytes ?: -1L)
          .put("sentAt", it.sentAt),
      )
    }
    prefs.edit().putString(KEY, array.toString()).apply()
  }

  private companion object {
    const val KEY = "sent_items"
  }
}

/**
 * #511 Send to device: the "Sent from phone" list the Web UI shows. A link is opened by the computer's own browser; a
 * finished video is downloaded from the phone through a short-lived ticket path (`/files/<ticket>/<name>`), so the
 * browser can save it with an ordinary link while the token stays out of every URL. A file is looked up in the
 * library each time: one moved to the private vault or deleted is no longer offered.
 */
class SentList(
  private val storage: SentItemStorage,
  private val resolveFile: suspend (libraryItemId: String) -> SentFile?,
  private val clock: () -> Long = System::currentTimeMillis,
  private val random: SecureRandom = SecureRandom(),
) : RemoteSentFiles {
  private data class Ticket(val itemId: String, val expiresAt: Long)

  private val items = storage.load().toMutableList()
  private val tickets = LinkedHashMap<String, Ticket>()

  /** Adds (or moves to the top) a link and/or a library video. Null when there is neither. */
  fun add(title: String, url: String?, libraryItemId: String?, sizeBytes: Long?): SentItem? {
    val link = url?.let(LinkRules::acceptable)
    val fileId = libraryItemId?.takeIf { it.isNotBlank() }
    if (link == null && fileId == null) return null
    synchronized(this) {
      items.removeAll { it.url == link && it.libraryItemId == fileId }
      val item = SentItem(
        id = newId(8),
        title = title.filter { !it.isISOControl() }.trim().take(MAX_TITLE_LENGTH).ifEmpty { link ?: "VidoraX" },
        url = link,
        libraryItemId = fileId,
        sizeBytes = sizeBytes?.takeIf { it >= 0 && fileId != null },
        sentAt = clock(),
      )
      items.add(0, item)
      while (items.size > MAX_ITEMS) items.removeAt(items.lastIndex)
      storage.save(items.toList())
      return item
    }
  }

  @Synchronized
  fun clear() {
    items.clear()
    tickets.clear()
    storage.save(emptyList())
  }

  @Synchronized
  override fun list(): List<SentItem> = items.toList()

  @Synchronized
  override fun remove(id: String): Boolean {
    val removed = items.removeAll { it.id == id }
    if (removed) {
      tickets.entries.removeAll { it.value.itemId == id }
      storage.save(items.toList())
    }
    return removed
  }

  override suspend fun ticket(id: String): String? {
    val item = synchronized(this) { items.firstOrNull { it.id == id } } ?: return null
    val file = item.libraryItemId?.let { resolveFile(it) } ?: return null
    if (!file.file.isFile) return null
    val ticket = newId(24)
    synchronized(this) {
      val now = clock()
      tickets.entries.removeAll { it.value.expiresAt <= now }
      while (tickets.size >= MAX_TICKETS) tickets.remove(tickets.keys.first())
      tickets[ticket] = Ticket(id, now + TICKET_LIFETIME_MS)
    }
    return "/files/$ticket/${encodeName(file.name)}"
  }

  override suspend fun openTicket(ticket: String): SentFile? {
    val itemId = synchronized(this) {
      val entry = tickets[ticket] ?: return null
      if (entry.expiresAt <= clock()) {
        tickets.remove(ticket)
        return null
      }
      entry.itemId
    }
    val item = synchronized(this) { items.firstOrNull { it.id == itemId } } ?: return null
    val file = item.libraryItemId?.let { resolveFile(it) } ?: return null
    return file.takeIf { it.file.isFile }
  }

  private fun newId(bytes: Int): String {
    val raw = ByteArray(bytes)
    random.nextBytes(raw)
    return raw.joinToString("") { "%02x".format(it) }
  }

  companion object {
    const val MAX_ITEMS = 30
    const val MAX_TICKETS = 20
    const val MAX_TITLE_LENGTH = 200

    /** Long enough to start (and, in a browser, resume) a big download; short enough not to be a standing key. */
    const val TICKET_LIFETIME_MS = 10L * 60 * 1000

    fun encodeName(name: String): String = URLEncoder.encode(name, "UTF-8").replace("+", "%20")
  }
}
