package com.vidorax.media.remote

import java.io.File

/**
 * P6 (#439, #438): one HTTP request as the remote router sees it — free of NanoHTTPD types, so routing, auth and
 * the security checks are plain JVM code with unit tests. Header names are lower-case.
 */
data class RemoteRequest(
  val method: String,
  val path: String,
  val query: Map<String, String> = emptyMap(),
  val headers: Map<String, String> = emptyMap(),
  val body: ByteArray? = null,
) {
  fun header(name: String): String? = headers[name.lowercase()]
}

sealed class RemoteBody {
  class Bytes(val bytes: ByteArray) : RemoteBody()

  /** [length] bytes of [file] from [offset]: a whole "Sent from phone" file or one range of it. */
  class FileRange(val file: File, val offset: Long, val length: Long) : RemoteBody()
}

data class RemoteResponse(
  val status: Int,
  val contentType: String,
  val body: RemoteBody,
  val headers: Map<String, String> = emptyMap(),
) {
  fun withHeaders(extra: Map<String, String>): RemoteResponse = copy(headers = headers + extra)

  /** The body as text (tests and logging only). */
  fun text(): String = when (body) {
    is RemoteBody.Bytes -> String(body.bytes, Charsets.UTF_8)
    is RemoteBody.FileRange -> ""
  }

  companion object {
    fun json(status: Int, json: String, headers: Map<String, String> = emptyMap()): RemoteResponse =
      RemoteResponse(status, "application/json; charset=utf-8", RemoteBody.Bytes(json.toByteArray(Charsets.UTF_8)), headers)

    fun text(status: Int, text: String, contentType: String = "text/plain; charset=utf-8"): RemoteResponse =
      RemoteResponse(status, contentType, RemoteBody.Bytes(text.toByteArray(Charsets.UTF_8)))

    fun empty(status: Int, headers: Map<String, String> = emptyMap()): RemoteResponse =
      RemoteResponse(status, "text/plain; charset=utf-8", RemoteBody.Bytes(ByteArray(0)), headers)

    fun statusText(status: Int): String = when (status) {
      200 -> "OK"
      201 -> "Created"
      202 -> "Accepted"
      204 -> "No Content"
      206 -> "Partial Content"
      400 -> "Bad Request"
      401 -> "Unauthorized"
      403 -> "Forbidden"
      404 -> "Not Found"
      405 -> "Method Not Allowed"
      409 -> "Conflict"
      411 -> "Length Required"
      413 -> "Payload Too Large"
      415 -> "Unsupported Media Type"
      416 -> "Range Not Satisfiable"
      421 -> "Misdirected Request"
      429 -> "Too Many Requests"
      503 -> "Service Unavailable"
      else -> if (status >= 500) "Internal Server Error" else "Error"
    }
  }
}
