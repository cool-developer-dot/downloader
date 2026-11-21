package com.vidorax.media.remote

import com.vidorax.media.InvalidStateException
import com.vidorax.media.NotFoundException
import expo.modules.kotlin.exception.CodedException
import org.json.JSONArray
import org.json.JSONObject

/**
 * Which `Host` and `Origin` headers the server answers. Only the address it bound on the Wi-Fi network (with its
 * port) and loopback names (USB `adb forward` maps any host port) are accepted, so a DNS-rebinding page — whose
 * requests carry its own host name — is turned away before anything else runs. A request with an `Origin` must come
 * from the Web UI itself or from a browser extension; other web pages are refused even for simple requests.
 */
class RemoteHostPolicy(
  private val bindAddress: String,
  private val port: Int,
  /** The loopback listener only: `adb forward` arrives as localhost on whatever port the computer chose. */
  private val acceptLoopbackNames: Boolean = false,
) {
  enum class OriginKind { NONE, SAME, EXTENSION, FOREIGN }

  fun allowsHost(host: String?): Boolean {
    val value = host?.trim()?.lowercase() ?: return false
    if (value == "$bindAddress:$port") return true
    return acceptLoopbackNames && LOOPBACK_HOST.matches(value)
  }

  fun originKind(origin: String?, host: String): OriginKind {
    val value = origin?.trim() ?: return OriginKind.NONE
    if (value.equals("http://$host", ignoreCase = true)) return OriginKind.SAME
    val scheme = value.substringBefore("://", "").lowercase()
    if (scheme in EXTENSION_SCHEMES && EXTENSION_ORIGIN.matches(value)) return OriginKind.EXTENSION
    return OriginKind.FOREIGN
  }

  private companion object {
    val LOOPBACK_HOST = Regex("^(127\\.0\\.0\\.1|localhost|\\[::1]):\\d{1,5}$")
    val EXTENSION_SCHEMES = setOf("chrome-extension", "moz-extension", "safari-web-extension")
    val EXTENSION_ORIGIN = Regex("^[a-z-]+://[A-Za-z0-9._-]{1,128}$")
  }
}

/**
 * P6 (#439 Web UI, #438 Remote, #501 CLI): every route of the phone's local server. The single-page Web UI is
 * static and open; every `/api/v1` call except `info` and `pair` needs `Authorization: Bearer <token>` from pairing.
 * Queue actions are the engine calls the app's own buttons make; a new link goes through the app's Batch Add path
 * ([RemoteLinkIntake]). Responses never carry a media URL, a token hash or a file path.
 */
class RemoteRouter(
  private val auth: RemoteAuth,
  private val queue: RemoteQueue,
  private val links: RemoteLinkIntake,
  private val sent: RemoteSentFiles,
  private val hosts: RemoteHostPolicy,
  private val assets: (String) -> ByteArray?,
  private val language: () -> String = { "en" },
  private val onRequest: () -> Unit = {},
) {
  suspend fun handle(request: RemoteRequest): RemoteResponse {
    val host = request.header("host")
    if (host == null || !hosts.allowsHost(host)) return error(421, "wrong_host", "Use the address shown on the phone.")
    val origin = request.header("origin")
    val originKind = hosts.originKind(origin, host)
    if (originKind == RemoteHostPolicy.OriginKind.FOREIGN) return error(403, "forbidden_origin", "Requests from other sites are refused.")
    onRequest()
    val cors = if (originKind == RemoteHostPolicy.OriginKind.EXTENSION && origin != null) corsHeaders(origin) else emptyMap()
    if (request.method == "OPTIONS") {
      if (cors.isEmpty()) return error(403, "forbidden_origin", "Preflight is for browser extensions only.")
      val preflight = buildMap {
        put("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        put("Access-Control-Allow-Headers", "Authorization, Content-Type")
        put("Access-Control-Max-Age", "600")
        if (request.header("access-control-request-private-network") == "true") {
          put("Access-Control-Allow-Private-Network", "true")
        }
      }
      return RemoteResponse.empty(204, cors + preflight + COMMON_HEADERS)
    }
    val response = try {
      route(request)
    } catch (e: NotFoundException) {
      error(404, "not_found", "No such download.")
    } catch (e: InvalidStateException) {
      error(409, "invalid_state", "That download can’t do this right now.")
    } catch (e: CodedException) {
      error(409, e.code.removePrefix("ERR_").lowercase(), "VidoraX couldn’t do this.")
    }
    return response.withHeaders(COMMON_HEADERS + cors + response.headers)
  }

  private suspend fun route(request: RemoteRequest): RemoteResponse {
    val path = request.path
    if (path.startsWith(API_PREFIX)) return api(request, path.removePrefix(API_PREFIX))
    if (path.startsWith("/files/")) return file(request)
    val asset = if (path == "/") "index.html" else path.removePrefix("/")
    val contentType = STATIC_ASSETS[asset] ?: return RemoteResponse.text(404, "Not found")
    if (request.method != "GET" && request.method != "HEAD") return methodNotAllowed()
    val bytes = assets(asset) ?: return RemoteResponse.text(404, "Not found")
    val extra = if (asset == "index.html") mapOf("Content-Security-Policy" to CSP) else emptyMap()
    return RemoteResponse(200, contentType, RemoteBody.Bytes(bytes), extra + mapOf("Cache-Control" to "no-cache"))
  }

  private suspend fun api(request: RemoteRequest, route: String): RemoteResponse {
    val method = request.method
    if (method == "POST" && !isJson(request.header("content-type"))) {
      return error(415, "json_required", "Send Content-Type: application/json.")
    }
    when (route) {
      "info" -> return if (method == "GET") info() else methodNotAllowed()
      "pair" -> return if (method == "POST") pair(request) else methodNotAllowed()
    }
    val client = auth.authenticate(bearer(request)) ?: return error(401, "unauthorized", "Pair with the PIN on the phone first.")
    val parts = route.split('/')
    return when {
      route == "unpair" -> if (method == "POST") {
        auth.forget(client.id)
        ok()
      } else methodNotAllowed()
      route == "downloads" -> when (method) {
        "GET" -> listDownloads(request)
        "POST" -> addLink(request)
        else -> methodNotAllowed()
      }
      parts.size == 2 && parts[0] == "links" -> if (method == "GET") linkStatus(parts[1]) else methodNotAllowed()
      parts.size == 3 && parts[0] == "downloads" -> if (method == "POST") downloadAction(parts[1], parts[2]) else methodNotAllowed()
      route == "queue/pause-all" -> if (method == "POST") {
        queue.pauseAll()
        ok()
      } else methodNotAllowed()
      route == "queue/resume-all" -> if (method == "POST") {
        queue.resumeAll()
        ok()
      } else methodNotAllowed()
      route == "sent" -> if (method == "GET") listSent() else methodNotAllowed()
      parts.size == 2 && parts[0] == "sent" -> if (method == "DELETE") {
        if (sent.remove(parts[1])) ok() else error(404, "not_found", "Not in the list.")
      } else methodNotAllowed()
      parts.size == 3 && parts[0] == "sent" && parts[2] == "ticket" -> if (method == "POST") {
        val href = sent.ticket(parts[1]) ?: return error(404, "no_file", "This item has no file on the phone.")
        RemoteResponse.json(200, JSONObject().put("href", href).toString())
      } else methodNotAllowed()
      else -> error(404, "not_found", "Unknown API route.")
    }
  }

  private fun info(): RemoteResponse = RemoteResponse.json(
    200,
    JSONObject().put("name", "VidoraX").put("api", API_VERSION).put("language", language()).toString(),
  )

  private fun pair(request: RemoteRequest): RemoteResponse {
    val body = jsonBody(request) ?: return badJson()
    val pin = body.optString("pin")
    if (!PIN_PATTERN.matches(pin)) return error(400, "invalid_pin", "The PIN is 6 digits.")
    return when (val result = auth.pair(pin, body.optString("name"))) {
      is RemoteAuth.PairResult.Paired -> RemoteResponse.json(
        200,
        JSONObject().put("token", result.token).put("clientId", result.client.id).put("name", result.client.name).toString(),
      )
      is RemoteAuth.PairResult.WrongPin -> RemoteResponse.json(
        401,
        JSONObject().put("error", "wrong_pin").put("message", "Wrong PIN.").put("attemptsLeft", result.attemptsLeft).toString(),
      )
      is RemoteAuth.PairResult.Locked -> {
        val seconds = (result.retryAfterMs + 999) / 1000
        RemoteResponse.json(
          429,
          JSONObject().put("error", "locked").put("message", "Too many wrong PINs. Wait and try again.")
            .put("retryAfterSeconds", seconds).toString(),
          mapOf("Retry-After" to seconds.toString()),
        )
      }
      RemoteAuth.PairResult.Closed -> error(403, "pairing_closed", "Ask the phone for a new PIN.")
    }
  }

  private suspend fun listDownloads(request: RemoteRequest): RemoteResponse {
    val downloads = queue.list()
    if (request.query["format"] == "tsv") {
      val text = buildString {
        append("ID\tSTATE\tPROGRESS\tTITLE\n")
        downloads.forEach { item ->
          val progress = item.fraction?.let { "${(it * 100).toInt()}%" } ?: "-"
          append(item.id).append('\t').append(item.state).append('\t').append(progress).append('\t')
            .append(item.title.replace('\t', ' ').replace('\n', ' ')).append('\n')
        }
      }
      return RemoteResponse.text(200, text, "text/tab-separated-values; charset=utf-8")
    }
    val array = JSONArray()
    downloads.forEach { array.put(it.toJson()) }
    return RemoteResponse.json(200, JSONObject().put("downloads", array).toString())
  }

  private fun addLink(request: RemoteRequest): RemoteResponse {
    val body = jsonBody(request) ?: return badJson()
    val url = LinkRules.acceptable(body.optString("url")) ?: return error(400, "invalid_url", "Send an http or https link.")
    val source = when (body.optString("source")) {
      "extension" -> LinkSource.EXTENSION
      "cli" -> LinkSource.CLI
      else -> LinkSource.WEB
    }
    val link = links.submit(url, source) ?: return error(503, "busy", "Too many links are waiting. Try again soon.")
    return RemoteResponse.json(202, link.toJson().toString())
  }

  private fun linkStatus(requestId: String): RemoteResponse {
    val link = links.get(requestId) ?: return error(404, "not_found", "Unknown request.")
    return RemoteResponse.json(200, link.toJson().toString())
  }

  private suspend fun downloadAction(id: String, action: String): RemoteResponse {
    if (id.isBlank() || id.length > 128) return error(404, "not_found", "No such download.")
    when (action) {
      RemoteDownload.ACTION_PAUSE -> queue.pause(id)
      RemoteDownload.ACTION_RESUME -> queue.resume(id)
      RemoteDownload.ACTION_RETRY -> queue.retry(id)
      RemoteDownload.ACTION_CANCEL -> queue.cancel(id)
      else -> return error(404, "not_found", "Unknown action.")
    }
    return ok()
  }

  private fun listSent(): RemoteResponse {
    val array = JSONArray()
    sent.list().forEach { item ->
      array.put(
        JSONObject()
          .put("id", item.id)
          .put("title", item.title)
          .put("url", item.url ?: JSONObject.NULL)
          .put("hasFile", item.libraryItemId != null)
          .put("sizeBytes", item.sizeBytes ?: JSONObject.NULL)
          .put("sentAt", item.sentAt),
      )
    }
    return RemoteResponse.json(200, JSONObject().put("items", array).toString())
  }

  private suspend fun file(request: RemoteRequest): RemoteResponse {
    if (request.method != "GET" && request.method != "HEAD") return methodNotAllowed()
    val ticket = request.path.removePrefix("/files/").substringBefore('/')
    if (!TICKET_PATTERN.matches(ticket)) return RemoteResponse.text(404, "Not found")
    val found = sent.openTicket(ticket) ?: return RemoteResponse.text(404, "This link has expired. Get the file again from the list.")
    val size = found.file.length()
    val headers = mapOf(
      "Content-Disposition" to contentDisposition(found.name),
      "Accept-Ranges" to "bytes",
    )
    val range = request.header("range")
    if (range == null) {
      return RemoteResponse(200, found.mimeType, RemoteBody.FileRange(found.file, 0, size), headers)
    }
    val parsed = parseRange(range, size)
      ?: return RemoteResponse.empty(416, headers + mapOf("Content-Range" to "bytes */$size"))
    return RemoteResponse(
      206,
      found.mimeType,
      RemoteBody.FileRange(found.file, parsed.first, parsed.last - parsed.first + 1),
      headers + mapOf("Content-Range" to "bytes ${parsed.first}-${parsed.last}/$size"),
    )
  }

  private fun corsHeaders(origin: String): Map<String, String> = mapOf(
    "Access-Control-Allow-Origin" to origin,
    "Vary" to "Origin",
  )

  private fun ok(): RemoteResponse = RemoteResponse.json(200, "{\"ok\":true}")

  private fun methodNotAllowed(): RemoteResponse = error(405, "method_not_allowed", "Method not allowed.")

  private fun badJson(): RemoteResponse = error(400, "bad_json", "The body must be a JSON object.")

  private fun jsonBody(request: RemoteRequest): JSONObject? {
    val bytes = request.body ?: return null
    if (bytes.size > MAX_BODY_BYTES) return null
    return runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull()
  }

  companion object {
    const val API_PREFIX = "/api/v1/"
    const val API_VERSION = 1
    const val MAX_BODY_BYTES = 16 * 1024

    private val PIN_PATTERN = Regex("^\\d{6}$")
    private val TICKET_PATTERN = Regex("^[0-9a-f]{48}$")

    /** The Web UI's files (assets/vidorax-remote/). */
    val STATIC_ASSETS = mapOf(
      "index.html" to "text/html; charset=utf-8",
      "app.mjs" to "text/javascript; charset=utf-8",
      "strings.mjs" to "text/javascript; charset=utf-8",
      "format.mjs" to "text/javascript; charset=utf-8",
      "style.css" to "text/css; charset=utf-8",
      "icon.svg" to "image/svg+xml",
    )

    const val CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

    val COMMON_HEADERS = mapOf(
      "X-Content-Type-Options" to "nosniff",
      "Referrer-Policy" to "no-referrer",
      "X-Frame-Options" to "DENY",
      "Cache-Control" to "no-store",
    )

    fun error(status: Int, code: String, message: String): RemoteResponse =
      RemoteResponse.json(status, JSONObject().put("error", code).put("message", message).toString())

    fun bearer(request: RemoteRequest): String? {
      val value = request.header("authorization") ?: return null
      if (!value.startsWith("Bearer ", ignoreCase = true)) return null
      return value.substring(7).trim().takeIf { it.isNotEmpty() }
    }

    fun isJson(contentType: String?): Boolean =
      contentType?.substringBefore(';')?.trim()?.equals("application/json", ignoreCase = true) == true

    /** One `bytes=` range of a [size]-byte file as first..last, or null when it is unsatisfiable or malformed. */
    fun parseRange(header: String, size: Long): LongRange? {
      val spec = header.trim()
      if (!spec.startsWith("bytes=", ignoreCase = true) || size <= 0) return null
      val value = spec.substring(6).trim()
      if (value.contains(',')) return null
      val dash = value.indexOf('-')
      if (dash < 0) return null
      val startText = value.substring(0, dash).trim()
      val endText = value.substring(dash + 1).trim()
      if (startText.isEmpty()) {
        val suffix = endText.toLongOrNull()?.takeIf { it > 0 } ?: return null
        return (size - suffix).coerceAtLeast(0)..(size - 1)
      }
      val start = startText.toLongOrNull()?.takeIf { it >= 0 && it < size } ?: return null
      val end = if (endText.isEmpty()) size - 1 else (endText.toLongOrNull() ?: return null).coerceAtMost(size - 1)
      if (end < start) return null
      return start..end
    }

    /** `attachment` with an ASCII fallback name and the exact name as RFC 5987 `filename*`. */
    fun contentDisposition(name: String): String {
      val ascii = name.map { if (it.code in 0x20..0x7e && it != '"' && it != '\\') it else '_' }.joinToString("")
      return "attachment; filename=\"$ascii\"; filename*=UTF-8''${SentList.encodeName(name)}"
    }

    internal fun RemoteDownload.toJson(): JSONObject = JSONObject()
      .put("id", id)
      .put("title", title)
      .put("state", state)
      .put("site", site)
      .put("quality", quality ?: JSONObject.NULL)
      .put("bytesDone", bytesDone)
      .put("totalBytes", totalBytes ?: JSONObject.NULL)
      .put("fraction", fraction ?: JSONObject.NULL)
      .put("speedBps", speedBps ?: JSONObject.NULL)
      .put("etaSeconds", etaSeconds ?: JSONObject.NULL)
      .put("errorCode", errorCode ?: JSONObject.NULL)
      .put("createdAt", createdAt)
      .put("updatedAt", updatedAt)
      .put("actions", JSONArray(actions))

    internal fun LinkRequest.toJson(): JSONObject = JSONObject()
      .put("requestId", requestId)
      .put("status", status)
      .put("source", source.wire)
      .put("title", title ?: JSONObject.NULL)
      .put("downloadId", downloadId ?: JSONObject.NULL)
      .put("detail", detail ?: JSONObject.NULL)
  }
}
