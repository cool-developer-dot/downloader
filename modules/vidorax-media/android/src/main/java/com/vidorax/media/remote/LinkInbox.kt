package com.vidorax.media.remote

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.security.SecureRandom

/** The links other places hand to VidoraX: only a plain http(s) address, at most [MAX_URL_LENGTH] characters. */
object LinkRules {
  const val MAX_URL_LENGTH = 4096

  /** [value] trimmed when it is an http(s) URL with a host, else null. The app's own link rules still apply after. */
  fun acceptable(value: String?): String? {
    val url = value?.trim() ?: return null
    if (url.isEmpty() || url.length > MAX_URL_LENGTH) return null
    if (url.any { it.isWhitespace() || it.isISOControl() }) return null
    val uri = runCatching { URI(url) }.getOrNull() ?: return null
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    if (uri.host.isNullOrBlank()) return null
    return url
  }
}

/** Links still waiting for the app to check them; kept across a process death (SharedPreferences). */
interface PendingLinkStorage {
  fun load(): List<LinkRequest>

  fun save(pending: List<LinkRequest>)
}

class InMemoryPendingLinkStorage : PendingLinkStorage {
  var saved: List<LinkRequest> = emptyList()
    private set

  override fun load(): List<LinkRequest> = saved

  override fun save(pending: List<LinkRequest>) {
    saved = pending
  }
}

class SharedPreferencesPendingLinkStorage(context: Context) : PendingLinkStorage {
  private val prefs = context.applicationContext.getSharedPreferences(RemotePrefs.FILE, Context.MODE_PRIVATE)

  override fun load(): List<LinkRequest> = runCatching {
    val array = JSONArray(prefs.getString(KEY, null) ?: return emptyList())
    (0 until array.length()).mapNotNull { index ->
      val item = array.optJSONObject(index) ?: return@mapNotNull null
      val url = LinkRules.acceptable(item.optString("url")) ?: return@mapNotNull null
      LinkRequest(
        requestId = item.optString("requestId").takeIf { it.isNotBlank() } ?: return@mapNotNull null,
        url = url,
        source = LinkSource.from(item.optString("source")),
        createdAt = item.optLong("createdAt"),
        status = LinkRequest.WAITING_FOR_APP,
      )
    }
  }.getOrDefault(emptyList())

  override fun save(pending: List<LinkRequest>) {
    val array = JSONArray()
    pending.forEach {
      array.put(
        JSONObject()
          .put("requestId", it.requestId)
          .put("url", it.url)
          .put("source", it.source.wire)
          .put("createdAt", it.createdAt),
      )
    }
    prefs.edit().putString(KEY, array.toString()).apply()
  }

  private companion object {
    const val KEY = "pending_links"
  }
}

/**
 * P6: links from the Web UI, the browser extension, the CLI and other apps (#499), on their way to the app's own Batch
 * Add path (`addLinkFromBatch`: the same page check, refusals and duplicate protection as a pasted link). That path
 * is JavaScript, so a link waits here until JavaScript listens; one that arrives while VidoraX isn't running waits for
 * the next time it is opened. Each link has a request id the caller can ask about.
 */
class LinkInbox(
  private val storage: PendingLinkStorage,
  private val clock: () -> Long = System::currentTimeMillis,
  private val random: SecureRandom = SecureRandom(),
) : RemoteLinkIntake {
  private val requests = LinkedHashMap<String, LinkRequest>()
  private var listener: ((LinkRequest) -> Unit)? = null

  init {
    synchronized(this) { storage.load().forEach { requests[it.requestId] = it } }
  }

  override fun submit(url: String, source: LinkSource): LinkRequest? {
    val accepted = LinkRules.acceptable(url) ?: return null
    val deliver: ((LinkRequest) -> Unit)?
    val request: LinkRequest
    synchronized(this) {
      if (unfinished().size >= MAX_PENDING) return null
      deliver = listener
      request = LinkRequest(
        requestId = newId(),
        url = accepted,
        source = source,
        createdAt = clock(),
        status = if (deliver != null) LinkRequest.CHECKING else LinkRequest.WAITING_FOR_APP,
      )
      requests[request.requestId] = request
      trim()
      persist()
    }
    deliver?.invoke(request)
    return request
  }

  override fun get(requestId: String): LinkRequest? = synchronized(this) { requests[requestId] }

  /**
   * JavaScript starts (or stops, with null) listening. Every link not yet reported — including ones a previous
   * JavaScript runtime was still checking — is handed to the new listener; the engine's atomic duplicate check makes
   * a second look harmless.
   */
  fun setListener(next: ((LinkRequest) -> Unit)?) {
    if (next == null) {
      synchronized(this) { listener = null }
      return
    }
    val handOver: List<LinkRequest>
    synchronized(this) {
      listener = next
      handOver = unfinished().map { it.copy(status = LinkRequest.CHECKING) }
      handOver.forEach { requests[it.requestId] = it }
    }
    handOver.forEach { next(it) }
  }

  /** The app's answer for [requestId]: `added`, `duplicate`, `needs_review` or `refused`. */
  fun report(requestId: String, outcome: String, title: String?, downloadId: String?, detail: String?): Boolean {
    synchronized(this) {
      val current = requests[requestId] ?: return false
      val status = OUTCOMES[outcome] ?: return false
      requests[requestId] = current.copy(
        status = status,
        title = title?.take(MAX_TITLE_LENGTH),
        downloadId = downloadId,
        detail = detail?.take(MAX_DETAIL_LENGTH),
      )
      persist()
      return true
    }
  }

  /** Links not yet reported, oldest first. */
  fun pending(): List<LinkRequest> = synchronized(this) { unfinished() }

  private fun unfinished(): List<LinkRequest> =
    requests.values.filter { it.status == LinkRequest.WAITING_FOR_APP || it.status == LinkRequest.CHECKING }

  private fun persist() {
    storage.save(unfinished())
  }

  /** Keeps at most [MAX_KEPT] requests, dropping the oldest finished ones first. */
  private fun trim() {
    while (requests.size > MAX_KEPT) {
      val oldestFinished = requests.values.firstOrNull { it.status != LinkRequest.WAITING_FOR_APP && it.status != LinkRequest.CHECKING }
        ?: return
      requests.remove(oldestFinished.requestId)
    }
  }

  private fun newId(): String {
    val bytes = ByteArray(9)
    random.nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
  }

  companion object {
    const val MAX_PENDING = 50
    const val MAX_KEPT = 100
    const val MAX_TITLE_LENGTH = 300
    const val MAX_DETAIL_LENGTH = 60

    /** JavaScript's BatchOutcome → the request status the API reports. */
    val OUTCOMES = mapOf(
      "added" to "added",
      "duplicate" to "duplicate",
      "needs-review" to "needs_review",
      "needs_review" to "needs_review",
      "refused" to "refused",
    )
  }
}
