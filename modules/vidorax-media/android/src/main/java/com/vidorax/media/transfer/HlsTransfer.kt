package com.vidorax.media.transfer

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.wireValueOf
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.HttpResponse
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRefusedException
import com.vidorax.media.net.MediaRequest
import com.vidorax.media.net.Redact
import com.vidorax.media.plan.HlsPlan
import com.vidorax.media.plan.HlsPlanner
import com.vidorax.media.plan.HlsSegmentFormat
import com.vidorax.media.plan.HlsSegmentRef
import com.vidorax.media.plan.TrackRole
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** One segment track download: the plan to fetch, where the assembled file goes, and where its checkpoint lives. */
internal data class HlsTransferSpec(
  val plan: HlsPlan,
  val context: RequestContext,
  /** The assembled output — the same `.part` the engine verifies and finalizes for a progressive download. */
  val partFile: File,
  /** Resume point, next to the `.part`: how many segments are durably in it and how many bytes that is. */
  val checkpointFile: File,
  /**
   * What the track must be. An audio track may be HLS packed audio (ADTS/MP3 segments with an ID3 timestamp tag):
   * the tags are removed so the file is one clean audio stream, and the first timestamp is kept for the merge.
   */
  val role: TrackRole = TrackRole.VIDEO,
  /**
   * Segments fetched at once (Settings → "Connections per file"). Above 1, the next segments are fetched ahead into
   * their own temporary files beside the `.part` while the file is still assembled strictly in playlist order.
   */
  val connections: Int = 1,
)

internal data class HlsTransferOutcome(
  val bytesWritten: Long,
  /** From the bytes, not the playlist: MPEG-TS, fragmented MP4 or WebM ([Container.UNKNOWN] for packed audio). */
  val container: Container,
  /** The track is packed audio (ADTS without its ID3 tags). */
  val packedAudio: Boolean = false,
  /** Packed audio: the first segment's MPEG-TS presentation time (µs), which aligns it with the video. */
  val timestampUs: Long? = null,
)

/**
 * The durable resume point of an HLS download. Written only after the `.part` holding those segments is synced,
 * so the checkpoint can never claim bytes the file does not have. It carries no URL, token or header — segment
 * URLs are re-read from a fresh playlist on every run — and the [fingerprint] ties it to one playlist structure.
 */
internal data class HlsCheckpoint(
  val fingerprint: String,
  /** Segments `0 until completed` are in the `.part`, in order. */
  val completed: Int,
  /** Length of the `.part` that holds exactly those segments. */
  val partBytes: Long,
  /** The init section most recently written, so a resume does not write it twice. */
  val lastInitIndex: Int?,
  val container: Container?,
  /** fMP4 only: where the space reserved for the file's segment index sits (see [Fmp4Index]). */
  val indexOffset: Long? = null,
  val indexSize: Long? = null,
  val packedAudio: Boolean = false,
  /** Packed audio: the first segment's ID3 timestamp (µs). */
  val timestampUs: Long? = null,
  /**
   * MPEG-TS: the continuity counter of the last packet per PID ([TsContinuity]), so the next segment continues the
   * numbering. Null in a checkpoint an older version wrote — its `.part` is renumbered once when it resumes.
   */
  val continuity: Map<Int, Int>? = null,
) {
  companion object {
    fun read(file: File): HlsCheckpoint? = runCatching {
      if (!file.isFile) return null
      val json = JSONObject(file.readText())
      HlsCheckpoint(
        fingerprint = json.getString("fingerprint"),
        completed = json.getInt("completed"),
        partBytes = json.getLong("partBytes"),
        lastInitIndex = if (json.has("lastInitIndex")) json.getInt("lastInitIndex") else null,
        container = json.optString("container").takeIf { it.isNotEmpty() }?.let { wireValueOf<Container>(it) },
        indexOffset = if (json.has("indexOffset")) json.getLong("indexOffset") else null,
        indexSize = if (json.has("indexSize")) json.getLong("indexSize") else null,
        packedAudio = json.optBoolean("packedAudio", false),
        timestampUs = if (json.has("timestampUs")) json.getLong("timestampUs") else null,
        continuity = json.optJSONObject("continuity")?.let { cc ->
          cc.keys().asSequence().associate { pid -> pid.toInt() to cc.getInt(pid) }
        },
      )
    }.getOrNull()

    /** Atomic: a crash leaves either the previous checkpoint or this one, never a torn file. */
    fun write(file: File, checkpoint: HlsCheckpoint) {
      val json = JSONObject()
        .put("fingerprint", checkpoint.fingerprint)
        .put("completed", checkpoint.completed)
        .put("partBytes", checkpoint.partBytes)
      checkpoint.lastInitIndex?.let { json.put("lastInitIndex", it) }
      checkpoint.container?.let { json.put("container", it.wire) }
      checkpoint.indexOffset?.let { json.put("indexOffset", it) }
      checkpoint.indexSize?.let { json.put("indexSize", it) }
      if (checkpoint.packedAudio) json.put("packedAudio", true)
      checkpoint.timestampUs?.let { json.put("timestampUs", it) }
      checkpoint.continuity?.let { cc ->
        json.put("continuity", JSONObject().apply { cc.forEach { (pid, counter) -> put(pid.toString(), counter) } })
      }
      val tmp = File(file.parentFile, "${file.name}.tmp")
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
  }
}

/**
 * Downloads an HLS plan's segments, in playlist order, into one file.
 *
 * - MPEG-TS segments are concatenated, each packet's continuity counter renumbered so the joins read as one stream
 *   ([TsContinuity]; nothing else in a packet changes). fMP4 writes its init section once (again only if the
 *   playlist switches init sections) followed by every media segment. Nothing is decrypted, remuxed or reordered.
 * - Segment by segment: after each one the `.part` is synced and the checkpoint advanced. A pause, a crash or a
 *   dropped connection resumes at the first segment not in the checkpoint; any bytes of a half-written segment are
 *   cut off first, so a segment is never written twice.
 * - With [HlsTransferSpec.connections] above 1, up to that many segments are fetched at once — each into its own
 *   file beside the `.part` — and appended strictly in order, so the assembled file and its checkpoint are exactly
 *   what a one-by-one download writes. A segment that fails is reported only when its turn comes; a whole segment
 *   fetched ahead by a paused run is used by the next run of the same stream instead of being fetched again.
 * - Every request carries the download's User-Agent, Referer, Origin and cookies; `EXT-X-BYTERANGE` segments are
 *   fetched as exact ranges. A child URL that answers 401/403 without a query of its own is retried once with the
 *   playlist's query (token propagation), and that choice then sticks for the rest of the run.
 * - Failures keep their meaning: transport errors and truncated segments are [MediaNetworkException] (resume),
 *   HTTP statuses are [MediaHttpException] (the engine decides: expired link, missing, or transient), a write the
 *   disk refused is [StorageWriteException] (or a plain `IOException` from the file's own bookkeeping), and a
 *   stream that turns out to be something the product refuses is [MediaRefusedException].
 */
internal class HlsTransfer(private val http: HttpClient) {
  /** Segments fetched ahead each use their own TCP connection, also from an HTTP/2 server. */
  private val aheadHttp: HttpClient by lazy { http.separateConnections }

  suspend fun transfer(
    spec: HlsTransferSpec,
    onProgress: (bytesDone: Long, totalBytes: Long?) -> Unit = { _, _ -> },
  ): HlsTransferOutcome = withContext(Dispatchers.IO) { download(spec, onProgress) }

  private suspend fun download(spec: HlsTransferSpec, reportProgress: (Long, Long?) -> Unit): HlsTransferOutcome = coroutineScope {
    val plan = spec.plan
    // Reported from the assembly loop and from the threads fetching ahead: never backwards within a run (the engine
    // reads a drop as a restart).
    val reported = AtomicLong(0)
    val onProgress = { bytes: Long, total: Long? ->
      val now = reported.accumulateAndGet(bytes) { a, b -> maxOf(a, b) }
      reportProgress(now, total?.let { maxOf(it, now) })
    }
    spec.partFile.parentFile?.mkdirs()
    val saved = HlsCheckpoint.read(spec.checkpointFile)?.takeIf {
      it.fingerprint == plan.fingerprint && it.completed in 0..plan.segments.size &&
        it.partBytes >= 0 && it.partBytes <= (if (spec.partFile.isFile) spec.partFile.length() else 0L)
    }
    var completed = saved?.completed ?: 0
    var offset = saved?.partBytes ?: 0L
    var lastInit = saved?.lastInitIndex
    var container = saved?.container
    var indexOffset = saved?.indexOffset
    var indexSize = saved?.indexSize
    var packedAudio = saved?.packedAudio ?: false
    var timestampUs = saved?.timestampUs
    val continuity = TsContinuity(saved?.continuity ?: emptyMap())
    val durations = LongArray(plan.segments.size + 1).also { sums ->
      for (i in plan.segments.indices) sums[i + 1] = sums[i] + plan.segments[i].durationUs
    }
    val tokenPropagation = TokenPropagation(plan.mediaPlaylistUrl)

    // Never touch the `.part` once this worker has been superseded (pause, cancel, a newer run).
    currentCoroutineContext().ensureActive()
    // Segments fetched ahead by a run that was paused or died are kept only for the same stream, past the checkpoint.
    SegmentFiles.prepare(spec.partFile, keepFrom = if (saved != null && spec.connections > 1) completed else null)
    val prefetch = if (spec.connections > 1) Prefetch(this, spec, tokenPropagation) else null
    try {
      RandomAccessFile(spec.partFile, "rw").use { raf ->
        // Whatever lies past the checkpoint is a segment that never completed: drop it before writing again.
        raf.setLength(offset)
        if (saved == null) {
          // A new stream (or another one): a checkpoint at zero, so segments fetched ahead before the first is
          // appended still belong to a known stream when the run is paused.
          HlsCheckpoint.write(spec.checkpointFile, HlsCheckpoint(plan.fingerprint, 0, 0, null, null))
        }
        // A transport stream an older version assembled has its joins as the packager numbered them: renumber it once.
        if (saved != null && saved.continuity == null && container == Container.TS && offset > 0) {
          continuity.renumber(raf, 0, offset)
          raf.fd.sync()
          HlsCheckpoint.write(spec.checkpointFile, saved.copy(continuity = continuity.state))
        }

        while (completed < plan.segments.size) {
          currentCoroutineContext().ensureActive()
          val segment = plan.segments[completed]
          val segmentStart = offset
          var writeAt = offset
          // Extrapolated from whole segments only: a half-received segment would inflate bytes-per-second of media.
          val wholeSegmentsTotal = estimateTotal(offset, durations[completed], plan)
          val estimate = { bytes: Long -> wholeSegmentsTotal?.let { maxOf(it, bytes + 1) } }
          val report = { bytes: Long ->
            val ahead = prefetch?.bytesAhead ?: 0L
            onProgress(bytes + ahead, estimate(bytes + ahead))
          }
          prefetch?.let { p ->
            p.assembled = offset
            p.onAhead = { report(p.assembled) }
          }

          val initIndex = segment.initIndex
          if (initIndex != null && initIndex != lastInit) {
            writeAt = append(raf, writeAt, plan.inits[initIndex], spec.context, tokenPropagation, stripId3 = false, onBytes = report)
            if (container == null) {
              // The init section decides the container; an fMP4 file gets room for its one segment index here.
              container = confirmContainer(raf, plan, spec.role)
              if (container == Container.MP4) {
                indexOffset = writeAt
                indexSize = Fmp4Index.placeholderSize(plan.segments.size)
                writeAt = Fmp4Index.writePlaceholder(raf, writeAt, plan.segments.size)
              }
            }
          }
          val fetched = prefetch?.take(completed)
          if (container == null && completed == 0 && spec.role == TrackRole.AUDIO && initIndex == null) {
            packedAudio = if (fetched != null) SegmentFiles.isPackedAudio(fetched) else startsAsPackedAudio(segment.media, spec.context, tokenPropagation)
          }
          val mediaStart = writeAt
          val onTimestamp = { us: Long -> if (timestampUs == null) timestampUs = us }
          writeAt = if (fetched != null) {
            appendFile(raf, writeAt, fetched, segment.media.url, stripId3 = packedAudio, onTimestamp = onTimestamp, onBytes = report)
              .also { fetched.delete() }
          } else {
            append(raf, writeAt, segment.media, spec.context, tokenPropagation, stripId3 = packedAudio, onTimestamp = onTimestamp, onBytes = report)
          }
          if (container == null) container = if (packedAudio) Container.UNKNOWN else confirmContainer(raf, plan, spec.role)
          // A segment's own index describes that segment alone; in one file it would mislead the player.
          if (container == Container.MP4) Fmp4Index.neutralizeSegmentIndexes(raf, mediaStart, writeAt)
          if (container == Container.TS) continuity.renumber(raf, segmentStart, writeAt)
          raf.fd.sync()

          completed += 1
          offset = writeAt
          if (initIndex != null) lastInit = initIndex
          HlsCheckpoint.write(
            spec.checkpointFile,
            HlsCheckpoint(
              plan.fingerprint, completed, offset, lastInit, container, indexOffset, indexSize, packedAudio, timestampUs,
              continuity = if (container == Container.TS) continuity.state else null,
            ),
          )
          prefetch?.assembled = offset
          val total = if (completed == plan.segments.size) offset else estimateTotal(offset, durations[completed], plan)
          onProgress(offset + (prefetch?.bytesAhead ?: 0L), total)
        }
        // Idempotent: a re-run after a crash rewrites the same index over the same reserved bytes.
        val at = indexOffset
        val size = indexSize
        if (container == Container.MP4 && at != null && size != null) {
          currentCoroutineContext().ensureActive()
          Fmp4Index.writeGlobalIndex(raf, at, size, plan.durationUs)
          raf.fd.sync()
        }
      }
    } finally {
      prefetch?.close()
    }
    HlsTransferOutcome(
      bytesWritten = offset,
      container = container ?: plan.containerHint,
      packedAudio = packedAudio,
      timestampUs = timestampUs,
    )
  }

  /**
   * Segments fetched ahead of the one being appended: always the next `connections` segments in playlist order, each
   * into its own file. [take] hands them over in order and only then reports a fetch's failure, so a segment that
   * fails never costs the segments before it; nothing is ever appended out of order. A finished file is renamed into
   * place atomically, so one left by a paused run is whole and is used instead of fetching it again.
   */
  private inner class Prefetch(
    private val scope: CoroutineScope,
    private val spec: HlsTransferSpec,
    private val tokens: TokenPropagation,
  ) {
    private val window = spec.connections.coerceIn(1, MAX_CONNECTIONS)
    private val pending = HashMap<Int, Deferred<Result<File>>>()
    private val ahead = AtomicLong(0)

    /** Bytes in fetched-ahead files not yet appended (combined progress). */
    val bytesAhead: Long get() = ahead.get()

    /** The assembled length, for progress reported from the fetching threads. */
    @Volatile var assembled = 0L

    /** Called from a fetching thread whenever bytes arrived ahead (the loop reports the combined progress). */
    @Volatile var onAhead: () -> Unit = {}

    suspend fun take(index: Int): File {
      schedule(index)
      val file = checkNotNull(pending.remove(index)).await().getOrThrow()
      ahead.addAndGet(-file.length())
      schedule(index + 1)
      return file
    }

    private fun schedule(from: Int) {
      val until = minOf(from + window, spec.plan.segments.size)
      for (i in from until until) {
        if (pending.containsKey(i)) continue
        val done = SegmentFiles.fileFor(spec.partFile, i)
        if (done.isFile && done.length() > 0) {
          ahead.addAndGet(done.length())
          pending[i] = CompletableDeferred(Result.success(done))
          continue
        }
        val ref = spec.plan.segments[i].media
        pending[i] = scope.async(Dispatchers.IO) {
          try {
            Result.success(
              fetchToFile(ref, done, spec.context, tokens) { bytes ->
                ahead.addAndGet(bytes)
                onAhead()
              },
            )
          } catch (c: CancellationException) {
            throw c
          } catch (e: Throwable) {
            Result.failure(e)
          }
        }
      }
    }

    /** Stops what is still being fetched; whole files stay for the next run of the same stream. */
    fun close() {
      pending.values.forEach { it.cancel() }
      pending.clear()
      SegmentFiles.deletePartial(spec.partFile)
    }
  }

  /** An audio rendition's first segment is ID3-tagged ADTS/MP3 (packed audio) rather than MPEG-TS or fMP4. */
  private fun startsAsPackedAudio(ref: HlsSegmentRef, context: RequestContext, tokens: TokenPropagation): Boolean {
    val offset = ref.byteRangeOffset ?: 0L
    val response = try {
      http.execute(
        MediaRequest(url = tokens.urlFor(ref.url), context = context, rangeStart = offset, rangeEnd = offset + PEEK_BYTES - 1),
      )
    } catch (e: MediaRefusedException) {
      return false
    } catch (e: MediaNetworkException) {
      throw e
    }
    return response.use {
      val aligned = (it.status == 206 && it.contentRange?.start == offset) || (it.status == 200 && offset == 0L)
      if (!aligned) return@use false
      val head = try {
        it.readPrefix(PEEK_BYTES.toInt())
      } catch (e: IOException) {
        return@use false
      }
      HlsSegmentFormat.isPackedAudio(head)
    }
  }

  /**
   * Fetches one resource and appends exactly its bytes at [writeAt] — without a leading ID3 tag when [stripId3]
   * (packed audio), reporting that tag's MPEG-TS timestamp through [onTimestamp]. Returns the new end offset.
   */
  private suspend fun append(
    raf: RandomAccessFile,
    writeAt: Long,
    ref: HlsSegmentRef,
    context: RequestContext,
    tokens: TokenPropagation,
    stripId3: Boolean = false,
    onTimestamp: (Long) -> Unit = {},
    onBytes: (Long) -> Unit,
  ): Long {
    val response = open(ref, context, tokens)
    response.use {
      val (skip, expected) = bodyOf(it, ref)
      return copy(raf, writeAt, it.byteStream(), skip, expected, ref.url, stripId3, onTimestamp, onBytes)
    }
  }

  /** Appends a segment fetched ahead into [file] (exactly the segment's bytes) — the same append, from the disk. */
  private suspend fun appendFile(
    raf: RandomAccessFile,
    writeAt: Long,
    file: File,
    url: String,
    stripId3: Boolean,
    onTimestamp: (Long) -> Unit,
    onBytes: (Long) -> Unit,
  ): Long = FileInputStream(file).use { input ->
    copy(raf, writeAt, input, skip = 0, expected = file.length(), url = url, stripId3 = stripId3, onTimestamp = onTimestamp, onBytes = onBytes)
  }

  /**
   * Where the segment's bytes are in [response]'s body: how many to skip (a server that ignored the Range of a
   * sub-range sends the whole resource) and how many there are, when known. Throws for any other answer.
   */
  private fun bodyOf(response: HttpResponse, ref: HlsSegmentRef): Pair<Long, Long?> {
    val status = response.status
    val rangeStart = ref.byteRangeOffset
    val skip: Long = when {
      status == 206 && rangeStart != null -> {
        if (response.contentRange?.start != rangeStart) {
          throw MediaNetworkException("misaligned range for ${Redact.url(ref.url)}")
        }
        0L
      }
      // The server ignored Range: the sub-range starts inside this full body.
      status == 200 && rangeStart != null -> rangeStart
      status == 200 -> 0L
      status == 206 && response.contentRange?.start == 0L -> 0L
      else -> throw MediaHttpException.of(status, ref.url)
    }
    val expected: Long? = ref.byteRangeLength ?: response.contentLength.takeIf { status == 200 }
    return skip to expected
  }

  /**
   * Fetches one segment ahead into [file]: exactly its bytes, renamed into place only once complete — else an
   * exception and no file.
   */
  private suspend fun fetchToFile(
    ref: HlsSegmentRef,
    file: File,
    context: RequestContext,
    tokens: TokenPropagation,
    onBytes: (Long) -> Unit,
  ): File {
    val partial = SegmentFiles.partialFor(file)
    try {
      open(ref, context, tokens, aheadHttp).use { response ->
        val (skip, expected) = bodyOf(response, ref)
        val input = response.byteStream()
        val onCancel = currentCoroutineContext().job.invokeOnCompletion {
          CLOSERS.execute { runCatching { input.close() } }
        }
        try {
          diskWrite { FileOutputStream(partial) }.use { out ->
            val buffer = ByteArray(BUFFER_BYTES)
            var toSkip = skip
            while (toSkip > 0) {
              currentCoroutineContext().ensureActive()
              val read = input.read(buffer, 0, minOf(buffer.size.toLong(), toSkip).toInt())
              if (read < 0) throw MediaNetworkException("segment ended before its byte range: ${Redact.url(ref.url)}")
              toSkip -= read
            }
            var got = 0L
            while (expected == null || got < expected) {
              currentCoroutineContext().ensureActive()
              val want = if (expected == null) buffer.size else minOf(buffer.size.toLong(), expected - got).toInt()
              val read = input.read(buffer, 0, want)
              if (read < 0) break
              diskWrite { out.write(buffer, 0, read) }
              got += read
              onBytes(read.toLong())
            }
            if (expected != null && got < expected) {
              throw MediaNetworkException("truncated segment ${Redact.url(ref.url)}: $got/$expected")
            }
            if (got == 0L) throw MediaNetworkException("empty segment ${Redact.url(ref.url)}")
          }
        } catch (io: IOException) {
          currentCoroutineContext().ensureActive()
          if (io is MediaNetworkException || io is MediaHttpException || io is MediaRefusedException || io is StorageWriteException) {
            throw io
          }
          throw MediaNetworkException("segment transfer of ${Redact.url(ref.url)} interrupted", io)
        } finally {
          onCancel.dispose()
        }
      }
      diskWrite {
        try {
          Files.move(partial.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (e: AtomicMoveNotSupportedException) {
          Files.move(partial.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
      }
    } catch (e: Throwable) {
      partial.delete()
      throw e
    }
    return file
  }

  private fun open(ref: HlsSegmentRef, context: RequestContext, tokens: TokenPropagation, client: HttpClient = http): HttpResponse {
    val first = client.execute(request(tokens.urlFor(ref.url), ref, context))
    if (first.status !in AUTH_STATUS || tokens.active) return first
    val propagated = tokens.alternativeFor(ref.url) ?: return first
    first.close()
    val second = client.execute(request(propagated, ref, context))
    if (second.status in 200..299) tokens.active = true
    return second
  }

  private fun request(url: String, ref: HlsSegmentRef, context: RequestContext): MediaRequest {
    val start = ref.byteRangeOffset
    val length = ref.byteRangeLength
    return MediaRequest(
      url = url,
      context = context,
      rangeStart = start,
      rangeEnd = if (start != null && length != null) start + length - 1 else null,
    )
  }

  private suspend fun copy(
    raf: RandomAccessFile,
    writeAt: Long,
    input: InputStream,
    skip: Long,
    expected: Long?,
    url: String,
    stripId3: Boolean,
    onTimestamp: (Long) -> Unit,
    onBytes: (Long) -> Unit,
  ): Long {
    // A pause must stop the network now, even mid-read: closing the body unblocks a read waiting on a stalled
    // connection, on its own thread so the pausing thread never waits for the network.
    val onCancel = currentCoroutineContext().job.invokeOnCompletion {
      CLOSERS.execute { runCatching { input.close() } }
    }
    try {
      var toSkip = skip
      val buffer = ByteArray(BUFFER_BYTES)
      while (toSkip > 0) {
        currentCoroutineContext().ensureActive()
        val read = input.read(buffer, 0, minOf(buffer.size.toLong(), toSkip).toInt())
        if (read < 0) throw MediaNetworkException("segment ended before its byte range: ${Redact.url(url)}")
        toSkip -= read
      }
      currentCoroutineContext().ensureActive()
      // [consumed] counts the segment's bytes (what a byte range or Content-Length promises); [onDisk] what was kept.
      var consumed = 0L
      var onDisk = 0L
      diskWrite { raf.seek(writeAt) }
      if (stripId3) {
        // The ID3 tag belongs to the segment, not to the audio stream: read and dropped, its timestamp kept.
        val tag = Id3Tags.read(input)
        consumed += tag.consumed
        tag.timestampUs?.let(onTimestamp)
        if (tag.leftover.isNotEmpty()) {
          diskWrite { raf.write(tag.leftover) }
          consumed += tag.leftover.size
          onDisk += tag.leftover.size
        }
      }
      while (expected == null || consumed < expected) {
        currentCoroutineContext().ensureActive()
        val want = if (expected == null) buffer.size else minOf(buffer.size.toLong(), expected - consumed).toInt()
        val read = input.read(buffer, 0, want)
        if (read < 0) break
        diskWrite { raf.write(buffer, 0, read) }
        consumed += read
        onDisk += read
        onBytes(writeAt + onDisk)
      }
      if (expected != null && consumed < expected) {
        throw MediaNetworkException("truncated segment ${Redact.url(url)}: $consumed/$expected")
      }
      if (onDisk == 0L) throw MediaNetworkException("empty segment ${Redact.url(url)}")
      return writeAt + onDisk
    } catch (io: IOException) {
      // A stream closed by the cancellation above is a pause, not a transport failure.
      currentCoroutineContext().ensureActive()
      // A full disk is not a network problem: waiting and retrying the connection would never fix it.
      if (io is MediaNetworkException || io is MediaHttpException || io is MediaRefusedException || io is StorageWriteException) {
        throw io
      }
      throw MediaNetworkException("segment transfer of ${Redact.url(url)} interrupted", io)
    } finally {
      onCancel.dispose()
    }
  }

  /** Reads what was just written and decides the real container; refuses a stream the product cannot keep. */
  private fun confirmContainer(raf: RandomAccessFile, plan: HlsPlan, role: TrackRole): Container {
    val head = ByteArray(minOf(raf.length(), SNIFF_BYTES.toLong()).toInt())
    raf.seek(0)
    raf.readFully(head)
    val container = HlsSegmentFormat.containerOf(head)
      ?: throw MediaRefusedException(
        if (role == TrackRole.AUDIO) ProbeFailure.AUDIO_TRACK_MISSING else ProbeFailure.UNSUPPORTED_FORMAT,
        HlsSegmentFormat.refusal(head),
      )
    if (container == Container.MP4) {
      if (plan.inits.isEmpty()) {
        throw MediaRefusedException(ProbeFailure.UNSUPPORTED_FORMAT, "fMP4 segments without an init section")
      }
      if (plan.inits.size > 1 || plan.hasDiscontinuities) {
        throw MediaRefusedException(ProbeFailure.UNSUPPORTED_FORMAT, "fMP4 stream changes format mid-way")
      }
    }
    return container
  }

  /** Duration-weighted extrapolation from the segments already on disk; the plan's bitrate estimate before that. */
  private fun estimateTotal(bytes: Long, doneDurationUs: Long, plan: HlsPlan): Long? {
    val total = when {
      doneDurationUs > 0 && plan.durationUs > 0 && bytes > 0 ->
        (bytes.toDouble() * plan.durationUs / doneDurationUs).toLong()
      else -> plan.estimatedBytes
    } ?: return null
    return maxOf(total, bytes + 1)
  }

  /** Remembers whether this stream's children need the playlist's query appended. */
  private class TokenPropagation(private val playlistUrl: String) {
    @Volatile var active = false

    fun urlFor(url: String): String = if (active) HlsPlanner.withParentQuery(url, playlistUrl) ?: url else url

    fun alternativeFor(url: String): String? = HlsPlanner.withParentQuery(url, playlistUrl)
  }

  private companion object {
    const val BUFFER_BYTES = 64 * 1024
    const val SNIFF_BYTES = 64 * 1024
    const val PEEK_BYTES = 16L
    const val MAX_CONNECTIONS = 4
    val AUTH_STATUS = setOf(401, 403)

    /** Daemon threads: aborting a socket read must not keep the process alive or block a caller. */
    val CLOSERS: ExecutorService = Executors.newCachedThreadPool { runnable ->
      Thread(runnable, "vidorax-hls-close").apply { isDaemon = true }
    }
  }
}

/**
 * Segments fetched ahead, each in its own file beside the track's `.part` (`download.part.seg12`; `.tmp` while it is
 * being written, so a file without the suffix is always a whole segment).
 */
internal object SegmentFiles {
  fun fileFor(partFile: File, index: Int): File = File(partFile.parentFile, "${partFile.name}$SUFFIX$index")

  fun partialFor(file: File): File = File(file.path + PARTIAL)

  /**
   * Before a run: removes half-written files, and whole ones that are already in the `.part` (index below
   * [keepFrom]) or belong to no checkpoint ([keepFrom] null: a new stream, or segments fetched one by one).
   */
  fun prepare(partFile: File, keepFrom: Int?) {
    val prefix = partFile.name + SUFFIX
    partFile.parentFile?.listFiles()?.forEach { file ->
      if (!file.name.startsWith(prefix)) return@forEach
      val index = file.name.removePrefix(prefix).toIntOrNull()
      if (keepFrom == null || index == null || index < keepFrom) file.delete()
    }
  }

  /** Removes the half-written ones (a run that stopped). */
  fun deletePartial(partFile: File) {
    val prefix = partFile.name + SUFFIX
    partFile.parentFile?.listFiles()?.forEach { if (it.name.startsWith(prefix) && it.name.endsWith(PARTIAL)) it.delete() }
  }

  /** The file starts as HLS packed audio (an ID3-tagged ADTS/MP3 segment). */
  fun isPackedAudio(file: File): Boolean = runCatching {
    FileInputStream(file).use { input ->
      val head = ByteArray(16)
      var got = 0
      while (got < head.size) {
        val read = input.read(head, got, head.size - got)
        if (read < 0) break
        got += read
      }
      HlsSegmentFormat.isPackedAudio(head.copyOf(got))
    }
  }.getOrDefault(false)

  private const val SUFFIX = ".seg"
  private const val PARTIAL = ".tmp"
}

/**
 * The ID3v2 tag HLS packed audio puts at the start of every segment. Its `PRIV` frame
 * `com.apple.streaming.transportStreamTimestamp` holds the MPEG-TS presentation time of the segment's first audio
 * frame (33 bits, 90 kHz) — what ties an audio rendition to the video's timeline.
 */
internal object Id3Tags {
  class Tag(
    /** Bytes of the tag read from the stream (header + body); 0 when the stream does not start with one. */
    val consumed: Long,
    val timestampUs: Long?,
    /** Bytes read that turned out not to be a tag: they belong to the stream and must be kept. */
    val leftover: ByteArray,
  )

  private const val OWNER = "com.apple.streaming.transportStreamTimestamp"
  private const val MAX_TAG_BYTES = 1 shl 20

  fun read(input: InputStream): Tag {
    val header = ByteArray(10)
    val got = readFully(input, header)
    if (got < 10 || header[0] != 'I'.code.toByte() || header[1] != 'D'.code.toByte() || header[2] != '3'.code.toByte()) {
      return Tag(0, null, header.copyOf(got))
    }
    val version = header[3].toInt()
    val size = syncsafe(header, 6)
    if (size < 0 || size > MAX_TAG_BYTES) throw MediaNetworkException("oversized ID3 tag in a packed-audio segment")
    val body = ByteArray(size)
    if (readFully(input, body) < size) throw MediaNetworkException("packed-audio segment ended inside its ID3 tag")
    return Tag(10L + size, timestamp(body, version), ByteArray(0))
  }

  /** The PRIV transport-stream timestamp in µs, or null when the tag carries none. */
  fun timestamp(body: ByteArray, version: Int): Long? {
    var at = 0
    while (at + 10 <= body.size) {
      val id = String(body, at, 4, Charsets.ISO_8859_1)
      if (id[0] == '\u0000') return null // padding
      val frameSize = if (version >= 4) syncsafe(body, at + 4) else u32(body, at + 4)
      val start = at + 10
      if (frameSize < 0 || start + frameSize > body.size) return null
      if (id == "PRIV" && frameSize >= OWNER.length + 1 + 8) {
        val owner = String(body, start, OWNER.length, Charsets.ISO_8859_1)
        if (owner == OWNER && body[start + OWNER.length] == 0.toByte()) {
          var pts = 0L
          for (i in 0 until 8) pts = (pts shl 8) or (body[start + OWNER.length + 1 + i].toLong() and 0xFF)
          pts = pts and 0x1FFFFFFFFL
          return pts * 100 / 9
        }
      }
      at = start + frameSize
    }
    return null
  }

  private fun readFully(input: InputStream, into: ByteArray): Int {
    var total = 0
    while (total < into.size) {
      val read = input.read(into, total, into.size - total)
      if (read < 0) break
      total += read
    }
    return total
  }

  private fun syncsafe(data: ByteArray, at: Int): Int =
    ((data[at].toInt() and 0x7F) shl 21) or ((data[at + 1].toInt() and 0x7F) shl 14) or
      ((data[at + 2].toInt() and 0x7F) shl 7) or (data[at + 3].toInt() and 0x7F)

  private fun u32(data: ByteArray, at: Int): Int =
    ((data[at].toInt() and 0xFF) shl 24) or ((data[at + 1].toInt() and 0xFF) shl 16) or
      ((data[at + 2].toInt() and 0xFF) shl 8) or (data[at + 3].toInt() and 0xFF)
}
