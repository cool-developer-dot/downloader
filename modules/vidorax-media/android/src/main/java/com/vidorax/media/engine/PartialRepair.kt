package com.vidorax.media.engine

import com.vidorax.media.model.Container
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.SourceKind
import com.vidorax.media.net.HttpClient
import com.vidorax.media.net.MediaRequest
import com.vidorax.media.plan.DashResolution
import com.vidorax.media.plan.DashTrack
import com.vidorax.media.plan.DashTrackSource
import com.vidorax.media.plan.HlsPlan
import com.vidorax.media.plan.HlsPlanResult
import com.vidorax.media.plan.HlsSegmentRef
import com.vidorax.media.transfer.Fmp4Index
import com.vidorax.media.transfer.HlsCheckpoint
import com.vidorax.media.transfer.ResumeValidator
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * H20 Repair Partial File (#412): what a failed download's partial files are worth, checked against the server.
 *
 * - **A whole file** (a progressive download, a split track, a DASH file track): its last bytes are asked for again
 *   (a `Range` request with the `If-Range` validator recorded when its bytes started) and compared. Same bytes and the
 *   same validator: [Verdict.VALID] — Retry continues where it stopped. A changed validator, a `200` for the range
 *   (If-Range no longer matches), a file now shorter than the partial: [Verdict.CHANGED]. Other bytes at the same
 *   place: [Verdict.CORRUPT]. A server that cannot continue the file: [Verdict.NO_RESUME]. Those three restart it from
 *   zero.
 * - **Segments** (HLS, DASH SegmentTemplate): the playlist is read again — another structure is [Verdict.CHANGED] — and
 *   the last checkpointed segment fetched and compared with its bytes in the `.part`. Damaged:
 *   [Verdict.SEGMENT_DAMAGED], the checkpoint steps back one segment, so Retry fetches it again. A `.part` shorter than
 *   its checkpoint is [Verdict.CORRUPT].
 * - Offline, an expired link, a server error: [Verdict.UNREACHABLE] — nothing is changed.
 *
 * Only the download's own work files are ever touched (a `.part`, its validator, done marker and checkpoint), never a
 * finished file. [decideWhole] and [decideSegments] are the pure rules.
 */
/** What Repair did (H20 #412), for JavaScript (`RepairOutcome` in VidoraMedia.types.ts). */
enum class RepairOutcome(val wire: String) {
  /** Every partial checked out: Retry continues where it stopped. */
  RESUMED("resumed"),
  /** The server's file changed: restarted from zero. */
  RESTARTED_CHANGED("restarted_changed"),
  /** The partial was damaged: restarted from zero. */
  RESTARTED_CORRUPT("restarted_corrupt"),
  /** The server cannot continue the file: restarted from zero. */
  RESTARTED_NO_RESUME("restarted_no_resume"),
  /** A damaged last segment is fetched again; the rest continues. */
  SEGMENT_REFETCHED("segment_refetched"),
  /** The server could not be asked now (offline, an expired link): nothing changed. */
  UNREACHABLE("unreachable"),
  /** No partial file to repair: nothing changed. */
  NOTHING("nothing"),
}

internal object PartialRepair {
  enum class Verdict { VALID, CHANGED, CORRUPT, NO_RESUME, SEGMENT_DAMAGED, UNREACHABLE }

  /** How many bytes of a whole file's end are compared. */
  const val TAIL_BYTES = 64L * 1024

  /** A last segment longer than this is not fetched to compare (the checkpoint is trusted as it is). */
  const val MAX_SEGMENT_BYTES = 64L * 1024 * 1024

  /** The server's answer to the tail request; [status] null = no answer (offline). */
  data class TailAnswer(
    val status: Int?,
    val rangeStart: Long? = null,
    val rangeTotal: Long? = null,
    val validator: String? = null,
    /** 206 aligned with the request only: whether its bytes equal the `.part`'s. */
    val bytesMatch: Boolean? = null,
  )

  fun decideWhole(partBytes: Long, requestedStart: Long, storedValidator: String?, answer: TailAnswer): Verdict {
    val status = answer.status ?: return Verdict.UNREACHABLE
    return when {
      status == 200 -> if (storedValidator != null) Verdict.CHANGED else Verdict.NO_RESUME
      status == 416 -> Verdict.CHANGED
      status == 206 -> when {
        answer.rangeStart != requestedStart -> Verdict.NO_RESUME
        answer.rangeTotal != null && answer.rangeTotal < partBytes -> Verdict.CHANGED
        storedValidator != null && answer.validator != null && !sameValidator(storedValidator, answer.validator) ->
          Verdict.CHANGED
        answer.bytesMatch == false -> Verdict.CORRUPT
        answer.bytesMatch == true -> Verdict.VALID
        else -> Verdict.UNREACHABLE
      }
      else -> Verdict.UNREACHABLE // 401/403/404/410 (a link that needs refreshing), 5xx, 429…
    }
  }

  /** Facts about one segment track; see [decideSegments]. */
  data class SegmentFacts(
    val checkpoint: HlsCheckpoint?,
    val partLength: Long,
    /** The fingerprint of the playlist as it is now; null when it could not be read. */
    val planFingerprint: String?,
    /** The last checkpointed segment fetched again: its length and whether it equals the `.part`; null = no answer. */
    val lastSegmentLength: Long?,
    val lastSegmentMatches: Boolean?,
  )

  fun decideSegments(facts: SegmentFacts): Verdict {
    val checkpoint = facts.checkpoint ?: return Verdict.VALID // nothing durable yet: Retry starts the track cleanly
    if (checkpoint.completed <= 0) return Verdict.VALID
    if (facts.partLength < checkpoint.partBytes) return Verdict.CORRUPT
    val fingerprint = facts.planFingerprint ?: return Verdict.UNREACHABLE
    if (fingerprint != checkpoint.fingerprint) return Verdict.CHANGED
    // Packed audio is written without its ID3 tags: its bytes cannot be compared, and the checkpoint is trusted.
    if (checkpoint.packedAudio) return Verdict.VALID
    val length = facts.lastSegmentLength ?: return Verdict.UNREACHABLE
    if (length > checkpoint.partBytes) return Verdict.CORRUPT
    return when (facts.lastSegmentMatches) {
      true -> Verdict.VALID
      false -> Verdict.SEGMENT_DAMAGED
      null -> Verdict.UNREACHABLE
    }
  }

  /** The outcome of every track's verdict: one that cannot be checked leaves everything as it was. */
  fun outcomeOf(verdicts: Collection<Verdict>): RepairOutcome = when {
    verdicts.isEmpty() -> RepairOutcome.NOTHING
    Verdict.UNREACHABLE in verdicts -> RepairOutcome.UNREACHABLE
    Verdict.CHANGED in verdicts -> RepairOutcome.RESTARTED_CHANGED
    Verdict.CORRUPT in verdicts -> RepairOutcome.RESTARTED_CORRUPT
    Verdict.NO_RESUME in verdicts -> RepairOutcome.RESTARTED_NO_RESUME
    Verdict.SEGMENT_DAMAGED in verdicts -> RepairOutcome.SEGMENT_REFETCHED
    else -> RepairOutcome.RESUMED
  }

  /** ETags compared as entity-tags (an unquoted one equals its quoted form); a date exactly. */
  fun sameValidator(a: String, b: String): Boolean = unquote(a.trim()) == unquote(b.trim())

  private fun unquote(value: String): String = value.removePrefix("\"").removeSuffix("\"")

  /** The partial bytes a failed download has in [workDir] (its `.part`s, or their checkpoints); 0 = nothing to repair. */
  fun partialBytes(workDir: File): Long = TRACK_FILES.sumOf { (part, checkpoint) ->
    HlsCheckpoint.read(File(workDir, checkpoint))?.partBytes ?: File(workDir, part).let { if (it.isFile) it.length() else 0L }
  }

  /** The video's and the separate audio's `.part` with its checkpoint (DownloadEngine's work file names). */
  val TRACK_FILES = listOf(
    DownloadEngine.PART_NAME to DownloadEngine.HLS_CHECKPOINT_NAME,
    DownloadEngine.AUDIO_PART_NAME to DownloadEngine.AUDIO_CHECKPOINT_NAME,
  )
}

/** The network side of Repair, injectable so the rules are tested without a server. */
internal interface PartialChecks {
  /** Bytes `[start, start + length)` of [url] as the server has them now (`Range`, with `If-Range` [ifRange]). */
  suspend fun tail(url: String, context: RequestContext, start: Long, length: Long, ifRange: String?, local: ByteArray): PartialRepair.TailAnswer

  /** [ref] fetched into [into] (at most [maxBytes]); its length, or null when the server did not give it. */
  suspend fun segment(ref: HlsSegmentRef, context: RequestContext, into: File, maxBytes: Long): Long?

  companion object {
    /** No network: every check is unreachable, so nothing is ever changed. */
    val NONE = object : PartialChecks {
      override suspend fun tail(url: String, context: RequestContext, start: Long, length: Long, ifRange: String?, local: ByteArray) =
        PartialRepair.TailAnswer(status = null)

      override suspend fun segment(ref: HlsSegmentRef, context: RequestContext, into: File, maxBytes: Long): Long? = null
    }
  }
}

/** [PartialChecks] over the module's HTTP client (public hosts, redirect checks, the download's own headers). */
internal class RealPartialChecks(private val http: HttpClient) : PartialChecks {
  override suspend fun tail(
    url: String,
    context: RequestContext,
    start: Long,
    length: Long,
    ifRange: String?,
    local: ByteArray,
  ): PartialRepair.TailAnswer = withContext(Dispatchers.IO) {
    val response = try {
      http.execute(MediaRequest(url = url, context = context, rangeStart = start, rangeEnd = start + length - 1, ifRange = ifRange))
    } catch (e: Exception) {
      if (e is kotlinx.coroutines.CancellationException) throw e
      return@withContext PartialRepair.TailAnswer(status = null)
    }
    response.use {
      val range = it.contentRange
      if (it.status != 206 || range == null || range.start != start) {
        return@use PartialRepair.TailAnswer(it.status, range?.start, range?.total, it.validator)
      }
      val remote = try {
        it.readBounded(length.toInt())
      } catch (e: IOException) {
        return@use PartialRepair.TailAnswer(status = null)
      }
      PartialRepair.TailAnswer(206, range.start, range.total, it.validator, bytesMatch = remote != null && remote.contentEquals(local))
    }
  }

  override suspend fun segment(ref: HlsSegmentRef, context: RequestContext, into: File, maxBytes: Long): Long? =
    withContext(Dispatchers.IO) {
      val start = ref.byteRangeOffset
      val end = ref.byteRangeLength?.let { (start ?: 0L) + it - 1 }
      val response = try {
        http.execute(MediaRequest(url = ref.url, context = context, rangeStart = start, rangeEnd = end))
      } catch (e: Exception) {
        if (e is kotlinx.coroutines.CancellationException) throw e
        return@withContext null
      }
      response.use {
        val aligned = when {
          start != null -> it.status == 206 && it.contentRange?.start == start
          else -> it.status == 200 || (it.status == 206 && it.contentRange?.start == 0L)
        }
        if (!aligned) return@use null
        try {
          var written = 0L
          var tooLarge = false
          val input = it.byteStream()
          into.outputStream().use { out ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              written += read
              if (written > maxBytes) {
                tooLarge = true
                break
              }
              out.write(buffer, 0, read)
            }
          }
          if (tooLarge) null else written
        } catch (e: IOException) {
          null
        }
      }
    }
}

/**
 * Checks every partial track of a failed download ([PartialRepair]) and says what Retry should start from. Reads only;
 * [Plan.apply] makes the change, under the engine lock, once the download is known to be still failed.
 */
internal class PartialRepairer(
  private val workDirOf: (String) -> File,
  private val hls: HlsDownloads,
  private val dash: DashDownloads,
  private val checks: PartialChecks,
) {
  /** One track of the download: its `.part`, its checkpoint, and how to re-check it. */
  private class Track(val part: File, val checkpoint: File, val verdict: PartialRepair.Verdict, val rollbackTo: HlsCheckpoint?)

  class Plan internal constructor(val outcome: RepairOutcome, private val change: () -> Unit) {
    /** Removes or rolls back the partial files the checks condemned. Only work files of the download. */
    fun apply() = change()
  }

  suspend fun inspect(row: DownloadRow, context: RequestContext): Plan {
    val workDir = workDirOf(row.id)
    val present = PartialRepair.TRACK_FILES
      .map { (part, checkpoint) -> File(workDir, part) to File(workDir, checkpoint) }
      .filter { (part, checkpoint) -> hasBytes(part) || checkpoint.isFile }
    if (present.isEmpty()) return Plan(RepairOutcome.NOTHING) {}

    val sources = TrackSources(row, context)
    val tracks = present.map { (part, checkpoint) ->
      val isAudio = part.name == DownloadEngine.AUDIO_PART_NAME
      if (checkpoint.isFile) {
        checkSegments(part, checkpoint, sources.segmentPlan(isAudio), context)
      } else {
        checkWhole(part, checkpoint, sources.fileUrl(isAudio), context)
      }
    }
    val outcome = PartialRepair.outcomeOf(tracks.map { it.verdict })
    val change: () -> Unit = change@{
      if (outcome == RepairOutcome.UNREACHABLE || outcome == RepairOutcome.NOTHING) return@change
      for (track in tracks) {
        when (track.verdict) {
          PartialRepair.Verdict.CHANGED, PartialRepair.Verdict.CORRUPT, PartialRepair.Verdict.NO_RESUME ->
            discard(workDir, track.part, track.checkpoint)
          PartialRepair.Verdict.SEGMENT_DAMAGED -> track.rollbackTo?.let { HlsCheckpoint.write(track.checkpoint, it) }
          else -> Unit
        }
      }
    }
    return Plan(outcome, change)
  }

  /** Where each track of [row] comes from, resolved once and only when a check needs it. */
  private inner class TrackSources(private val row: DownloadRow, private val context: RequestContext) {
    private var cachedPlan: HlsPlan? = null
    private var dashResolution: DashResolution? = null
    private var hlsTried = false
    private var dashTried = false

    private suspend fun hlsPlan(): HlsPlan? {
      if (!hlsTried) {
        hlsTried = true
        cachedPlan = (runCatching { hls.plan(row.url, context, row.variant) }.getOrNull() as? HlsPlanResult.Ready)?.plan
      }
      return cachedPlan
    }

    private suspend fun dashResolved(): DashResolution? {
      if (!dashTried) {
        dashTried = true
        dashResolution = runCatching { dash.resolve(row.url, context, row.variant) }.getOrNull()
      }
      return dashResolution
    }

    private fun DashTrack.segments(): HlsPlan? = (source as? DashTrackSource.Segments)?.plan

    private fun DashTrack.file(): String? = (source as? DashTrackSource.File)?.url

    suspend fun segmentPlan(audio: Boolean): HlsPlan? = when (row.kind) {
      SourceKind.DASH -> when (val resolved = dashResolved()) {
        is DashResolution.Tracks -> if (audio) resolved.plan.audioTrack?.segments() else resolved.plan.video.segments()
        else -> null
      }
      // An HLS download, or a "file" whose bytes turned out to be a playlist.
      else -> hlsPlan()?.let { if (audio) it.audio else it }
    }

    suspend fun fileUrl(audio: Boolean): String? = when (row.kind) {
      SourceKind.SPLIT -> if (audio) row.audioUrl else row.url
      SourceKind.DASH -> when (val resolved = dashResolved()) {
        is DashResolution.Ready -> if (audio) null else resolved.media.finalUrl
        is DashResolution.Tracks -> if (audio) resolved.plan.audioTrack?.file() else resolved.plan.video.file()
        else -> null
      }
      else -> if (audio) null else row.url
    }
  }

  private suspend fun checkWhole(part: File, checkpoint: File, url: String?, context: RequestContext): Track {
    val length = if (part.isFile) part.length() else 0L
    if (length <= 0L) return Track(part, checkpoint, PartialRepair.Verdict.VALID, null)
    if (url == null) return Track(part, checkpoint, PartialRepair.Verdict.UNREACHABLE, null)
    val tail = minOf(PartialRepair.TAIL_BYTES, length)
    val start = length - tail
    val local = readRange(part, start, tail.toInt()) ?: return Track(part, checkpoint, PartialRepair.Verdict.CORRUPT, null)
    val validator = ResumeValidator.read(part)
    val answer = checks.tail(url, context, start, tail, validator, local)
    return Track(part, checkpoint, PartialRepair.decideWhole(length, start, validator, answer), null)
  }

  private suspend fun checkSegments(part: File, checkpointFile: File, plan: HlsPlan?, context: RequestContext): Track {
    val checkpoint = HlsCheckpoint.read(checkpointFile)
    val partLength = if (part.isFile) part.length() else 0L
    var segmentLength: Long? = null
    var matches: Boolean? = null
    var rollback: HlsCheckpoint? = null
    val last = checkpoint?.takeIf { it.completed > 0 }?.let { plan?.segments?.getOrNull(it.completed - 1) }
    if (checkpoint != null && plan != null && last != null && plan.fingerprint == checkpoint.fingerprint &&
      !checkpoint.packedAudio && partLength >= checkpoint.partBytes
    ) {
      val fetched = File(part.parentFile, "${part.name}.repair")
      try {
        segmentLength = checks.segment(last.media, context, fetched, PartialRepair.MAX_SEGMENT_BYTES)
        val length = segmentLength
        if (length != null && length <= checkpoint.partBytes) {
          // An fMP4 file keeps its segments' own indexes renamed to `free`: compare what the `.part` would hold.
          if (checkpoint.container == Container.MP4) {
            RandomAccessFile(fetched, "rw").use { Fmp4Index.neutralizeSegmentIndexes(it, 0, length) }
          }
          matches = sameBytes(part, checkpoint.partBytes - length, fetched)
          rollback = checkpoint.copy(completed = checkpoint.completed - 1, partBytes = checkpoint.partBytes - length)
        }
      } finally {
        fetched.delete()
      }
    }
    val verdict = PartialRepair.decideSegments(
      PartialRepair.SegmentFacts(checkpoint, partLength, plan?.fingerprint, segmentLength, matches),
    )
    return Track(part, checkpointFile, verdict, rollback)
  }

  private fun hasBytes(file: File) = file.isFile && file.length() > 0

  private fun readRange(file: File, start: Long, length: Int): ByteArray? = runCatching {
    RandomAccessFile(file, "r").use { raf ->
      ByteArray(length).also {
        raf.seek(start)
        raf.readFully(it)
      }
    }
  }.getOrNull()

  /** Whether [file]'s bytes from [offset] equal all of [other]. */
  private fun sameBytes(file: File, offset: Long, other: File): Boolean = runCatching {
    RandomAccessFile(file, "r").use { raf ->
      other.inputStream().use { input ->
        raf.seek(offset)
        val a = ByteArray(64 * 1024)
        val b = ByteArray(64 * 1024)
        var same = true
        while (same) {
          val read = input.read(b)
          if (read < 0) break
          raf.readFully(a, 0, read)
          same = (0 until read).all { a[it] == b[it] }
        }
        same
      }
    }
  }.getOrDefault(false)

  /** Restarts one track from zero: only its own work files, and only inside the download's work folder. */
  private fun discard(workDir: File, part: File, checkpoint: File) {
    val files = listOf(
      part,
      ResumeValidator.fileFor(part),
      File(part.path + ".done"),
      checkpoint,
      File(checkpoint.path + ".tmp"),
    )
    for (file in files) {
      if (file.parentFile?.canonicalFile == workDir.canonicalFile) file.delete()
    }
  }
}
