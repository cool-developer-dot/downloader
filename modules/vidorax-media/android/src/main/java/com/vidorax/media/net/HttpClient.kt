package com.vidorax.media.net

import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.RequestContext
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okio.BufferedSource

/** A single HTTP fetch. Bytes are never buffered whole; callers stream from [HttpResponse.source]. */
internal data class MediaRequest(
  val url: String,
  val context: RequestContext,
  /** Inclusive byte offset for a `Range: bytes=<start>-` request, or null for a plain GET. */
  val rangeStart: Long? = null,
  /** Validator (ETag, else Last-Modified) sent as `If-Range` so a resume only continues an unchanged resource. */
  val ifRange: String? = null,
  /** Inclusive last byte for a bounded `Range: bytes=<start>-<end>` (an HLS `EXT-X-BYTERANGE` sub-range). */
  val rangeEnd: Long? = null,
)

/** A completed HTTP exchange. Any status is returned; only I/O failures throw [MediaNetworkException]. */
internal class HttpResponse(
  private val response: Response,
  private val call: Call,
  /** Redirect hops followed to reach this response. */
  val redirects: Int = 0,
) : Closeable {
  val status: Int get() = response.code

  /** URL after redirects; signed-CDN redirects mean this can differ from the requested URL. */
  val finalUrl: String get() = response.request.url.toString()

  val contentType: String? get() = response.header("Content-Type")?.substringBefore(';')?.trim()?.ifBlank { null }

  /** Value of the `Content-Length` header when present and parseable; the body length of THIS response. */
  val contentLength: Long? get() = response.header("Content-Length")?.toLongOrNull()

  val contentRange: ContentRange? get() = ContentRange.parse(response.header("Content-Range"))

  /** A 206, or `Accept-Ranges: bytes`, proves the server honours byte ranges for resume. */
  val supportsRanges: Boolean
    get() = status == 206 || response.header("Accept-Ranges")?.equals("bytes", ignoreCase = true) == true

  /**
   * The validator to bind a resume to: a strong ETag, else Last-Modified. A weak ETag (`W/"…"`) is never used —
   * `If-Range` must not carry one (RFC 9110 §13.1.5), and a server would then answer every resume with the whole file.
   */
  val validator: String?
    get() {
      val etag = response.header("ETag")?.trim()?.ifBlank { null }
      if (etag != null && !etag.startsWith("W/")) return etag
      return response.header("Last-Modified")?.trim()?.ifBlank { null }
    }

  fun header(name: String): String? = response.header(name)

  fun source(): BufferedSource = (response.body ?: error("no body")).source()

  fun byteStream(): InputStream = (response.body ?: error("no body")).byteStream()

  /**
   * Reads up to [maxBytes] of the body into memory for sniffing. Bounded on purpose: probing must never pull a
   * whole media file into the heap. The caller still owns [close]; headers stay readable afterwards.
   */
  fun readPrefix(maxBytes: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    byteStream().let { input ->
      var total = 0
      while (total < maxBytes) {
        val read = input.read(buffer, 0, minOf(buffer.size, maxBytes - total))
        if (read < 0) break
        out.write(buffer, 0, read)
        total += read
      }
    }
    return out.toByteArray()
  }

  /** The whole body when it is at most [maxBytes] long (a playlist, a key-less init segment); null when larger. */
  fun readBounded(maxBytes: Int): ByteArray? {
    val bytes = readPrefix(maxBytes + 1)
    return if (bytes.size > maxBytes) null else bytes
  }

  override fun close() {
    // Aborts the socket if the body was not fully read (e.g. a cancelled or paused download).
    if (!call.isCanceled()) call.cancel()
    response.close()
  }
}

/**
 * The module's one HTTP door. Applies the observing frame's request context, forces identity encoding so byte
 * counts and ranges are exact, and turns transport failures into [MediaNetworkException] (transient) while
 * leaving HTTP status codes for the caller to interpret. Never logs headers or full URLs — see [Redact].
 *
 * Redirects are followed here rather than inside OkHttp, so every hop is checked against [policy] *before* a
 * connection to it is opened: a public link must not be able to bounce the downloader into the user's network.
 * A redirect loop is a permanent refusal, not a network error to retry.
 */
internal class HttpClient(client: OkHttpClient, private val policy: UrlPolicy = UrlPolicy.PUBLIC_ONLY) {
  private val client: OkHttpClient = client.newBuilder().followRedirects(false).followSslRedirects(false).build()

  /** Whether [url] is one this client would send a request to. */
  fun allows(url: String): Boolean = url.toHttpUrlOrNull()?.let { policy.allows(it) } ?: false

  fun execute(request: MediaRequest): HttpResponse {
    var url = request.url.toHttpUrlOrNull()
      ?: throw MediaRefusedException(ProbeFailure.UNSUPPORTED_FORMAT, "not an http(s) URL")
    var hops = 0
    while (true) {
      if (!policy.allows(url)) {
        throw MediaRefusedException(ProbeFailure.POLICY_BLOCKED, "refused non-public address ${Redact.url(url.toString())}")
      }
      val call = client.newCall(build(request, url))
      val response = try {
        call.execute()
      } catch (e: IOException) {
        throw MediaNetworkException("request to ${Redact.url(url.toString())} failed", e)
      }
      val next = redirectTarget(response)
      if (next == null) return HttpResponse(response, call, hops)
      response.close()
      hops += 1
      if (hops > MAX_REDIRECTS) {
        throw MediaRefusedException(ProbeFailure.NOT_MEDIA, "redirect loop at ${Redact.url(url.toString())}")
      }
      url = next
    }
  }

  private fun redirectTarget(response: Response): HttpUrl? {
    if (response.code !in REDIRECT_CODES) return null
    val location = response.header("Location") ?: return null
    return response.request.url.resolve(location)
  }

  private fun build(request: MediaRequest, url: HttpUrl): Request {
    val builder = Request.Builder().url(url).get()
    val ctx = request.context
    ctx.userAgent?.let { builder.header("User-Agent", it) }
    ctx.referer?.let { builder.header("Referer", it) }
    ctx.origin?.let { builder.header("Origin", it) }
    // Defence in depth: the bridge already strips Cookie from context headers; never let one back in here, and
    // never carry an Authorization value into a header map we might otherwise surface in diagnostics.
    for ((name, value) in ctx.headers) {
      if (name.equals("Cookie", ignoreCase = true) || name.equals("Authorization", ignoreCase = true)) continue
      builder.header(name, value)
    }
    // Session-bound media only answers to the session it was issued to. The cookie itself is never carried in
    // the request context or the store; the interceptor reads it from the WebView jar per hop, at send time.
    if (ctx.useCookies) {
      builder.header(SessionCookieInterceptor.MARKER, "1")
    }
    // Identity so Content-Length/Content-Range reflect real bytes and resume math stays correct.
    builder.header("Accept-Encoding", "identity")
    request.rangeStart?.let { start ->
      val end = request.rangeEnd
      builder.header("Range", if (end != null) "bytes=$start-$end" else "bytes=$start-")
      request.ifRange?.let { builder.header("If-Range", it) }
    }
    return builder.build()
  }

  companion object {
    /** What browsers allow; a longer chain is a loop or a trap. */
    const val MAX_REDIRECTS = 20

    private val REDIRECT_CODES = setOf(301, 302, 303, 307, 308)

    fun create(
      cookies: CookieSource = WebViewCookieSource,
      urlPolicy: UrlPolicy = UrlPolicy.PUBLIC_ONLY,
    ): HttpClient = HttpClient(
      OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        // No overall call timeout: media files are large and legitimately slow.
        .callTimeout(0, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        // Cookies a server sets during the download itself (a signed-cookie CDN, a token cookie on the playlist
        // response) are replayed to that server like a browser would — held in memory only, never persisted.
        .cookieJar(ResponseCookieJar())
        // Network-level: every hop gets the WebView session cookies for its own host.
        .addNetworkInterceptor(SessionCookieInterceptor(cookies))
        .build(),
      urlPolicy,
    )
  }
}

/** Transport-level failure (DNS, connect, reset, timeout, truncated stream): transient and safe to retry/resume. */
internal class MediaNetworkException(message: String, cause: Throwable? = null) : IOException(message, cause)

/** A proven HTTP status failure. The message is already redacted; never attach headers to it. */
internal class MediaHttpException(val statusCode: Int, redactedUrl: String) :
  IOException("HTTP $statusCode for $redactedUrl") {
  /** 5xx, 408 and 429: the server is overloaded or restarting — worth waiting out, unlike 403/404. */
  val isTransient: Boolean get() = statusCode >= 500 || statusCode == 408 || statusCode == 429

  companion object {
    fun of(statusCode: Int, url: String) = MediaHttpException(statusCode, Redact.url(url))
  }
}
