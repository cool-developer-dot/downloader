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
import java.io.IOException
import java.io.InputStream
import java.io.RandomAccessFile
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlinx.coroutines.Dispatchers
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
 * - MPEG-TS segments are concatenated byte for byte. fMP4 writes its init section once (again only if the
 *   playlist switches init sections) followed by every media segment. Nothing is decrypted, remuxed or reordered.
 * - Segment by segment: after each one the `.part` is synced and the checkpoint advanced. A pause, a crash or a
 *   dropped connection resumes at the first segment not in the checkpoint; any bytes of a half-written segment are
 *   cut off first, so a segment is never written twice.
 * - Every request carries the download's User-Agent, Referer, Origin and cookies; `EXT-X-BYTERANGE` segments are
 *   fetched as exact ranges. A child URL that answers 401/403 without a query of its own is retried once with the
 *   playlist's query (token propagation), and that choice then sticks for the rest of the run.
 * - Failures keep their meaning: transport errors and truncated segments are [MediaNetworkException] (resume),
 *   HTTP statuses are [MediaHttpException] (the engine decides: expired link, missing, or transient), a write the
 *   disk refused is [StorageWriteException] (or a plain `IOException` from the file's own bookkeeping), and a
 *   stream that turns out to be something the product refuses is [MediaRefusedException].
 */
internal class HlsTransfer(private val http: HttpClient) {
  suspend fun transfer(
    spec: HlsTransferSpec,
    onProgress: (bytesDone: Long, totalBytes: Long?) -> Unit = { _, _ -> },
  ): HlsTransferOutcome = withContext(Dispatchers.IO) { download(spec, onProgress) }

  private suspend fun download(spec: HlsTransferSpec, onProgress: (Long, Long?) -> Unit): HlsTransferOutcome {
    val plan = spec.plan
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
    val durations = LongArray(plan.segments.size + 1).also { sums ->
      for (i in plan.segments.indices) sums[i + 1] = sums[i] + plan.segments[i].durationUs
    }
    val tokenPropagation = TokenPropagation(plan.mediaPlaylistUrl)

    // Never touch the `.part` once this worker has been superseded (pause, cancel, a newer run).
    currentCoroutineContext().ensureActive()
    RandomAccessFile(spec.partFile, "rw").use { raf ->
      // Whatever lies past the checkpoint is a segment that never completed: drop it before writing again.
      raf.setLength(offset)
      if (saved == null) spec.checkpointFile.delete()

      while (completed < plan.segments.size) {
        currentCoroutineContext().ensureActive()
        val segment = plan.segments[completed]
        var writeAt = offset
        // Extrapolated from whole segments only: a half-received segment would inflate bytes-per-second of media.
        val wholeSegmentsTotal = estimateTotal(offset, durations[completed], plan)
        val estimate = { bytes: Long -> wholeSegmentsTotal?.let { maxOf(it, bytes + 1) } }

        val initIndex = segment.initIndex
        if (initIndex != null && initIndex != lastInit) {
          writeAt = append(raf, writeAt, plan.inits[initIndex], spec.context, tokenPropagation, stripId3 = false) { bytes ->
            onProgress(bytes, estimate(bytes))
          }
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
        if (container == null && completed == 0 && spec.role == TrackRole.AUDIO && initIndex == null) {
          packedAudio = startsAsPackedAudio(segment.media, spec.context, tokenPropagation)
        }
        val mediaStart = writeAt
        writeAt = append(
          raf,
          writeAt,
          segment.media,
          spec.context,
          tokenPropagation,
          stripId3 = packedAudio,
          onTimestamp = { if (timestampUs == null) timestampUs = it },
        ) { bytes ->
          onProgress(bytes, estimate(bytes))
        }
        if (container == null) container = if (packedAudio) Container.UNKNOWN else confirmContainer(raf, plan, spec.role)
        // A segment's own index describes that segment alone; in one file it would mislead the player.
        if (container == Container.MP4) Fmp4Index.neutralizeSegmentIndexes(raf, mediaStart, writeAt)
        raf.fd.sync()

        completed += 1
        offset = writeAt
        if (initIndex != null) lastInit = initIndex
        HlsCheckpoint.write(
          spec.checkpointFile,
          HlsCheckpoint(plan.fingerprint, completed, offset, lastInit, container, indexOffset, indexSize, packedAudio, timestampUs),
        )
        val total = if (completed == plan.segments.size) offset else estimateTotal(offset, durations[completed], plan)
        onProgress(offset, total)
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
    return HlsTransferOutcome(
      bytesWritten = offset,
      container = container ?: plan.containerHint,
      packedAudio = packedAudio,
      timestampUs = timestampUs,
    )
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
      val status = it.status
      val rangeStart = ref.byteRangeOffset
      val skip: Long = when {
        status == 206 && rangeStart != null -> {
          if (it.contentRange?.start != rangeStart) {
            throw MediaNetworkException("misaligned range for ${Redact.url(ref.url)}")
          }
          0L
        }
        // The server ignored Range: the sub-range starts inside this full body.
        status == 200 && rangeStart != null -> rangeStart
        status == 200 -> 0L
        status == 206 && it.contentRange?.start == 0L -> 0L
        else -> throw MediaHttpException.of(status, ref.url)
      }
      val expected: Long? = ref.byteRangeLength ?: it.contentLength.takeIf { status == 200 }
      return copy(raf, writeAt, it.byteStream(), skip, expected, ref.url, stripId3, onTimestamp, onBytes)
    }
  }

  private fun open(ref: HlsSegmentRef, context: RequestContext, tokens: TokenPropagation): HttpResponse {
    val first = http.execute(request(tokens.urlFor(ref.url), ref, context))
    if (first.status !in AUTH_STATUS || tokens.active) return first
    val propagated = tokens.alternativeFor(ref.url) ?: return first
    first.close()
    val second = http.execute(request(propagated, ref, context))
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
    val AUTH_STATUS = setOf(401, 403)

    /** Daemon threads: aborting a socket read must not keep the process alive or block a caller. */
    val CLOSERS: ExecutorService = Executors.newCachedThreadPool { runnable ->
      Thread(runnable, "vidorax-hls-close").apply { isDaemon = true }
    }
  }
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
