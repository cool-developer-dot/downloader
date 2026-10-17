package com.vidorax.media.net

import android.content.Context
import com.vidorax.media.model.BasicCredentials
import com.vidorax.media.model.DownloadRecord
import com.vidorax.media.model.DownloadState
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import okhttp3.Credentials
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject

/**
 * Authentication Support (#299): the user name and password of one download, for a server that asks for HTTP Basic
 * authentication. They come with the download's enqueue (or again with `setDownloadCredentials` after a process death)
 * and live only in this process's memory, keyed by download id:
 *
 * - **never saved**, never returned to JavaScript, never logged or put into an exception message;
 * - **pinned** to the origin (scheme, host and port) of the download's own URL, which must be https: [HttpClient] sends
 *   `Authorization: Basic …` only on a request to exactly that origin over https, and never again in a redirect chain
 *   once it left that origin;
 * - **cleared** when the download completes, is cancelled or fails ([install]), and with the process.
 *
 * What is kept on disk (SharedPreferences `vidorax_download_auth`) is only that a download *uses* sign-in, with its
 * origin and realm — no secret — so that resuming or retrying it after a process death asks for the password again.
 */
internal object DownloadCredentials {
  /** The pinned origin of a download, e.g. `https://media.example.com:443`. */
  data class Origin(val scheme: String, val host: String, val port: Int) {
    override fun toString(): String = "$scheme://$host:$port"

    fun matches(url: HttpUrl): Boolean = url.scheme == scheme && url.host == host && url.port == port

    companion object {
      fun of(url: HttpUrl): Origin = Origin(url.scheme, url.host, url.port)
    }
  }

  /** What JavaScript needs to ask again: where the user signs in. No secret. */
  data class SignIn(val origin: String, val realm: String?)

  private class Entry(val origin: Origin, val authorization: String) {
    override fun toString(): String = "Entry($origin, authorization=<redacted>)"
  }

  private val entries = ConcurrentHashMap<String, Entry>()

  @Volatile private var flags: Flags = Flags.MEMORY

  /**
   * Holds [credentials] for [downloadId], pinned to the origin of [downloadUrl], and remembers that the download uses
   * sign-in. Only for an https URL: anything else is refused — nothing is kept, false is returned (the bridge already
   * rejects such a request with ERR_INVALID_REQUEST before it gets here).
   */
  fun put(downloadId: String, downloadUrl: String, credentials: BasicCredentials, realm: String? = null): Boolean {
    val url = downloadUrl.toHttpUrlOrNull()?.takeIf { it.isHttps } ?: return false
    val origin = Origin.of(url)
    entries[downloadId] = Entry(origin, header(credentials))
    flags.mark(downloadId, SignIn(origin.toString(), realm))
    return true
  }

  /**
   * After a process death: the credentials again, for a download that was started with sign-in — pinned to the origin
   * remembered then, never to anything JavaScript says. False when [downloadId] never used sign-in.
   */
  fun restore(downloadId: String, credentials: BasicCredentials): Boolean {
    val signIn = flags.get(downloadId) ?: return false
    val url = signIn.origin.toHttpUrlOrNull()?.takeIf { it.isHttps } ?: return false
    entries[downloadId] = Entry(Origin.of(url), header(credentials))
    return true
  }

  fun has(downloadId: String): Boolean = entries.containsKey(downloadId)

  /** Whether [downloadId] was started with sign-in (whether or not its credentials are still in memory). */
  fun usesSignIn(downloadId: String): Boolean = flags.get(downloadId) != null

  /** Where [downloadId] signs in when it uses sign-in and its credentials are gone (a process death, a failure). */
  fun neededFor(downloadId: String): SignIn? = if (has(downloadId)) null else flags.get(downloadId)

  /** Forgets the credentials (the download stopped); [forgetSignIn] also forgets that it ever used sign-in. */
  fun clear(downloadId: String, forgetSignIn: Boolean = false) {
    entries.remove(downloadId)
    if (forgetSignIn) flags.unmark(downloadId)
  }

  /**
   * The `Authorization` value for a request of [authKey] (a download id, see `RequestContext.authKey`) to [url]: only
   * over https, only to exactly the pinned origin. Null in every other case.
   */
  fun authorizationFor(authKey: String?, url: HttpUrl): String? {
    if (authKey == null || !url.isHttps) return null
    val entry = entries[authKey] ?: return null
    return entry.authorization.takeIf { entry.origin.matches(url) }
  }

  /** Whether [url] is the origin [authKey]'s credentials are pinned to (redirect handling in [HttpClient]). */
  fun isPinnedOrigin(authKey: String?, url: HttpUrl): Boolean {
    if (authKey == null) return false
    return entries[authKey]?.origin?.matches(url) == true
  }

  /**
   * Clears credentials as downloads stop: completed or cancelled ones forget sign-in entirely; a failed one keeps the
   * mark, so Retry asks again. Called once per process, with the engine (DownloadEngineProvider).
   */
  fun install(context: Context, stateChanges: Flow<DownloadRecord>, scope: CoroutineScope) =
    install(SharedPreferencesFlags(context), stateChanges, scope)

  internal fun install(flags: Flags, stateChanges: Flow<DownloadRecord>, scope: CoroutineScope) {
    this.flags = flags
    scope.launch {
      stateChanges.collect { record ->
        when (record.state) {
          DownloadState.COMPLETED, DownloadState.CANCELLED -> clear(record.id, forgetSignIn = true)
          DownloadState.FAILED -> clear(record.id)
          else -> Unit
        }
      }
    }
  }

  internal fun resetForTests(flags: Flags = Flags.memory()) {
    entries.clear()
    this.flags = flags
  }

  /** RFC 7617: `Basic base64(user-id ":" password)`, UTF-8. */
  private fun header(credentials: BasicCredentials): String =
    Credentials.basic(credentials.username, credentials.password, Charsets.UTF_8)

  /** Which downloads use sign-in, with their origin and realm (no secret). Bounded. */
  interface Flags {
    fun get(downloadId: String): SignIn?

    fun mark(downloadId: String, signIn: SignIn)

    fun unmark(downloadId: String)

    companion object {
      val MEMORY: Flags = memory()

      fun memory(): Flags = object : Flags {
        private val map = ConcurrentHashMap<String, SignIn>()

        override fun get(downloadId: String): SignIn? = map[downloadId]

        override fun mark(downloadId: String, signIn: SignIn) {
          map[downloadId] = signIn
        }

        override fun unmark(downloadId: String) {
          map.remove(downloadId)
        }
      }
    }
  }

  /** SharedPreferences `vidorax_download_auth`, key `byId`: JSON id → {origin, realm}; at most [MAX_FLAGS] ids. */
  private class SharedPreferencesFlags(context: Context) : Flags {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    override fun get(downloadId: String): SignIn? = read()[downloadId]

    @Synchronized
    override fun mark(downloadId: String, signIn: SignIn) {
      val next = LinkedHashMap(read())
      next.remove(downloadId)
      next[downloadId] = signIn
      while (next.size > MAX_FLAGS) next.remove(next.keys.first())
      write(next)
    }

    @Synchronized
    override fun unmark(downloadId: String) {
      val current = read()
      if (downloadId in current) write(current - downloadId)
    }

    private fun read(): Map<String, SignIn> = runCatching {
      val root = JSONObject(prefs.getString(KEY, null) ?: return emptyMap())
      val out = LinkedHashMap<String, SignIn>()
      for (id in root.keys()) {
        val entry = root.optJSONObject(id) ?: continue
        val origin = entry.optString("origin").takeIf { it.startsWith("https://") } ?: continue
        out[id] = SignIn(origin, entry.optString("realm").ifBlank { null })
      }
      out
    }.getOrDefault(emptyMap())

    private fun write(map: Map<String, SignIn>) {
      val editor = prefs.edit()
      if (map.isEmpty()) {
        editor.remove(KEY)
      } else {
        val root = JSONObject()
        for ((id, signIn) in map) {
          root.put(id, JSONObject().put("origin", signIn.origin).apply { signIn.realm?.let { put("realm", it) } })
        }
        editor.putString(KEY, root.toString())
      }
      editor.apply()
    }

    private companion object {
      const val PREFS = "vidorax_download_auth"
      const val KEY = "byId"
      const val MAX_FLAGS = 100
    }
  }
}

/**
 * #299: a 401's `WWW-Authenticate: Basic realm="…"` challenge, as the probe reports it: the origin that asks
 * (scheme://host:port of the answering URL) and its realm, cleaned for display. Null for any other status or scheme.
 */
internal object BasicChallenge {
  private const val MAX_REALM = 128
  private val BASIC = Regex("(?:^|,)\s*Basic(?=\s|,|$)", RegexOption.IGNORE_CASE)
  private val NEXT_CHALLENGE = Regex(",\s*[\w!#$%&'*+.^`|~-]+\s+[\w!#$%&'*+.^`|~-]+\s*=")
  private val REALM = Regex("realm\s*=\s*(?:\"((?:[^\"\\]|\\.)*)\"|([^\s,]+))", RegexOption.IGNORE_CASE)
  private val QUOTED_PAIR = Regex("\\(.)")

  fun of(response: HttpResponse): com.vidorax.media.model.AuthChallenge? {
    if (response.status != 401) return null
    val url = response.finalUrl.toHttpUrlOrNull() ?: return null
    return parse(response.headers("WWW-Authenticate"), url)
  }

  fun parse(values: List<String>, url: HttpUrl): com.vidorax.media.model.AuthChallenge? {
    for (value in values) {
      val basic = BASIC.find(value) ?: continue
      val params = value.substring(basic.range.last + 1).let { rest ->
        NEXT_CHALLENGE.find(rest)?.let { rest.substring(0, it.range.first) } ?: rest
      }
      val realm = REALM.find(params)?.let { match ->
        match.groupValues[1].takeIf { match.groups[1] != null }?.replace(QUOTED_PAIR, "$1") ?: match.groupValues[2]
      }
      val clean = realm?.filterNot { it.isISOControl() }?.trim()?.take(MAX_REALM)?.ifEmpty { null }
      return com.vidorax.media.model.AuthChallenge(DownloadCredentials.Origin.of(url).toString(), clean)
    }
    return null
  }
}
