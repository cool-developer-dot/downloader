package com.vidorax.media.transfer

import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.HttpResponse
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRequest
import com.vidorax.media.net.Redact
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Where a multi-connection download stands, kept beside its `.part` (`download.part.parts`). The `.part` is the
 * whole file, pre-sized to [total]; each part is a byte range `[start, end]` of it, of which the first [Part.done]
 * bytes are written and synced. Written only after the file was synced, so it never claims bytes the disk does not
 * have; atomic (a crash leaves the previous checkpoint or this one). No URL, token or header — the validator ties the
 * bytes to one version of the resource, and survives a re-signed link.
 */
internal data class PartsCheckpoint(val total: Long, val validator: String, val parts: List<Part>) {
  data class Part(val start: Long, val end: Long, val done: Long) {
    val length: Long get() = end - start + 1
  }

  /** Bytes already written in all parts. */
  val bytesDone: Long get() = parts.sumOf { it.done.coerceIn(0, it.length) }

  /** Bytes written contiguously from byte 0 — what a single connection can continue from. */
  val contiguousPrefix: Long
    get() {
      var prefix = 0L
      for (part in parts.sortedBy { it.start }) {
        if (part.start > prefix) break
        prefix = maxOf(prefix, part.start + part.done.coerceIn(0, part.length))
        if (part.done < part.length) break
      }
      return prefix
    }

  /** The checkpoint still describes [partFile]: same size, ranges inside it, a validator to resume against. */
  fun describes(partFile: File): Boolean =
    partFile.isFile && partFile.length() == total && total > 0 && validator.isNotBlank() && parts.isNotEmpty() &&
      parts.all { it.start in 0 until total && it.end in it.start until total && it.done in 0..it.length }

  companion object {
    fun fileFor(partFile: File): File = File(partFile.path + SUFFIX)

    fun read(partFile: File): PartsCheckpoint? = runCatching {
      val file = fileFor(partFile)
      if (!file.isFile) return null
      val json = JSONObject(file.readText())
      val array = json.getJSONArray("parts")
      PartsCheckpoint(
        total = json.getLong("total"),
        validator = json.getString("validator"),
        parts = (0 until array.length()).map { i ->
          val p = array.getJSONArray(i)
          Part(p.getLong(0), p.getLong(1), p.getLong(2))
        },
      )
    }.getOrNull()

    fun write(partFile: File, checkpoint: PartsCheckpoint) {
      val parts = JSONArray()
      checkpoint.parts.forEach { parts.put(JSONArray().put(it.start).put(it.end).put(it.done)) }
      val json = JSONObject().put("v", 1).put("total", checkpoint.total).put("validator", checkpoint.validator).put("parts", parts)
      val file = fileFor(partFile)
      val tmp = File(file.path + ".tmp")
      RandomAccessFile(tmp, "rw").use { raf ->
        raf.setLength(0)
        raf.write(json.toString().toByteArray())
        raf.fd.sync()
      }
      try {
        Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
      } catch (e: AtomicMoveNotSupportedException) {
        Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
      }
    }

    fun delete(partFile: File) {
      fileFor(partFile).delete()
      File(fileFor(partFile).path + ".tmp").delete()
    }

    private const val SUFFIX = ".parts"
  }
}

/**
 * Bytes of a download's `.part` that are really downloaded: the parts' progress for a multi-connection download (its
 * `.part` is pre-sized to the whole file), else the file's length.
 */
internal object PartProgress {
  fun bytesOnDisk(partFile: File): Long {
    PartsCheckpoint.read(partFile)?.takeIf { it.describes(partFile) }?.let { return it.bytesDone }
    return if (partFile.isFile) partFile.length() else 0L
  }
}

/** Positional writes into the `.part` from several connections at once. Injectable so tests can fail the disk. */
internal interface PartWriter : java.io.Closeable {
  /** Writes `bytes[offset, offset + length)` at [position]; a disk failure is a [StorageWriteException]. */
  fun write(position: Long, bytes: ByteArray, offset: Int, length: Int)

  /** Everything written so far is on the disk. */
  fun sync()

  companion object {
    val FILE: (File) -> PartWriter = { file -> FileChannelWriter(file) }
  }
}

private class FileChannelWriter(file: File) : PartWriter {
  private val raf = diskWrite { RandomAccessFile(file, "rw") }
  private val channel: FileChannel = raf.channel

  override fun write(position: Long, bytes: ByteArray, offset: Int, length: Int) {
    val buffer = ByteBuffer.wrap(bytes, offset, length)
    var at = position
    diskWrite {
      while (buffer.hasRemaining()) at += channel.write(buffer, at)
    }
  }

  override fun sync() {
    diskWrite { channel.force(false) }
  }

  override fun close() {
    runCatching { raf.close() }
  }
}

/** A part's range was refused or ignored (a `200`, a `416`, a range that does not line up): use one connection. */
internal class RangesRefusedException(message: String) : IOException(message)

/** The resource is not the one the `.part` holds any more (another validator): it must start over from byte 0. */
internal class SourceChangedException(message: String) : IOException(message)

/**
 * Downloads one file over up to `connections` HTTP connections, each a byte range written straight to its offset in
 * the pre-sized `.part` (no join step, no second copy on disk), with [PartsCheckpoint] persisted about once a second
 * and whenever it stops — so a pause, a dropped network or a process death resumes every part where it was.
 *
 * Dynamic segmentation: a connection whose part is finished takes over the second half of the largest part still
 * running (when both halves are at least [MIN_SPLIT_BYTES] and that part would still take more than
 * [SPLIT_PAYOFF_FACTOR] times as long as a request takes to answer), so every connection works until the end without
 * a late split adding a wait on a slow-to-answer server.
 *
 * Never a failure of its own: a range a server will not serve ([RangesRefusedException]) or a changed resource
 * ([SourceChangedException]) is handed back for the caller to continue on one connection; a `401`/`403`/`429` while
 * other connections are open is a server limiting connections, and the download simply carries on with one; a
 * dropped connection retries that part on its own. Only what one connection would also fail with — a `403` with
 * nothing else open, a `404`, a full disk — leaves this class as the usual exception.
 */
internal class RangedDownload(
  private val http: HttpClient,
  private val url: String,
  private val spec: TransferSpec,
  private val total: Long,
  private val validator: String,
  initialParts: List<PartsCheckpoint.Part>,
  connections: Int,
  private val writer: PartWriter,
  private val onProgress: (bytesDone: Long, totalBytes: Long?) -> Unit,
  private val retryDelay: suspend (Long) -> Unit = { delay(it) },
  private val now: () -> Long = System::currentTimeMillis,
) {
  private class Part(val start: Long, end: Long, done: Long) {
    @Volatile var end: Long = end
    val written = AtomicLong(done)
    var active = false

    /** When this part's current response started delivering, and how much it had written then (its rate). */
    @Volatile var streamingSince = 0L
    @Volatile var writtenAtStart = 0L

    fun position(): Long = start + written.get()

    fun remaining(): Long = end - position() + 1
  }

  /** Every part on its own TCP connection, also from an HTTP/2 server (see [HttpClient.separateConnections]). */
  private val partsHttp = http.separateConnections
  private val lock = Any()
  private val checkpointLock = Any()
  private val parts = ArrayList<Part>().apply {
    initialParts.forEach { add(Part(it.start, it.end, it.done.coerceIn(0, it.length))) }
  }
  private var allowed = connections.coerceIn(1, MAX_CONNECTIONS)
  private var running = 0
  private var peak = 0
  private val bytesDone = AtomicLong(parts.sumOf { it.written.get() })
  /** How long a request takes to answer (headers), averaged: what a new split costs before it brings a byte. */
  private val requestLatencyMs = AtomicLong(0)
  @Volatile private var lastCheckpoint = 0L

  /** The most connections open at once during [run] (tests). */
  val peakConnections: Int get() = synchronized(lock) { peak }

  /**
   * Runs until every part is written. [first] is the response that proved the server's ranges — it carries the start
   * of the part beginning at its range and is read instead of asking again.
   */
  suspend fun run(first: HttpResponse? = null): TransferOutcome.Completed {
    try {
      checkpoint(force = true)
      withContext(Dispatchers.IO) {
        coroutineScope {
          val firstPart = first?.let { claimFor(it) }
          if (first != null && firstPart == null) first.close()
          val workers = synchronized(lock) {
            running = allowed
            peak = maxOf(peak, running)
            allowed
          }
          repeat(workers) { index ->
            launch { worker(if (index == 0 && firstPart != null) firstPart to first else null) }
          }
        }
      }
    } finally {
      withContext(NonCancellable) { runCatching { checkpoint(force = true) } }
    }
    synchronized(lock) {
      check(parts.all { it.remaining() <= 0 }) { "parts left unfinished" }
    }
    onProgress(total, total)
    return TransferOutcome.Completed(bytesWritten = total, totalBytes = total, validator = validator, finalUrl = url)
  }

  /** The part the pre-opened [response] continues (the one at its range's start), marked active. */
  private fun claimFor(response: HttpResponse): Part? = synchronized(lock) {
    val start = response.contentRange?.start ?: return null
    parts.firstOrNull { !it.active && it.remaining() > 0 && it.position() == start }?.also { it.active = true }
  }

  /** One connection: works parts until [claim] has none for it. Counted in [running] from launch until it stops. */
  private suspend fun worker(firstJob: Pair<Part, HttpResponse?>?) {
    var job = firstJob
    var counted = true
    try {
      while (true) {
        val next = job ?: when (val claimed = claim()) {
          is Claim.Got -> claimed.part to null
          Claim.Wait -> {
            // Too early to tell whether splitting the largest part pays off: look again shortly.
            delay(SPLIT_RECHECK_MS)
            continue
          }
          Claim.None -> null
        }
        if (next == null) {
          counted = false // [claim] stopped counting this worker
          return
        }
        job = null
        val (part, response) = next
        try {
          if (runPart(part, response)) {
            counted = false // [limitConnections] stopped counting it
            return
          }
        } finally {
          synchronized(lock) { part.active = false }
        }
        checkpoint(force = false)
      }
    } finally {
      if (counted) synchronized(lock) { running -= 1 }
    }
  }

  /**
   * The next part for a free connection: one nobody works on, else the second half of the largest running part. Null
   * when there is nothing left for it — or when the server allows fewer connections than are open — and then the
   * worker stops counting in the same step, so the last connection is never lost to a race.
   */
  private fun claim(): Claim = synchronized(lock) {
    fun none(): Claim {
      running -= 1
      return Claim.None
    }
    if (running > allowed) return none()
    parts.firstOrNull { !it.active && it.remaining() > 0 }?.let {
      it.active = true
      return Claim.Got(it)
    }
    val largest = parts.filter { it.active }.maxByOrNull { it.remaining() } ?: return none()
    val remaining = largest.remaining()
    if (remaining < 2 * MIN_SPLIT_BYTES) return none()
    when (splitPaysOff(largest, remaining)) {
      null -> return Claim.Wait
      false -> return none()
      true -> Unit
    }
    // The running connection reads at most one buffer past where it is now, so a cut a whole part's minimum away
    // can never land behind bytes it already wrote.
    val cut = largest.position() + remaining / 2
    val tail = Part(cut, largest.end, 0).apply { active = true }
    largest.end = cut - 1
    parts += tail
    Claim.Got(tail)
  }

  private sealed interface Claim {
    class Got(val part: Part) : Claim
    /** Nothing to take now, but a split may pay off once the running part's rate is known. */
    data object Wait : Claim
    data object None : Claim
  }

  /**
   * A split only helps when the part would still take clearly longer than a new request needs to start delivering:
   * on a server that answers slowly (an uncached CDN object, a long round trip) a late split only adds a wait. Null
   * while the part has not streamed long enough to know its rate.
   */
  private fun splitPaysOff(part: Part, remaining: Long): Boolean? {
    val since = part.streamingSince
    if (since == 0L) return null
    val elapsed = now() - since
    val moved = part.written.get() - part.writtenAtStart
    if (elapsed < MIN_RATE_SAMPLE_MS || moved <= 0) return null
    val remainingMs = remaining * elapsed / moved
    return remainingMs > SPLIT_PAYOFF_FACTOR * maxOf(requestLatencyMs.get(), MIN_LATENCY_MS)
  }

  /**
   * A refusal of this connection while others are open: from now on one connection at a time, and this worker stops
   * (its part goes back to the queue). False when it is the only connection — then the refusal is the download's.
   */
  private fun limitConnections(): Boolean = synchronized(lock) {
    if (running <= 1) return false
    allowed = 1
    running -= 1
    true
  }

  /** Downloads [part] to its end. True when the server refused this extra connection (the worker has stopped). */
  private suspend fun runPart(part: Part, preopened: HttpResponse?): Boolean {
    var response = preopened
    var failures = 0
    var highWater = part.position()
    // A dropped connection or an overloaded server is retried for this part alone; the count restarts with progress.
    suspend fun transient(error: IOException) {
      if (part.position() > highWater) {
        highWater = part.position()
        failures = 0
      }
      failures += 1
      if (failures > MAX_PART_ATTEMPTS) throw error
      retryDelay(PART_RETRY_DELAY_MS * failures)
    }
    while (part.remaining() > 0) {
      currentCoroutineContext().ensureActive()
      val from = part.position()
      val current = response ?: try {
        val asked = now()
        partsHttp.execute(MediaRequest(url = url, context = spec.context, rangeStart = from, rangeEnd = part.end, ifRange = validator))
          .also { recordLatency(now() - asked) }
      } catch (e: MediaNetworkException) {
        transient(e)
        continue
      }
      response = null
      val status = current.status
      val range = current.contentRange
      val served = current.validator
      when {
        status == 206 && range != null && range.start == from && (range.total == null || range.total == total) -> {
          if (served != null && served != validator) {
            current.close()
            throw SourceChangedException("validator changed for ${Redact.url(url)}")
          }
          try {
            stream(part, current)
          } catch (e: MediaNetworkException) {
            transient(e)
          }
        }
        status == 200 -> {
          current.close()
          if (served != null && served != validator) throw SourceChangedException("resource changed for ${Redact.url(url)}")
          throw RangesRefusedException("ranges ignored for ${Redact.url(url)}")
        }
        status == 206 || status == 416 -> {
          current.close()
          throw RangesRefusedException("range not served for ${Redact.url(url)} (HTTP $status)")
        }
        status in LIMIT_STATUS && limitConnections() -> {
          // The others are being served: this server limits connections per client. Carry on with fewer.
          current.close()
          return true
        }
        status >= 500 || status == 408 || status == 429 -> {
          current.close()
          transient(MediaHttpException.of(status, url))
        }
        else -> {
          current.close()
          throw MediaHttpException.of(status, url)
        }
      }
    }
    return false
  }

  private fun recordLatency(ms: Long) {
    requestLatencyMs.updateAndGet { average -> if (average == 0L) ms else (average * 3 + ms) / 4 }
  }

  /** Copies [response]'s body into the part's range, up to the part's end as it is at each read. */
  private suspend fun stream(part: Part, response: HttpResponse) {
    val input = response.byteStream()
    // A pause must stop the network now, even mid-read: the body is closed on its own thread, so the pausing thread
    // never waits for a stalled socket.
    val onCancel = currentCoroutineContext().job.invokeOnCompletion {
      CLOSERS.execute { runCatching { input.close() } }
    }
    part.writtenAtStart = part.written.get()
    part.streamingSince = now()
    try {
      val buffer = ByteArray(BUFFER_BYTES)
      while (true) {
        currentCoroutineContext().ensureActive()
        val position = part.position()
        val left = part.end - position + 1
        if (left <= 0) break
        val read = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
        if (read < 0) break
        writer.write(position, buffer, 0, read)
        part.written.addAndGet(read.toLong())
        onProgress(bytesDone.addAndGet(read.toLong()), total)
        checkpoint(force = false)
      }
    } catch (io: IOException) {
      // A body closed by a pause is not a network failure.
      currentCoroutineContext().ensureActive()
      if (io is StorageWriteException || io is MediaNetworkException) throw io
      throw MediaNetworkException("part of ${Redact.url(url)} interrupted", io)
    } finally {
      onCancel.dispose()
      response.close()
    }
    if (part.remaining() > 0) {
      throw MediaNetworkException("part of ${Redact.url(url)} ended early at ${part.position()}/${part.end + 1}")
    }
  }

  /**
   * Persists the parts after syncing the file: at most every [CHECKPOINT_MS], or now when [force]. Each part's count is
   * read before the sync, so the checkpoint only ever claims bytes that are on the disk.
   */
  private fun checkpoint(force: Boolean) {
    if (!force && now() - lastCheckpoint < CHECKPOINT_MS) return
    synchronized(checkpointLock) {
      val t = now()
      if (!force && t - lastCheckpoint < CHECKPOINT_MS) return
      val snapshot = synchronized(lock) {
        parts.sortedBy { it.start }.map {
          PartsCheckpoint.Part(it.start, it.end, it.written.get().coerceAtMost(it.end - it.start + 1))
        }
      }
      writer.sync()
      PartsCheckpoint.write(spec.partFile, PartsCheckpoint(total, validator, snapshot))
      lastCheckpoint = t
    }
  }

  companion object {
    /** Below this a file is fetched on one connection: the extra handshakes would not pay off. */
    const val MIN_PARALLEL_BYTES = 16L * 1024 * 1024

    /** Smallest half a running part is split into for a free connection. */
    const val MIN_SPLIT_BYTES = 1L * 1024 * 1024

    const val MAX_CONNECTIONS = 4
    const val CHECKPOINT_MS = 1_000L

    /** A split must save more than this many times the time a request takes to answer. */
    const val SPLIT_PAYOFF_FACTOR = 2

    /** Latency assumed at least (a request is never free), and the shortest rate sample a split decision trusts. */
    private const val MIN_LATENCY_MS = 200L
    private const val MIN_RATE_SAMPLE_MS = 300L
    private const val SPLIT_RECHECK_MS = 250L
    private const val BUFFER_BYTES = 64 * 1024
    private const val MAX_PART_ATTEMPTS = 3
    private const val PART_RETRY_DELAY_MS = 300L

    /** Answers to an extra connection that mean "not this many at once" while the others are being served. */
    private val LIMIT_STATUS = setOf(401, 403, 429)

    /** Plans [connections] equal parts over `[from, total)`; bytes before [from] are one finished part. */
    fun plan(from: Long, total: Long, connections: Int): List<PartsCheckpoint.Part> {
      val parts = ArrayList<PartsCheckpoint.Part>()
      if (from > 0) parts += PartsCheckpoint.Part(0, from - 1, from)
      val n = connections.coerceIn(1, MAX_CONNECTIONS)
      val size = (total - from + n - 1) / n
      var start = from
      while (start < total) {
        val end = minOf(total - 1, start + size - 1)
        parts += PartsCheckpoint.Part(start, end, 0)
        start = end + 1
      }
      return parts
    }

    /** Daemon threads: aborting a socket read must not keep the process alive or block a caller. */
    private val CLOSERS: ExecutorService = Executors.newCachedThreadPool { runnable ->
      Thread(runnable, "vidorax-ranged-close").apply { isDaemon = true }
    }
  }
}
