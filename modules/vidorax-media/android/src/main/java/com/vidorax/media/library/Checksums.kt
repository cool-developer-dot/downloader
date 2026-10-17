package com.vidorax.media.library

import com.vidorax.media.NotFoundException
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.currentCoroutineContext

/**
 * H20 Checksum Verify (#409): the SHA-256 of a finished library file, for Download Details.
 *
 * The duplicate check already stores one per library item when another file of the same size appeared (`library`
 * column `content_sha256`): [cached] reads it. Otherwise [compute] streams the file (never loading it whole), reports
 * progress ([progress]), can be stopped ([cancel]) and stores the result in the same column — so the duplicate check
 * uses it too, and it is never computed twice. Library files are never modified in place, so a stored hash stays right.
 */
internal class Checksums(
  private val scope: CoroutineScope,
  private val fileOf: suspend (String) -> File?,
  private val storedHashOf: suspend (String) -> String?,
  private val storeHash: suspend (String, String) -> Unit,
  /** How a file is read (tests slow it down). */
  private val open: (File) -> InputStream = { it.inputStream() },
) {
  data class Progress(val bytesDone: Long, val totalBytes: Long)

  private class Running(val job: Deferred<String?>, val done: AtomicLong, val total: Long)

  private val running = ConcurrentHashMap<String, Running>()

  /** The stored SHA-256 of library item [id] (lowercase hex), or null when none was computed yet. */
  suspend fun cached(id: String): String? = runCatching { storedHashOf(id) }.getOrNull()?.takeIf(::isSha256)

  fun isComputing(id: String): Boolean = running[id]?.job?.isActive == true

  /**
   * The SHA-256 of library item [id]: the stored one, else computed now (a second call while one runs joins it).
   * Null when it was cancelled. NotFoundException when the item or its file is gone.
   */
  suspend fun compute(id: String): String? {
    cached(id)?.let { return it }
    val file = fileOf(id)?.takeIf { it.isFile } ?: throw NotFoundException("No file for library item $id")
    val current = running.compute(id) { _, existing ->
      if (existing != null && existing.job.isActive) {
        existing
      } else {
        val done = AtomicLong(0)
        Running(scope.async(Dispatchers.IO) { digest(file, done) }, done, file.length())
      }
    }!!
    val hash = try {
      current.job.await()
    } catch (c: kotlinx.coroutines.CancellationException) {
      // Cancelled by [cancel] (or the scope): the caller gets "no hash", never an error.
      currentCoroutineContext().ensureActive()
      null
    } finally {
      running.remove(id, current)
    }
    if (hash != null) runCatching { storeHash(id, hash) }
    return hash
  }

  /** Bytes hashed so far while [compute] runs for [id]; null otherwise. */
  fun progress(id: String): Progress? = running[id]?.takeIf { it.job.isActive }?.let { Progress(it.done.get(), it.total) }

  /** Stops a running computation of [id]; its [compute] returns null. */
  fun cancel(id: String) {
    running[id]?.job?.cancel()
  }

  private suspend fun digest(file: File, done: AtomicLong): String =
    open(file).use { input ->
      sha256(input) { bytes ->
        done.set(bytes)
        currentCoroutineContext().ensureActive()
      }
    }

  companion object {
    private const val BUFFER_BYTES = 1 shl 20
    private val HEX = Regex("^[0-9a-f]{64}$")

    @Volatile private var shared: Checksums? = null

    /** One per process, so a computation outlives a JavaScript reload and is never run twice. */
    fun shared(services: com.vidorax.media.MediaServices): Checksums = shared ?: synchronized(this) {
      shared ?: Checksums(
        scope = services.scope,
        fileOf = { id -> services.library.get(id)?.file },
        storedHashOf = services.library::contentHashOf,
        storeHash = services.library::setContentHash,
      ).also { shared = it }
    }

    fun isSha256(value: String?): Boolean = value != null && HEX.matches(value)

    /**
     * Streams [input] through SHA-256 in 1 MiB reads; [afterChunk] gets the bytes read so far after every read and may
     * throw to stop (a cancellation). Lowercase hex, the form ContentHash stores.
     */
    suspend fun sha256(input: InputStream, afterChunk: suspend (Long) -> Unit): String {
      val digest = MessageDigest.getInstance("SHA-256")
      val buffer = ByteArray(BUFFER_BYTES)
      var total = 0L
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
        total += read
        afterChunk(total)
      }
      return digest.digest().joinToString("") { "%02x".format(it) }
    }
  }
}
