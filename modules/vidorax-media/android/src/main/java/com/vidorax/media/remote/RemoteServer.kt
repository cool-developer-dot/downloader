package com.vidorax.media.remote

import android.util.Log
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.runBlocking
import java.io.ByteArrayInputStream
import java.io.FileInputStream
import java.io.InputStream
import java.util.Collections

/**
 * The NanoHTTPD (BSD-3) side of the P6 server: one listening address, at most [MAX_CONNECTIONS] connections at a
 * time, request bodies of at most [RemoteRouter.MAX_BODY_BYTES] read with an explicit length (nothing is ever written
 * to a temp file), and every request handed to [RemoteRouter] as a plain [RemoteRequest].
 */
internal class RemoteServer(
  hostname: String,
  port: Int,
  private val router: RemoteRouter,
) : NanoHTTPD(hostname, port) {
  init {
    setAsyncRunner(BoundedRunner(MAX_CONNECTIONS))
  }

  override fun serve(session: IHTTPSession): Response {
    val request = try {
      readRequest(session)
    } catch (e: RequestRejected) {
      // The unread body would be parsed as the next request: this connection ends with the answer.
      return toNano(RemoteRouter.error(e.status, e.code, e.message ?: "Rejected"), session).also { it.addHeader("Connection", "close") }
    }
    val response = try {
      runBlocking { router.handle(request) }
    } catch (e: Exception) {
      Log.w(TAG, "remote request failed: ${e.javaClass.simpleName}")
      RemoteRouter.error(500, "server_error", "Something went wrong on the phone.")
    }
    return toNano(response, session)
  }

  /** Bodies that are not JSON must not change keep-alive parsing, so the CORS/size checks run before reading. */
  private fun readRequest(session: IHTTPSession): RemoteRequest {
    val headers = session.headers.mapKeys { it.key.lowercase() }
    val method = session.method?.name ?: throw RequestRejected(405, "method_not_allowed", "Method not allowed.")
    val lengthHeader = headers["content-length"]
    val body: ByteArray? = when {
      lengthHeader != null -> {
        val length = lengthHeader.trim().toLongOrNull() ?: throw RequestRejected(400, "bad_length", "Bad Content-Length.")
        if (length > RemoteRouter.MAX_BODY_BYTES) throw RequestRejected(413, "too_large", "The request is too large.")
        readExactly(session.inputStream, length.toInt())
      }
      headers["transfer-encoding"] != null -> throw RequestRejected(411, "length_required", "Send a Content-Length.")
      else -> null
    }
    val query = session.parameters.mapValues { it.value.firstOrNull().orEmpty() }
    return RemoteRequest(method = method, path = session.uri ?: "/", query = query, headers = headers, body = body)
  }

  private fun readExactly(input: InputStream, length: Int): ByteArray {
    val bytes = ByteArray(length)
    var read = 0
    while (read < length) {
      val n = input.read(bytes, read, length - read)
      if (n < 0) throw RequestRejected(400, "short_body", "The request body ended early.")
      read += n
    }
    return bytes
  }

  private fun toNano(response: RemoteResponse, session: IHTTPSession): Response {
    val status = Status(response.status)
    val nano = when (val body = response.body) {
      is RemoteBody.Bytes -> newFixedLengthResponse(status, response.contentType, ByteArrayInputStream(body.bytes), body.bytes.size.toLong())
      is RemoteBody.FileRange -> {
        val stream = FileInputStream(body.file)
        var skipped = 0L
        while (skipped < body.offset) {
          val n = stream.skip(body.offset - skipped)
          if (n <= 0) break
          skipped += n
        }
        newFixedLengthResponse(status, response.contentType, stream, body.length).also { it.setGzipEncoding(false) }
      }
    }
    response.headers.forEach { (name, value) -> nano.addHeader(name, value) }
    if (session.method == Method.HEAD) nano.setGzipEncoding(false)
    return nano
  }

  /** Videos are never gzipped; JSON and text are, when the browser asks. */
  override fun useGzipWhenAccepted(r: Response): Boolean {
    val mime = r.mimeType?.lowercase() ?: return false
    return mime.startsWith("text/") || mime.startsWith("application/json")
  }

  private class Status(private val code: Int) : Response.IStatus {
    override fun getDescription(): String = "$code ${RemoteResponse.statusText(code)}"

    override fun getRequestStatus(): Int = code
  }

  private class RequestRejected(val status: Int, val code: String, message: String) : Exception(message)

  /** NanoHTTPD's default runner starts a thread per connection without limit; this one refuses past [max]. */
  private class BoundedRunner(private val max: Int) : AsyncRunner {
    private val running = Collections.synchronizedList(ArrayList<ClientHandler>())
    private var count = 0L

    override fun closeAll() {
      synchronized(running) { ArrayList(running) }.forEach { runCatching { it.close() } }
    }

    override fun closed(clientHandler: ClientHandler) {
      running.remove(clientHandler)
    }

    override fun exec(code: ClientHandler) {
      synchronized(running) {
        if (running.size >= max) {
          runCatching { code.close() }
          return
        }
        running.add(code)
        count += 1
      }
      Thread(code, "VidoraRemote-$count").apply {
        isDaemon = true
        start()
      }
    }
  }

  private companion object {
    const val TAG = "VidoraRemote"
    const val MAX_CONNECTIONS = 16
  }
}
