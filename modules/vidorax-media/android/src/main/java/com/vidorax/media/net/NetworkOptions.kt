package com.vidorax.media.net

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
 * Held in memory only, as JavaScript last sent it with the download settings: custom header values may be secrets,
 * so they are never written to disk here (JavaScript keeps them in the secure store). A download resumed by the
 * system before the app's JavaScript runs uses today's behaviour until the settings are pushed again.
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

    /** What JavaScript sent with `setDownloadSettings`, made current. */
    fun applyFromJs(userAgent: String?, headers: Map<String, String>?, connectTimeoutSeconds: Int?, readTimeoutSeconds: Int?) {
      apply(fromJs(userAgent, headers, connectTimeoutSeconds, readTimeoutSeconds))
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
