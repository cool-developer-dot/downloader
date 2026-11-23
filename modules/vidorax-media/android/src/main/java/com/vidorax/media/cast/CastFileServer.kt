package com.vidorax.media.cast

import java.io.BufferedOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** What the local server hands a TV: one file, read from any byte offset. */
interface CastServedFile {
  val length: Long
  val contentType: String

  /** A stream positioned at [offset]; the caller closes it. */
  fun open(offset: Long): InputStream
}

/**
 * P13 #667: the phone's own tiny HTTP server for the Chromecast (no library). A Cast receiver can only fetch media by
 * URL, so while — and only while — a local video is cast, this serves exactly that one file (and its subtitles as
 * WebVTT, when the user chose a subtitle file) to the TV on the same Wi-Fi.
 *
 * - Bound to the phone's Wi-Fi address only (never `0.0.0.0`, never mobile data), on a port Android picks.
 * - `/<videoToken>` and `/<subtitleToken>.vtt` with 128-bit random tokens ([CastUrls]); any other path or token is a
 *   404. GET and HEAD are served, OPTIONS answers a browser's preflight, anything else is a 404 too.
 * - Single byte ranges (206), so the TV can seek; the content type the file was given.
 * - `Access-Control-Allow-Origin: *`: the receiver is a web page and reads subtitles with fetch. The tokens, not the
 *   origin, are the protection.
 * - Logs nothing about requests (no paths, no addresses, no headers). It never connects anywhere itself.
 * - One response per connection (`Connection: close`); at most [MAX_CLIENTS] requests are served at once.
 */
class CastFileServer(
  private val bindAddress: InetAddress,
  private val video: CastServedFile,
  private val videoToken: String,
  private val subtitle: ByteArray? = null,
  private val subtitleToken: String? = null,
) : Closeable {
  init {
    require(CastUrls.isToken(videoToken)) { "videoToken" }
    require((subtitle == null) == (subtitleToken == null)) { "subtitle" }
    require(subtitleToken == null || CastUrls.isToken(subtitleToken)) { "subtitleToken" }
  }

  private var socket: ServerSocket? = null
  private var clients: ExecutorService? = null
  private var acceptThread: Thread? = null

  @Volatile var isRunning: Boolean = false
    private set

  /** The port Android gave the server; 0 before [start]. */
  @Volatile var port: Int = 0
    private set

  @Synchronized
  fun start() {
    check(socket == null) { "already started" }
    val server = ServerSocket(0, BACKLOG, bindAddress)
    val pool = Executors.newFixedThreadPool(MAX_CLIENTS, daemonThreads("vidorax-cast-client"))
    socket = server
    clients = pool
    port = server.localPort
    isRunning = true
    acceptThread = Thread({ acceptLoop(server, pool) }, "vidorax-cast-server").apply {
      isDaemon = true
      start()
    }
  }

  @Synchronized
  override fun close() {
    isRunning = false
    runCatching { socket?.close() }
    socket = null
    clients?.shutdownNow()
    runCatching { clients?.awaitTermination(1, TimeUnit.SECONDS) }
    clients = null
    acceptThread = null
  }

  private fun acceptLoop(server: ServerSocket, pool: ExecutorService) {
    while (isRunning && !server.isClosed) {
      val client = try {
        server.accept()
      } catch (_: SocketException) {
        break
      } catch (_: IOException) {
        continue
      }
      try {
        pool.execute { client.use { serve(it) } }
      } catch (_: Exception) {
        runCatching { client.close() }
      }
    }
  }

  private fun serve(client: Socket) {
    try {
      client.soTimeout = READ_TIMEOUT_MS
      val request = readRequest(client.getInputStream()) ?: return
      val out = BufferedOutputStream(client.getOutputStream(), BUFFER_BYTES)
      respond(request, out)
      out.flush()
    } catch (_: IOException) {
      // The TV dropped the connection (a seek, a stop): nothing to do.
    }
  }

  internal data class Request(val method: String, val path: String, val headers: Map<String, String>)

  private enum class Target { VIDEO, SUBTITLE }

  private fun targetOf(path: String): Target? {
    if (!path.startsWith("/")) return null
    val name = path.substring(1)
    if (subtitleToken != null && name.endsWith(CastUrls.SUBTITLE_SUFFIX)) {
      val token = name.removeSuffix(CastUrls.SUBTITLE_SUFFIX)
      return if (CastUrls.sameToken(subtitleToken, token)) Target.SUBTITLE else null
    }
    return if (CastUrls.sameToken(videoToken, name)) Target.VIDEO else null
  }

  private fun respond(request: Request, out: OutputStream) {
    val target = targetOf(request.path)
    if (target == null || request.method !in SERVED_METHODS) {
      writeHead(out, 404, "Not Found", listOf("Content-Length" to "0"))
      return
    }
    if (request.method == "OPTIONS") {
      writeHead(
        out,
        204,
        "No Content",
        listOf(
          "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers" to "Range",
          "Access-Control-Max-Age" to "600",
          "Content-Length" to "0",
        ),
      )
      return
    }
    when (target) {
      Target.SUBTITLE -> serveBytes(request, out, subtitle!!, SUBTITLE_TYPE)
      Target.VIDEO -> serveFile(request, out)
    }
  }

  private fun serveBytes(request: Request, out: OutputStream, bytes: ByteArray, type: String) {
    when (val range = HttpRange.parse(request.headers["range"], bytes.size.toLong())) {
      HttpRange.Whole -> {
        writeHead(out, 200, "OK", bodyHeaders(type, bytes.size.toLong()))
        if (request.method == "GET") out.write(bytes)
      }
      is HttpRange.Part -> {
        writeHead(out, 206, "Partial Content", bodyHeaders(type, range.length) + contentRange(range, bytes.size.toLong()))
        if (request.method == "GET") out.write(bytes, range.start.toInt(), range.length.toInt())
      }
      HttpRange.Unsatisfiable -> writeUnsatisfiable(out, bytes.size.toLong())
    }
  }

  private fun serveFile(request: Request, out: OutputStream) {
    val total = video.length
    when (val range = HttpRange.parse(request.headers["range"], total)) {
      HttpRange.Whole -> {
        writeHead(out, 200, "OK", bodyHeaders(video.contentType, total))
        if (request.method == "GET") copy(0, total, out)
      }
      is HttpRange.Part -> {
        writeHead(out, 206, "Partial Content", bodyHeaders(video.contentType, range.length) + contentRange(range, total))
        if (request.method == "GET") copy(range.start, range.length, out)
      }
      HttpRange.Unsatisfiable -> writeUnsatisfiable(out, total)
    }
  }

  private fun copy(offset: Long, count: Long, out: OutputStream) {
    video.open(offset).use { input ->
      val buffer = ByteArray(BUFFER_BYTES)
      var left = count
      while (left > 0 && isRunning) {
        val read = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
        if (read < 0) break
        out.write(buffer, 0, read)
        left -= read
      }
    }
  }

  private fun bodyHeaders(type: String, length: Long) = listOf(
    "Content-Type" to type,
    "Content-Length" to length.toString(),
  )

  private fun contentRange(range: HttpRange.Part, total: Long) =
    listOf("Content-Range" to "bytes ${range.start}-${range.endInclusive}/$total")

  private fun writeUnsatisfiable(out: OutputStream, total: Long) {
    writeHead(out, 416, "Range Not Satisfiable", listOf("Content-Range" to "bytes */$total", "Content-Length" to "0"))
  }

  private fun writeHead(out: OutputStream, code: Int, reason: String, headers: List<Pair<String, String>>) {
    val head = StringBuilder("HTTP/1.1 $code $reason\r\n")
    for ((name, value) in headers + COMMON_HEADERS) head.append(name).append(": ").append(value).append("\r\n")
    head.append("\r\n")
    out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
  }

  companion object {
    const val MAX_CLIENTS = 8
    private const val BACKLOG = 8
    private const val READ_TIMEOUT_MS = 15_000
    private const val BUFFER_BYTES = 64 * 1024
    private const val MAX_HEAD_BYTES = 16 * 1024
    const val SUBTITLE_TYPE = "text/vtt; charset=utf-8"
    private val SERVED_METHODS = setOf("GET", "HEAD", "OPTIONS")
    private val COMMON_HEADERS = listOf(
      "Accept-Ranges" to "bytes",
      "Access-Control-Allow-Origin" to "*",
      "Access-Control-Expose-Headers" to "Content-Length, Content-Range, Accept-Ranges",
      "Cache-Control" to "no-store",
      "Connection" to "close",
    )

    /** The request line and headers (names lower-cased); null when the client sent nothing usable. */
    internal fun readRequest(input: InputStream): Request? {
      val head = ByteArray(MAX_HEAD_BYTES)
      var size = 0
      while (size < head.size) {
        val b = input.read()
        if (b < 0) return null
        head[size++] = b.toByte()
        if (size >= 4 && head[size - 4] == CR && head[size - 3] == LF && head[size - 2] == CR && head[size - 1] == LF) break
      }
      val lines = String(head, 0, size, Charsets.ISO_8859_1).split("\r\n")
      val parts = lines.firstOrNull()?.split(' ') ?: return null
      if (parts.size != 3 || !parts[2].startsWith("HTTP/")) return null
      val path = parts[1].substringBefore('?').substringBefore('#')
      val headers = HashMap<String, String>()
      for (line in lines.drop(1)) {
        val colon = line.indexOf(':')
        if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
      }
      return Request(parts[0].uppercase(), path, headers)
    }

    private const val CR: Byte = 13
    private const val LF: Byte = 10

    private fun daemonThreads(name: String): ThreadFactory {
      val count = AtomicInteger()
      return ThreadFactory { runnable -> Thread(runnable, "$name-${count.incrementAndGet()}").apply { isDaemon = true } }
    }
  }
}
