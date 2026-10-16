package com.vidorax.media.net

import android.content.Context
import android.content.SharedPreferences
import java.util.concurrent.TimeUnit
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Download Settings → Advanced network: Custom User-Agent (#443), Custom Headers (#444) and the connection timeout
 * (#349), applied by [NetworkOptionsInterceptor] to every request of the download client.
 *
 * [DEFAULT] — nothing set — is exactly today's behaviour: the interceptor passes every request through untouched and
 * the client's own timeouts (20 s to connect, 30 s without data) apply. Nothing here can weaken the client: TLS is
 * never touched, the URL is never touched (so [HttpClient]'s public-address check and redirect checks still decide
 * every hop), and a header name that would change what the request is (Cookie, Authorization, Host, Range, …) is
 * refused before it gets here and again below.
 *
 * The User-Agent and the timeouts are also saved (SharedPreferences `vidorax_network_options`) and restored when the
 * process starts ([restore], from MediaServices), so a download the system resumes after a reboot — before any
 * JavaScript runs — uses the same values. Custom headers are held in memory only: their values may be secrets, so
 * they are never written to disk here (JavaScript keeps them in the secure store); a download resumed before the app
 * opens goes without them until JavaScript pushes the settings again.
 */
internal data class NetworkOptions(
  val userAgent: String? = null,
  val headers: List<Pair<String, String>> = emptyList(),
  val connectTimeoutSeconds: Int? = null,
  val readTimeoutSeconds: Int? = null,
) {
  val isDefault: Boolean
    get() = userAgent == null && headers.isEmpty() && connectTimeoutSeconds == null && readTimeoutSeconds == null

  companion object {
    val DEFAULT = NetworkOptions()

    const val MAX_USER_AGENT_LENGTH = 256
    const val MAX_HEADERS = 10
    const val MAX_HEADER_NAME_LENGTH = 64
    const val MAX_HEADER_VALUE_LENGTH = 512
    const val MIN_TIMEOUT_SECONDS = 5
    const val MAX_TIMEOUT_SECONDS = 300

    /** Names that would change what the request is, who it is from, or how its bytes are counted. */
    private val REFUSED_NAMES = setOf(
      "cookie", "cookie2", "authorization", "host", "content-length", "range", "if-range", "connection",
      "transfer-encoding", "te", "upgrade", "trailer", "keep-alive", "expect", "accept-encoding", "user-agent",
    )
    private val REFUSED_PREFIXES = listOf("proxy-", "sec-", "x-vidorax-")
    private val TOKEN = Regex("^[!#\$%&'*+.^_`|~0-9A-Za-z-]+\$")

    @Volatile
    var current: NetworkOptions = DEFAULT
      private set

    fun apply(options: NetworkOptions) {
      current = options
    }

    private const val PREFS = "vidorax_network_options"
    private const val KEY_USER_AGENT = "userAgent"
    private const val KEY_CONNECT_TIMEOUT = "connectTimeoutSeconds"
    private const val KEY_READ_TIMEOUT = "readTimeoutSeconds"

    /** Set once JavaScript pushed options in this process: they always win over what was saved. */
    @Volatile
    private var pushedFromJs = false

    /** The part of [options] that is saved: the User-Agent and the timeouts — never the headers. */
    fun persistedPart(options: NetworkOptions): NetworkOptions = NetworkOptions(
      userAgent = options.userAgent,
      connectTimeoutSeconds = options.connectTimeoutSeconds,
      readTimeoutSeconds = options.readTimeoutSeconds,
    )

    /** What was saved, validated again like anything JavaScript sends. Nothing saved is today's behaviour. */
    fun load(prefs: SharedPreferences): NetworkOptions = fromJs(
      userAgent = prefs.getString(KEY_USER_AGENT, null),
      headers = null,
      connectTimeoutSeconds = prefs.getInt(KEY_CONNECT_TIMEOUT, 0).takeIf { it > 0 },
      readTimeoutSeconds = prefs.getInt(KEY_READ_TIMEOUT, 0).takeIf { it > 0 },
    )

    /** Saves the User-Agent and timeouts of [options]; a value not set removes its key. Headers are not written. */
    fun save(prefs: SharedPreferences, options: NetworkOptions) {
      val editor = prefs.edit()
      val agent = options.userAgent
      if (agent != null) editor.putString(KEY_USER_AGENT, agent) else editor.remove(KEY_USER_AGENT)
      val connect = options.connectTimeoutSeconds
      if (connect != null) editor.putInt(KEY_CONNECT_TIMEOUT, connect) else editor.remove(KEY_CONNECT_TIMEOUT)
      val read = options.readTimeoutSeconds
      if (read != null) editor.putInt(KEY_READ_TIMEOUT, read) else editor.remove(KEY_READ_TIMEOUT)
      editor.apply()
    }

    fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * At process start: the saved User-Agent and timeouts become current, so downloads resumed before JavaScript runs
     * use them. Does nothing once JavaScript pushed options in this process. Never throws.
     */
    @Synchronized
    fun restore(context: Context) {
      if (pushedFromJs) return
      current = runCatching { load(prefs(context)) }.getOrDefault(DEFAULT)
    }

    @Synchronized
    internal fun resetForTests() {
      current = DEFAULT
      pushedFromJs = false
    }

    /** True for a header name the user may set. */
    fun isAllowedHeaderName(name: String): Boolean {
      if (name.isEmpty() || name.length > MAX_HEADER_NAME_LENGTH || !TOKEN.matches(name)) return false
      val lower = name.lowercase()
      return lower !in REFUSED_NAMES && REFUSED_PREFIXES.none { lower.startsWith(it) }
    }

    /** Visible ASCII, spaces and tabs only (what HTTP/1.1 and OkHttp accept): never a line break. */
    fun isAllowedValue(value: String, maxLength: Int): Boolean =
      value.isNotEmpty() && value.length <= maxLength && value.all { it == '\t' || it in ' '..'~' }

    /**
     * The options from the download settings JavaScript sent. Anything not sent — or not valid — is today's
     * behaviour; JavaScript validates first, this is the second check.
     */
    fun fromJs(
      userAgent: String?,
      headers: Map<String, String>?,
      connectTimeoutSeconds: Int?,
      readTimeoutSeconds: Int?,
    ): NetworkOptions {
      val agent = userAgent?.trim()?.takeIf { isAllowedValue(it, MAX_USER_AGENT_LENGTH) }
      val seen = HashSet<String>()
      val accepted = headers.orEmpty().entries
        .asSequence()
        .map { (name, value) -> name.trim() to value.trim() }
        .filter { (name, value) -> isAllowedHeaderName(name) && isAllowedValue(value, MAX_HEADER_VALUE_LENGTH) }
        .filter { (name, _) -> seen.add(name.lowercase()) }
        .take(MAX_HEADERS)
        .toList()
      return NetworkOptions(
        userAgent = agent,
        headers = accepted,
        connectTimeoutSeconds = connectTimeoutSeconds?.coerceIn(MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS),
        readTimeoutSeconds = readTimeoutSeconds?.coerceIn(MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS),
      )
    }

    /**
     * What JavaScript sent with `setDownloadSettings`, made current. The User-Agent and timeouts are saved too — only
     * when they changed, so a push that changes nothing writes nothing; the headers never are.
     */
    @Synchronized
    fun applyFromJs(
      context: Context,
      userAgent: String?,
      headers: Map<String, String>?,
      connectTimeoutSeconds: Int?,
      readTimeoutSeconds: Int?,
    ) {
      val options = fromJs(userAgent, headers, connectTimeoutSeconds, readTimeoutSeconds)
      pushedFromJs = true
      apply(options)
      runCatching {
        val prefs = prefs(context)
        val next = persistedPart(options)
        if (load(prefs) != next) save(prefs, next)
      }
    }
  }
}

/**
 * Applies [NetworkOptions] to each request, before it reaches the network layer (so [SessionCookieInterceptor] and
 * the redirect handling in [HttpClient] still see — and decide — every hop). With the default options the request
 * and the chain are passed on unchanged. A custom header is only added when the request does not already carry that
 * header: the Referer, Origin and headers of the page the video came from always win.
 */
internal class NetworkOptionsInterceptor(
  private val options: () -> NetworkOptions = { NetworkOptions.current },
) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val current = options()
    if (current.isDefault) return chain.proceed(chain.request())
    val request = chain.request()
    val builder = request.newBuilder()
    current.userAgent?.let { builder.header("User-Agent", it) }
    for ((name, value) in current.headers) {
      if (request.header(name) == null) builder.header(name, value)
    }
    var next = chain
    current.connectTimeoutSeconds?.let { next = next.withConnectTimeout(it, TimeUnit.SECONDS) }
    current.readTimeoutSeconds?.let { next = next.withReadTimeout(it, TimeUnit.SECONDS) }
    return next.proceed(builder.build())
  }
}
