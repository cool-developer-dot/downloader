package com.vidorax.media.transfer

import com.vidorax.media.model.Container
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.wireValueOf
import com.vidorax.media.net.MediaHttpException
import com.vidorax.media.net.MediaNetworkException
import com.vidorax.media.net.MediaRefusedException
import com.vidorax.media.net.Redact
import com.vidorax.media.plan.HlsSegmentFormat
import com.vidorax.media.plan.HlsSegmentRef
import com.vidorax.media.plan.LiveSegment
import com.vidorax.media.plan.LiveWindow
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** F6: the segment I/O a recording needs — [HlsTransfer]'s, with its token handling and the speed limit. */
internal interface LiveSegmentIo {
  /** Fetches [ref] and appends exactly its bytes at [writeAt]; returns the new end. */
  suspend fun append(raf: RandomAccessFile, writeAt: Long, ref: HlsSegmentRef, onBytes: (Long) -> Unit): Long

  /** Fetches [ref] whole into [file] ahead of its turn (F1's fetch-ahead); returns the file. */
  suspend fun fetch(ref: HlsSegmentRef, file: File): File

  /** Appends a file [fetch] made; returns the new end. */
  suspend fun appendFetched(raf: RandomAccessFile, writeAt: Long, file: File, url: String, onBytes: (Long) -> Unit): Long
}

/** F6: what a recording asks of the world. Fakes in tests drive the playlist, the clock and the disk. */
internal interface LiveRecordHost {
  /** The live media playlist now. Throws [IOException]s like a transfer. */
  suspend fun window(): LiveWindow

  fun now(): Long

  fun freeBytes(): Long

  /** The user pressed Stop. */
  val stopRequested: Boolean

  /** Waits [ms] (less when Stop is pressed); true when it returns because of Stop. */
  suspend fun pause(ms: Long): Boolean
}

/** F6: why a recording ended. Every reason finalizes what was recorded. */
internal enum class LiveStopReason(val wire: String) {
  STOPPED("stopped"),
  ENDED("ended"),
  MAX_DURATION("max_duration"),
  LOW_STORAGE("low_storage"),
  /** No new segment for [LiveHlsRecorder.stallLimitMs] (the stream paused, or the network is gone). */
  STALLED("stalled"),
  /** fMP4 init section changed mid-stream: what came before is kept. */
  FORMAT_CHANGED("format_changed"),
}

internal data class LiveRecordSpec(
  val partFile: File,
  val checkpointFile: File,
  /** Settings → "Live recording (beta)" maximum length. */
  val maxDurationUs: Long,
  /** Settings → "Connections per file": segments fetched at once when the recording catches up. */
  val connections: Int = 1,
)

internal data class LiveRecordOutcome(
  val bytesWritten: Long,
  val container: Container,
  val recordedUs: Long,
  val reason: LiveStopReason,
  /** The stream's timeline restarted (`EXT-X-DISCONTINUITY` inside the recording). */
  val hasDiscontinuities: Boolean,
  /** Segments that left the window (or 404'd) before they were fetched. */
  val missedSegments: Long,
)

/**
 * F6: a recording's durable state, beside its `.part`. Written only after the segment it describes is synced, like
 * [HlsCheckpoint]; no URL or token in it — [initKey] is a hash of the init section's address without its query.
 */
internal data class LiveCheckpoint(
  val lastSequence: Long? = null,
  val partBytes: Long = 0,
  val recordedUs: Long = 0,
  val container: Container? = null,
  val continuity: Map<Int, Int>? = null,
  val firstDiscontinuity: Long? = null,
  val hasDiscontinuities: Boolean = false,
  val missedSegments: Long = 0,
  val initKey: String? = null,
) {
  companion object {
    fun read(file: File): LiveCheckpoint? = runCatching {
      if (!file.isFile) return null
      val json = JSONObject(file.readText())
      LiveCheckpoint(
        lastSequence = if (json.has("lastSequence")) json.getLong("lastSequence") else null,
        partBytes = json.getLong("partBytes"),
        recordedUs = json.getLong("recordedUs"),
        container = json.optString("container").takeIf { it.isNotEmpty() }?.let { wireValueOf<Container>(it) },
        continuity = json.optJSONObject("continuity")?.let { cc ->
          cc.keys().asSequence().associate { pid -> pid.toInt() to cc.getInt(pid) }
        },
        firstDiscontinuity = if (json.has("firstDiscontinuity")) json.getLong("firstDiscontinuity") else null,
        hasDiscontinuities = json.optBoolean("hasDiscontinuities", false),
        missedSegments = json.optLong("missedSegments", 0),
        initKey = json.optString("initKey").takeIf { it.isNotEmpty() },
      )
    }.getOrNull()

    /** Atomic: a crash leaves the previous checkpoint or this one. */
    fun write(file: File, checkpoint: LiveCheckpoint) {
      val json = JSONObject()
        .put("partBytes", checkpoint.partBytes)
        .put("recordedUs", checkpoint.recordedUs)
        .put("hasDiscontinuities", checkpoint.hasDiscontinuities)
        .put("missedSegments", checkpoint.missedSegments)
      checkpoint.lastSequence?.let { json.put("lastSequence", it) }
      checkpoint.container?.let { json.put("container", it.wire) }
      checkpoint.firstDiscontinuity?.let { json.put("firstDiscontinuity", it) }
      checkpoint.initKey?.let { json.put("initKey", it) }
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
 * F6: records a live HLS media playlist into one file.
 *
 * - Starts at the live edge ([LIVE_EDGE_SEGMENTS] segments back), then reloads the playlist every target duration
 *   (half of it when nothing new came — RFC 8216 §6.3.4) and appends every segment newer than the last one, by media
 *   sequence, in order. MPEG-TS joins are renumbered ([TsContinuity]); an fMP4 init section is written once.
 * - Segments that left the window before they were fetched (or answer 404/410) are counted as missed and skipped; a
 *   discontinuity is recorded as one (the finished file is then kept as the transport stream it is, like a VOD with
 *   discontinuities). Transport failures and transient HTTP errors are waited out — reloading the playlist — until
 *   nothing new has arrived for [stallLimitMs].
 * - Ends on Stop, `EXT-X-ENDLIST`, the maximum length, too little room left to finalize ([LIVE_FREE_MARGIN_BYTES]
 *   beyond what is recorded: the MP4 copy needs about as much again), a stall, or an fMP4 format change — and always
 *   leaves a `.part` and a checkpoint that describe exactly the segments in it, so a process death finalizes them.
 */
internal class LiveHlsRecorder(private val io: LiveSegmentIo) {
  suspend fun record(
    spec: LiveRecordSpec,
    host: LiveRecordHost,
    onProgress: (bytes: Long, recordedUs: Long) -> Unit = { _, _ -> },
  ): LiveRecordOutcome = withContext(Dispatchers.IO) {
    spec.partFile.parentFile?.mkdirs()
    val saved = LiveCheckpoint.read(spec.checkpointFile)?.takeIf {
      it.partBytes >= 0 && it.partBytes <= (if (spec.partFile.isFile) spec.partFile.length() else 0L)
    }
    RandomAccessFile(spec.partFile, "rw").use { raf ->
      Session(spec, host, raf, saved ?: LiveCheckpoint(), onProgress).run()
    }
  }

  private inner class Session(
    private val spec: LiveRecordSpec,
    private val host: LiveRecordHost,
    private val raf: RandomAccessFile,
    private var cp: LiveCheckpoint,
    private val onProgress: (Long, Long) -> Unit,
  ) {
    private val continuity = TsContinuity(cp.continuity ?: emptyMap())
    private var targetUs = DEFAULT_TARGET_US
    private var lastNewAt = host.now()

    suspend fun run(): LiveRecordOutcome {
      raf.setLength(cp.partBytes)
      while (true) {
        currentCoroutineContext().ensureActive()
        stopReasonBeforeSegment()?.let { return finish(it) }
        val window = try {
          host.window()
        } catch (e: CancellationException) {
          throw e
        } catch (e: MediaRefusedException) {
          throw e
        } catch (e: IOException) {
          if (stalled()) return finish(LiveStopReason.STALLED)
          if (host.pause(targetUs / 2000)) return finish(LiveStopReason.STOPPED)
          continue
        }
        targetUs = window.targetDurationUs
        val last = cp.lastSequence
        val fresh = if (last == null) window.segments.takeLast(LIVE_EDGE_SEGMENTS) else window.segments.filter { it.sequence > last }
        val appended = appendAll(fresh)
        appended.stop?.let { return finish(it) }
        if (window.ended && !appended.interrupted) return finish(LiveStopReason.ENDED)
        if (appended.count == 0 && stalled()) return finish(LiveStopReason.STALLED)
        // A playlist that brought nothing new is asked again after half a target duration.
        val waitMs = if (appended.count > 0) targetUs / 1000 else targetUs / 2000
        if (host.pause(waitMs)) return finish(LiveStopReason.STOPPED)
      }
    }

    /** Appends [fresh] in order, the next ones fetched ahead while the current one is written. */
    private suspend fun appendAll(fresh: List<LiveSegment>): Appended = coroutineScope {
      val ahead = HashMap<Long, Deferred<Result<File>>>()
      val window = spec.connections.coerceIn(1, MAX_CONNECTIONS)
      var count = 0
      try {
        for ((index, segment) in fresh.withIndex()) {
          stopReasonBeforeSegment()?.let { return@coroutineScope Appended(count, true, it) }
          for (next in fresh.subList(index + 1, minOf(fresh.size, index + window))) {
            if (next.sequence in ahead || next.init != null) continue
            val file = aheadFile(next.sequence)
            ahead[next.sequence] = async(Dispatchers.IO) {
              try {
                Result.success(io.fetch(next.media, file))
              } catch (c: CancellationException) {
                throw c
              } catch (e: Throwable) {
                file.delete()
                Result.failure(e)
              }
            }
          }
          val fetched = ahead.remove(segment.sequence)?.await()?.getOrNull()
          when (val result = appendOne(segment, fetched)) {
            SegmentResult.WRITTEN -> count++
            SegmentResult.MISSED -> Unit
            SegmentResult.RETRY_LATER -> return@coroutineScope Appended(count, true, null)
            SegmentResult.LOW_STORAGE -> return@coroutineScope Appended(count, true, LiveStopReason.LOW_STORAGE)
            SegmentResult.FORMAT_CHANGED -> return@coroutineScope Appended(count, true, LiveStopReason.FORMAT_CHANGED)
          }
        }
        Appended(count, false, null)
      } finally {
        ahead.values.forEach { it.cancel() }
        spec.partFile.parentFile?.listFiles()?.forEach { if (it.name.startsWith("${spec.partFile.name}$AHEAD_SUFFIX")) it.delete() }
      }
    }

    private suspend fun appendOne(segment: LiveSegment, fetched: File?): SegmentResult {
      val expected = cp.lastSequence?.plus(1)
      val missedBefore = if (expected != null && segment.sequence > expected) segment.sequence - expected else 0L
      val start = cp.partBytes
      var at = start
      val initKey = segment.init?.let { keyOf(it) }
      val report = { bytes: Long -> onProgress(bytes, cp.recordedUs) }
      try {
        if (initKey != null && initKey != cp.initKey) {
          // One init section per file: a stream that switches format mid-way keeps what came before.
          if (cp.initKey != null) return SegmentResult.FORMAT_CHANGED
          at = io.append(raf, at, checkNotNull(segment.init), report)
        }
        val mediaStart = at
        at = if (fetched != null) {
          io.appendFetched(raf, at, fetched, segment.media.url, report).also { fetched.delete() }
        } else {
          io.append(raf, at, segment.media, report)
        }
        val container = cp.container ?: confirmContainer()
        if (container == Container.TS) continuity.renumber(raf, start, at)
        if (container == Container.MP4) Fmp4Index.neutralizeSegmentIndexes(raf, mediaStart, at)
        raf.fd.sync()
        val first = cp.firstDiscontinuity ?: segment.discontinuity
        cp = cp.copy(
          lastSequence = segment.sequence,
          partBytes = at,
          recordedUs = cp.recordedUs + segment.durationUs,
          container = container,
          continuity = if (container == Container.TS) continuity.state else null,
          firstDiscontinuity = first,
          hasDiscontinuities = cp.hasDiscontinuities || segment.discontinuity != first,
          missedSegments = cp.missedSegments + missedBefore,
          initKey = initKey ?: cp.initKey,
        )
        LiveCheckpoint.write(spec.checkpointFile, cp)
        lastNewAt = host.now()
        onProgress(cp.partBytes, cp.recordedUs)
        return SegmentResult.WRITTEN
      } catch (e: CancellationException) {
        raf.setLength(start)
        throw e
      } catch (e: StorageWriteException) {
        raf.setLength(start)
        return SegmentResult.LOW_STORAGE
      } catch (e: MediaHttpException) {
        raf.setLength(start)
        if (e.statusCode == 404 || e.statusCode == 410) {
          // Gone from the server before it was fetched: missed, not fatal.
          cp = cp.copy(lastSequence = segment.sequence, missedSegments = cp.missedSegments + missedBefore + 1)
          LiveCheckpoint.write(spec.checkpointFile, cp)
          return SegmentResult.MISSED
        }
        return SegmentResult.RETRY_LATER
      } catch (e: MediaNetworkException) {
        raf.setLength(start)
        return SegmentResult.RETRY_LATER
      }
    }

    /** The first data decides the container; anything but MPEG-TS or fMP4 with a picture is refused. */
    private fun confirmContainer(): Container {
      val head = ByteArray(minOf(raf.length(), SNIFF_BYTES.toLong()).toInt())
      raf.seek(0)
      raf.readFully(head)
      if (HlsSegmentFormat.isPackedAudio(head)) {
        throw MediaRefusedException(ProbeFailure.UNSUPPORTED_FORMAT, "audio-only live stream (packed audio)")
      }
      return HlsSegmentFormat.containerOf(head)
        ?: throw MediaRefusedException(ProbeFailure.UNSUPPORTED_FORMAT, HlsSegmentFormat.refusal(head))
    }

    private fun stopReasonBeforeSegment(): LiveStopReason? = when {
      host.stopRequested -> LiveStopReason.STOPPED
      cp.recordedUs >= spec.maxDurationUs -> LiveStopReason.MAX_DURATION
      host.freeBytes() < cp.partBytes + LIVE_FREE_MARGIN_BYTES -> LiveStopReason.LOW_STORAGE
      else -> null
    }

    private fun stalled(): Boolean = host.now() - lastNewAt > stallLimitMs(targetUs)

    private fun finish(reason: LiveStopReason) = LiveRecordOutcome(
      bytesWritten = cp.partBytes,
      container = cp.container ?: Container.TS,
      recordedUs = cp.recordedUs,
      reason = reason,
      hasDiscontinuities = cp.hasDiscontinuities,
      missedSegments = cp.missedSegments,
    )

    private fun aheadFile(sequence: Long) = File(spec.partFile.parentFile, "${spec.partFile.name}$AHEAD_SUFFIX$sequence")
  }

  private enum class SegmentResult { WRITTEN, MISSED, RETRY_LATER, LOW_STORAGE, FORMAT_CHANGED }

  /** One pass over a playlist's new segments: how many were written, whether it stopped early, and why. */
  private class Appended(val count: Int, val interrupted: Boolean, val stop: LiveStopReason?)

  private fun keyOf(ref: HlsSegmentRef): String {
    val text = "${Redact.url(ref.url)}#${ref.byteRangeOffset}+${ref.byteRangeLength}"
    return MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).take(12).joinToString("") { "%02x".format(it) }
  }

  companion object {
    /** Where a recording starts: this many segments before the live edge (what a player buffers). */
    const val LIVE_EDGE_SEGMENTS = 3

    /** Room kept beyond what is recorded: finalizing writes an MP4 about as large again. */
    const val LIVE_FREE_MARGIN_BYTES = 64L * 1024 * 1024

    /** No new segment for this long (at least, or three target durations) ends the recording. */
    const val STALL_MIN_MS = 30_000L
    private const val STALL_TARGETS = 3

    private const val DEFAULT_TARGET_US = 6_000_000L
    private const val MAX_CONNECTIONS = 4
    private const val SNIFF_BYTES = 64 * 1024
    private const val AHEAD_SUFFIX = ".live"

    fun stallLimitMs(targetUs: Long): Long = maxOf(STALL_MIN_MS, STALL_TARGETS * targetUs / 1000)
  }
}
