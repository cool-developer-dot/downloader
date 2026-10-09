package com.vidorax.media.analyze

import android.webkit.CookieManager
import com.vidorax.media.net.CookieSource
import com.vidorax.media.net.SessionCookieInterceptor
import com.vidorax.media.net.UrlPolicy
import com.vidorax.media.net.WebViewCookieSource
import com.vidorax.media.plan.Probe
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.nio.charset.Charset
import java.util.concurrent.TimeUnit
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * A pasted or shared link, fetched the way the browser tab would navigate to it, so the page can be read for its
 * video before (and without) the WebView playing anything. Nothing on the page runs: this only returns bytes.
 *
 * - Redirects are followed here, at most [MAX_REDIRECTS] hops; every hop must pass the download [UrlPolicy]
 *   (public http(s) hosts only) and the YouTube policy before a connection to it is opened, and a URL seen twice is
 *   a loop.
 * - One deadline spans the whole exchange (every hop, and reading the body); the body is read up to a byte bound.
 * - Media (a pasted file or manifest) is recognised from its Content-Type and first bytes and never read further.
 * - Cookies: the browsing session's cookies for each hop when asked ([PageFetchRequest.useSessionCookies]), plus the
 *   ones earlier hops set. With [PageFetchRequest.commitCookies], what the servers set is stored in the WebView's
 *   jar afterwards — exactly what the tab's own navigation would have stored — so a link the page signs for its
 *   session (TikTok's `tt_chain_token`) answers the same session when the page, the engine and the WebView use it.
 *   Only after a complete fetch that finished inside its deadline; values never reach a log or JavaScript.
 */
internal class PageFetcher(
  baseClient: OkHttpClient,
  private val policy: UrlPolicy = UrlPolicy.PUBLIC_ONLY,
  private val cookies: CookieSource = WebViewCookieSource,
  private val sink: CookieSink = WebViewCookieSink,
  private val defaultUserAgent: () -> String? = { null },
  private val acceptLanguage: () -> String = { DEFAULT_ACCEPT_LANGUAGE },
  private val clock: () -> Long = System::currentTimeMillis,
) {
  // Session and response cookies are attached by hand per hop; OkHttp keeps nothing between fetches.
  private val client: OkHttpClient = baseClient.newBuilder()
    .followRedirects(false)
    .followSslRedirects(false)
    .cookieJar(CookieJar.NO_COOKIES)
    .build()

  fun fetch(request: PageFetchRequest): PageFetchResult {
    val started = clock()
    val deadline = started + request.timeoutMs.coerceIn(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
    val maxBytes = request.maxBytes.coerceIn(MIN_BODY_BYTES, MAX_BODY_BYTES)
    var url = request.url.trim().toHttpUrlOrNull()
      ?: return failure(PageFetchFailure.INVALID_URL, null, 0, started)
    val jar = FetchCookies()
    val commits = ArrayList<Pair<String, String>>()
    val visited = HashSet<String>()
    var hops = 0

    while (true) {
      if (!policy.allows(url)) return failure(PageFetchFailure.UNSAFE_URL, null, hops, started)
      if (Probe.isPolicyBlockedHost(url.toString())) return failure(PageFetchFailure.POLICY_BLOCKED, null, hops, started)
      if (!visited.add(url.toString())) return failure(PageFetchFailure.REDIRECT_LOOP, null, hops, started)
      val remaining = deadline - clock()
      if (remaining <= 0) return failure(PageFetchFailure.TIMEOUT, null, hops, started)

      val call = client.newCall(build(request, url, jar))
      call.timeout().timeout(remaining, TimeUnit.MILLISECONDS)
      val response = try {
        call.execute()
      } catch (e: InterruptedIOException) {
        return failure(PageFetchFailure.TIMEOUT, null, hops, started)
      } catch (e: IOException) {
        return failure(PageFetchFailure.NETWORK, null, hops, started)
      }

      jar.save(url, response)
      if (request.commitCookies) {
        response.headers("Set-Cookie").forEach { commits += url.toString() to it }
      }

      val next = redirectTarget(response)
      if (next != null) {
        response.close()
        hops += 1
        if (hops > MAX_REDIRECTS) return failure(PageFetchFailure.TOO_MANY_REDIRECTS, null, hops, started)
        url = next
        continue
      }
      if (response.code in REDIRECT_CODES) {
        // A redirect without a usable Location is an answer the browser would show as-is.
        response.close()
        return failure(PageFetchFailure.HTTP_ERROR, response.code, hops, started)
      }

      val result = try {
        response.use { read(it, url, maxBytes, hops, started) }
      } catch (e: InterruptedIOException) {
        failure(PageFetchFailure.TIMEOUT, null, hops, started)
      } catch (e: IOException) {
        failure(PageFetchFailure.NETWORK, null, hops, started)
      }
      if (result !is PageFetchResult.Failure && commits.isNotEmpty() && clock() < deadline) {
        // The caller loads the page in the WebView once this returns (or once the deadline passed): committing only
        // inside the deadline means the tab's own request never races a cookie written behind its back.
        commitCookies(commits)
      }
      return result
    }
  }

  private fun read(response: Response, url: HttpUrl, maxBytes: Int, hops: Int, started: Long): PageFetchResult {
    val status = response.code
    if (status >= 400) return failure(PageFetchFailure.HTTP_ERROR, status, hops, started)
    val body = response.body ?: return failure(PageFetchFailure.UNSUPPORTED_CONTENT, status, hops, started)
    val contentType = response.header("Content-Type")?.substringBefore(';')?.trim()?.lowercase()?.ifBlank { null }
    val input = body.byteStream()
    val prefix = readUpTo(input, SNIFF_BYTES)

    return when (ContentClassifier.classify(contentType, prefix)) {
      ContentClass.MEDIA -> PageFetchResult.Media(
        finalUrl = url.toString(),
        status = status,
        contentType = contentType,
        contentLength = response.header("Content-Length")?.toLongOrNull()?.takeIf { it >= 0 },
        redirects = hops,
        elapsedMs = clock() - started,
      )
      ContentClass.DOCUMENT -> {
        val rest = readUpTo(input, maxBytes + 1 - prefix.size)
        val all = if (rest.isEmpty()) prefix else prefix + rest
        val truncated = all.size > maxBytes
        val bytes = if (truncated) all.copyOf(maxBytes) else all
        PageFetchResult.Document(
          finalUrl = url.toString(),
          status = status,
          contentType = contentType,
          body = String(bytes, charsetOf(response, bytes)),
          truncated = truncated,
          redirects = hops,
          elapsedMs = clock() - started,
        )
      }
      ContentClass.OTHER -> failure(PageFetchFailure.UNSUPPORTED_CONTENT, status, hops, started)
    }
  }

  private fun build(request: PageFetchRequest, url: HttpUrl, jar: FetchCookies): Request {
    val builder = Request.Builder().url(url).get()
    (request.userAgent?.takeIf { it.isNotBlank() } ?: defaultUserAgent())?.let { builder.header("User-Agent", it) }
    // A top-level navigation, as the tab would send it. No Accept-Encoding: OkHttp asks for gzip and inflates it.
    builder.header("Accept", NAVIGATION_ACCEPT)
    builder.header("Accept-Language", acceptLanguage())
    builder.header("Upgrade-Insecure-Requests", "1")
    builder.header("Sec-Fetch-Dest", "document")
    builder.header("Sec-Fetch-Mode", "navigate")
    builder.header("Sec-Fetch-Site", "none")
    builder.header("Sec-Fetch-User", "?1")
    val session = if (request.useSessionCookies) cookies.cookiesFor(url.toString()) else null
    SessionCookieInterceptor.mergeCookieHeaders(session, jar.header(url))?.let { builder.header("Cookie", it) }
    return builder.build()
  }

  private fun redirectTarget(response: Response): HttpUrl? {
    if (response.code !in REDIRECT_CODES) return null
    val location = response.header("Location") ?: return null
    return response.request.url.resolve(location)
  }

  private fun commitCookies(commits: List<Pair<String, String>>) {
    runCatching {
      for ((url, header) in commits.takeLast(MAX_COMMITTED_COOKIES)) sink.store(url, header)
      sink.flush()
    }
  }

  private fun failure(code: PageFetchFailure, status: Int?, hops: Int, started: Long) =
    PageFetchResult.Failure(code, status, hops, clock() - started)

  /** Cookies the servers of this one fetch set, replayed to later hops of it (domain/path rules via OkHttp). */
  private class FetchCookies {
    private val cookies = LinkedHashMap<String, Cookie>()

    fun save(url: HttpUrl, response: Response) {
      for (cookie in Cookie.parseAll(url, response.headers)) {
        cookies["${cookie.domain}|${cookie.path}|${cookie.name}"] = cookie
      }
    }

    fun header(url: HttpUrl): String? =
      cookies.values.filter { it.matches(url) }.joinToString("; ") { "${it.name}=${it.value}" }.ifBlank { null }
  }

  companion object {
    /** What browsers allow before giving up; a longer chain is a loop or a trap. */
    const val MAX_REDIRECTS = 10
    const val MIN_TIMEOUT_MS = 1_000L
    const val MAX_TIMEOUT_MS = 20_000L
    const val MIN_BODY_BYTES = 16 * 1024
    const val MAX_BODY_BYTES = 4 * 1024 * 1024
    private const val SNIFF_BYTES = 4 * 1024
    private const val MAX_COMMITTED_COOKIES = 64
    private val REDIRECT_CODES = setOf(301, 302, 303, 307, 308)
    private const val NAVIGATION_ACCEPT =
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    const val DEFAULT_ACCEPT_LANGUAGE = "en-US,en;q=0.9"

    fun create(defaultUserAgent: () -> String?, acceptLanguage: () -> String): PageFetcher = PageFetcher(
      OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build(),
      defaultUserAgent = defaultUserAgent,
      acceptLanguage = acceptLanguage,
    )

    private fun readUpTo(input: InputStream, limit: Int): ByteArray {
      if (limit <= 0) return ByteArray(0)
      val out = java.io.ByteArrayOutputStream(minOf(limit, 64 * 1024))
      val buffer = ByteArray(16 * 1024)
      var total = 0
      while (total < limit) {
        val read = input.read(buffer, 0, minOf(buffer.size, limit - total))
        if (read < 0) break
        out.write(buffer, 0, read)
        total += read
      }
      return out.toByteArray()
    }

    private val META_CHARSET = Regex("""<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9_.:-]{2,40})""", RegexOption.IGNORE_CASE)

    /** The declared charset (header, else an early `<meta charset>`), else UTF-8. */
    fun charsetOf(response: Response, bytes: ByteArray): Charset {
      response.body?.contentType()?.charset()?.let { return it }
      val head = String(bytes, 0, minOf(bytes.size, 2048), Charsets.ISO_8859_1)
      val name = META_CHARSET.find(head)?.groupValues?.get(1) ?: return Charsets.UTF_8
      return runCatching { Charset.forName(name) }.getOrDefault(Charsets.UTF_8)
    }
  }
}

internal data class PageFetchRequest(
  val url: String,
  /** Null: the stock WebView User-Agent (the tab in mobile mode). */
  val userAgent: String? = null,
  val useSessionCookies: Boolean = true,
  val commitCookies: Boolean = false,
  val timeoutMs: Long = 8_000L,
  val maxBytes: Int = 3 * 1024 * 1024,
)

internal enum class PageFetchFailure(val wire: String) {
  INVALID_URL("INVALID_URL"),
  UNSAFE_URL("UNSAFE_URL"),
  POLICY_BLOCKED("POLICY_BLOCKED"),
  REDIRECT_LOOP("REDIRECT_LOOP"),
  TOO_MANY_REDIRECTS("TOO_MANY_REDIRECTS"),
  TIMEOUT("TIMEOUT"),
  NETWORK("NETWORK"),
  HTTP_ERROR("HTTP_ERROR"),
  UNSUPPORTED_CONTENT("UNSUPPORTED_CONTENT"),
}

internal sealed interface PageFetchResult {
  val redirects: Int
  val elapsedMs: Long

  /** A page (HTML, or JSON/XML text) to read for its video. [truncated]: the byte bound cut it. */
  data class Document(
    val finalUrl: String,
    val status: Int,
    val contentType: String?,
    val body: String,
    val truncated: Boolean,
    override val redirects: Int,
    override val elapsedMs: Long,
  ) : PageFetchResult

  /** The link itself is a media file or a manifest; its body was not read past the first bytes. */
  data class Media(
    val finalUrl: String,
    val status: Int,
    val contentType: String?,
    val contentLength: Long?,
    override val redirects: Int,
    override val elapsedMs: Long,
  ) : PageFetchResult

  data class Failure(
    val code: PageFetchFailure,
    val status: Int?,
    override val redirects: Int,
    override val elapsedMs: Long,
  ) : PageFetchResult
}

/** Where a fetch's `Set-Cookie` headers are committed. Behind an interface so the policy is testable without Android. */
internal interface CookieSink {
  fun store(url: String, setCookieHeader: String)

  fun flush() {}
}

/** The WebView's own jar — the browsing session the tab uses. */
internal object WebViewCookieSink : CookieSink {
  override fun store(url: String, setCookieHeader: String) {
    CookieManager.getInstance().setCookie(url, setCookieHeader)
  }

  override fun flush() {
    CookieManager.getInstance().flush()
  }
}

internal enum class ContentClass { DOCUMENT, MEDIA, OTHER }

/** What a response is, from its Content-Type and first bytes. Magic bytes win over a generic or missing type. */
internal object ContentClassifier {
  private val DOCUMENT_TYPES = setOf(
    "text/html", "application/xhtml+xml", "application/json", "application/ld+json", "text/json", "text/plain",
    "application/xml", "text/xml",
  )
  private val MANIFEST_TYPES = setOf(
    "application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl",
    "application/dash+xml", "video/vnd.mpeg.dash.mpd",
  )
  private val GENERIC_TYPES = setOf("application/octet-stream", "binary/octet-stream", "application/binary")

  fun classify(contentType: String?, prefix: ByteArray): ContentClass {
    val type = contentType?.lowercase()
    if (isMediaBytes(prefix)) return ContentClass.MEDIA
    if (type != null && (type in MANIFEST_TYPES || type.startsWith("video/") || type.startsWith("audio/") ||
        type == "application/mp4")
    ) {
      return ContentClass.MEDIA
    }
    if (type != null && type in DOCUMENT_TYPES) return ContentClass.DOCUMENT
    if (type == null || type in GENERIC_TYPES) {
      return if (looksLikeHtml(prefix)) ContentClass.DOCUMENT else ContentClass.OTHER
    }
    return ContentClass.OTHER
  }

  /** A playlist, an MPD, or a container's signature (ISO-BMFF, EBML, AVI, ASF, MPEG-TS, FLV). */
  fun isMediaBytes(prefix: ByteArray): Boolean {
    val text = String(prefix, 0, minOf(prefix.size, 512), Charsets.ISO_8859_1).trimStart('﻿', ' ', '\t', '\r', '\n')
    if (text.startsWith("#EXTM3U")) return true
    if (text.startsWith("<?xml") || text.startsWith("<MPD")) {
      return text.contains("<MPD") && text.contains("urn:mpeg:dash:schema:mpd", ignoreCase = true)
    }
    if (prefix.size >= 8 && ascii(prefix, 4, 4) in ISO_BOXES) return true
    if (prefix.size >= 4 && prefix[0] == 0x1A.toByte() && prefix[1] == 0x45.toByte() && prefix[2] == 0xDF.toByte() &&
      prefix[3] == 0xA3.toByte()
    ) {
      return true
    }
    if (prefix.size >= 12 && ascii(prefix, 0, 4) == "RIFF" && ascii(prefix, 8, 4) == "AVI ") return true
    if (prefix.size >= 4 && prefix[0] == 0x30.toByte() && prefix[1] == 0x26.toByte() && prefix[2] == 0xB2.toByte() &&
      prefix[3] == 0x75.toByte()
    ) {
      return true
    }
    if (prefix.size >= 3 && ascii(prefix, 0, 3) == "FLV") return true
    // MPEG-TS: sync bytes at 0 and 188.
    return prefix.size > 188 && prefix[0] == 0x47.toByte() && prefix[188] == 0x47.toByte()
  }

  private val ISO_BOXES = setOf("ftyp", "styp", "moov", "moof")

  private fun looksLikeHtml(prefix: ByteArray): Boolean {
    val head = String(prefix, 0, minOf(prefix.size, 1024), Charsets.ISO_8859_1).trimStart('﻿', ' ', '\t', '\r', '\n')
      .lowercase()
    return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head") ||
      (head.startsWith("<") && head.contains("<body"))
  }

  private fun ascii(bytes: ByteArray, offset: Int, length: Int): String =
    if (bytes.size < offset + length) "" else String(bytes, offset, length, Charsets.ISO_8859_1)
}
