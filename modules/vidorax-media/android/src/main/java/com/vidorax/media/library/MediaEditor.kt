package com.vidorax.media.library

import android.content.Context
import android.media.MediaExtractor
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import com.vidorax.media.InvalidRequestException
import com.vidorax.media.InvalidStateException
import com.vidorax.media.NotFoundException
import com.vidorax.media.StorageException
import com.vidorax.media.StoragePermissionException
import com.vidorax.media.model.Container
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.process.MediaFiles
import com.vidorax.media.process.MediaProcessor
import com.vidorax.media.process.TrackContainer
import com.vidorax.media.verify.Verifier
import com.vidorax.media.verify.VerifyResult
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

/** The item may not be edited: still downloading, protected, or rejected by the verifier. */
class EditRefusedException(message: String) : CodedException("ERR_EDIT_REFUSED", message, null)

/** Not enough free space for the edit's output. */
class EditNoSpaceException(message: String) : CodedException("ERR_NO_SPACE", message, null)

/** The edit was stopped (Cancel in the app or in its notification); nothing partial was kept. */
class EditCancelledException : CodedException("ERR_EDIT_CANCELLED", "The edit was cancelled", null)

/** P10 adds COMPRESS (#680): an MP4 with the video re-encoded smaller ([CompressPlan]). */
// P12 adds MERGE (#682: library videos joined, [MergePlan]) and SPEED (#684: faster or slower, [SpeedPlan]).
internal enum class EditKind(val wire: String) { TRIM("trim"), MP4("mp4"), AUDIO("audio"), COMPRESS("compress"), MERGE("merge"), SPEED("speed") }

/** How one track goes into the output: copied as it is (transmuxed), re-encoded, or left out. */
internal enum class TrackPlan(val wire: String) { COPY("copy"), H264("h264"), AAC("aac"), DROP("drop") }

internal data class EditRequest(
  val sourceId: String,
  val kind: EditKind,
  val startMs: Long,
  val endMs: Long?,
  /** Trim only: the start was moved to a keyframe, so the video can be copied without re-encoding. */
  val keyframeStart: Boolean,
  val video: TrackPlan,
  val audio: TrackPlan,
  val title: String,
  /** COMPRESS only: the target bitrate and size. */
  val compress: CompressSettings? = null,
  /** P12 MERGE only: the videos joined, in order. */
  val merge: MergeSettings? = null,
  /** P12 SPEED only: the speed and the part. */
  val speed: SpeedSettings? = null,
)

/** What JavaScript sends to `startEdit` (src/media-edit/edit-plan.ts decides the plan). */
data class EditRequestRecord(
  @Field val sourceId: String = "",
  @Field val kind: String = "",
  @Field val startMs: Double? = null,
  @Field val endMs: Double? = null,
  @Field val keyframeStart: Boolean = false,
  @Field val video: String = "copy",
  @Field val audio: String = "copy",
  @Field val title: String = "",
  /** P10 COMPRESS only (src/media-edit/compress-plan.ts): bits per second, and the short side at most (pixels). */
  @Field val videoBitrate: Double? = null,
  @Field val maxShortSide: Double? = null,
  /** P12 MERGE only (src/media-edit/merge-plan.ts): the videos joined, in order; `sourceId` is one of them. */
  @Field val sourceIds: List<String>? = null,
  /** P12 SPEED only (src/media-edit/speed-plan.ts): 0.25–4, not 1. The part is `startMs`–`endMs` (both null: all). */
  @Field val speed: Double? = null,
) : Record {
  internal fun toModel(): EditRequest {
    val editKind = EditKind.values().firstOrNull { it.wire == kind } ?: throw InvalidRequestException("Unknown edit $kind")
    val videoPlan = TrackPlan.values().firstOrNull { it.wire == video } ?: throw InvalidRequestException("Unknown video plan")
    val audioPlan = TrackPlan.values().firstOrNull { it.wire == audio } ?: throw InvalidRequestException("Unknown audio plan")
    if (sourceId.isBlank()) throw InvalidRequestException("No item to edit")
    if (videoPlan == TrackPlan.AAC || audioPlan == TrackPlan.H264) throw InvalidRequestException("Mismatched track plan")
    if (editKind == EditKind.AUDIO && (videoPlan != TrackPlan.DROP || audioPlan == TrackPlan.DROP)) {
      throw InvalidRequestException("Audio only keeps the audio and drops the video")
    }
    if (editKind != EditKind.AUDIO && videoPlan == TrackPlan.DROP) throw InvalidRequestException("A video edit keeps the video")
    if (editKind == EditKind.COMPRESS && videoPlan != TrackPlan.H264) throw InvalidRequestException("Compress re-encodes the video")
    val compressSettings = if (editKind == EditKind.COMPRESS) CompressPlan.settings(videoBitrate, maxShortSide) else null
    // P12 MERGE and SPEED re-encode the video (a sequence of several videos; new timestamps).
    if ((editKind == EditKind.MERGE || editKind == EditKind.SPEED) && videoPlan != TrackPlan.H264) {
      throw InvalidRequestException("This edit re-encodes the video")
    }
    val mergeSettings = if (editKind == EditKind.MERGE) MergePlan.settings(sourceId, sourceIds) else null
    val speedSettings = if (editKind == EditKind.SPEED) SpeedPlan.settings(speed, startMs, endMs) else null
    return EditRequest(
      sourceId = sourceId,
      kind = editKind,
      startMs = (startMs ?: 0.0).toLong().coerceAtLeast(0),
      endMs = endMs?.toLong(),
      keyframeStart = keyframeStart,
      video = videoPlan,
      audio = audioPlan,
      title = Titles.clamp(title),
      compress = compressSettings,
      merge = mergeSettings,
      speed = speedSettings,
    )
  }
}

/**
 * Edit after download: Trim (#374), Convert to MP4 or audio only (#376). Every edit writes a NEW file and adds it to
 * the library as a new item (so it shows in Player); the original file and its library row are only ever read. Uses
 * the Media3 Transformer that already backs the module's transcoding ([com.vidorax.media.process.TransformerTranscoder]):
 * a track whose plan is COPY is transmuxed (no quality loss), only H264/AAC plans re-encode.
 *
 * One edit at a time; [cancel] stops it and its partial output is deleted, as on any failure. The output is checked
 * before it is added: it must read back with the tracks asked for and about the expected length. Free space is checked
 * before starting. A long edit (a conversion, or a trim keeping 30 s or more) runs with [MediaEditService] in the
 * foreground, with its progress and Cancel in a notification; if Android refuses that service, it runs as before.
 * P10 Compress video (#680) is one more kind, run the same way; [CompressPlan] holds what it changes.
 * P12 Merge videos (#682) and Change speed (#684) are two more ([MergePlan], [SpeedPlan]); Create GIF (#676) runs
 * under the same lock, progress and Cancel through [gif], but makes a Gallery image instead of a library item.
 */
@OptIn(UnstableApi::class)
internal class MediaEditor(
  private val context: Context,
  private val library: LibraryStore,
  private val paths: StoragePaths,
  private val mediaInfo: MediaInfo,
  private val thumbnails: Thumbnails,
  private val now: () -> Long = System::currentTimeMillis,
) {
  /** The time (ms) of the video keyframe at or before [positionMs]: where a lossless trim can start. */
  suspend fun keyframeAtOrBefore(sourceId: String, positionMs: Long): Long? = withContext(Dispatchers.IO) {
    val item = library.get(sourceId) ?: throw NotFoundException("Unknown library item $sourceId")
    if (!item.file.isFile) throw NotFoundException("The file of $sourceId is missing")
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(item.file.path)
      val track = (0 until extractor.trackCount).firstOrNull { index ->
        extractor.getTrackFormat(index).getString(android.media.MediaFormat.KEY_MIME)?.startsWith("video/") == true
      } ?: return@withContext null
      extractor.selectTrack(track)
      extractor.seekTo(positionMs.coerceAtLeast(0) * 1_000, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      extractor.sampleTime.takeIf { it >= 0 }?.let { it / 1_000 }
    } catch (e: Exception) {
      null
    } finally {
      extractor.release()
    }
  }

  /** Runs one edit and resolves with the new library item. Rejects with ERR_INVALID_STATE while another runs. */
  suspend fun edit(request: EditRequest): LibraryItem {
    if (!busy.compareAndSet(false, true)) throw InvalidStateException("Another edit is running")
    val job = currentCoroutineContext()[Job]
    running = job
    progressValue = 0.0
    val newId = UUID.randomUUID().toString()
    val workDir = File(paths.workRoot, "edit-$newId")
    var target: File? = null
    var thumbnail: File? = null
    try {
      val source = library.get(request.sourceId) ?: throw NotFoundException("Unknown library item ${request.sourceId}")
      // P12 MERGE: every video joined, in order (each is read and checked like the source in check()).
      val mergeItems = request.merge?.sourceIds?.map { id -> library.get(id) ?: throw NotFoundException("Unknown library item $id") }
      val plan = withContext(Dispatchers.IO) { check(source, request, mergeItems) }
      val keptMs = (plan.clipEndMs ?: plan.durationMs) - plan.clipStartMs
      // The service stops itself once this edit has ended (progress() is null again): never stopped from here, so it
      // is never stopped before it entered the foreground.
      if (MediaEditForeground.needsForeground(request.kind, keptMs)) MediaEditForeground.start(context, request.title)
      workDir.mkdirs()
      val output = File(workDir, if (request.kind == EditKind.AUDIO) "edit.m4a" else "edit.mp4")
      export(source, request, plan, output)
      progressValue = 1.0
      return withContext(Dispatchers.IO) {
        verifyOutput(output, request, plan)
        val extension = if (request.kind == EditKind.AUDIO) "m4a" else "mp4"
        val file = paths.newLibraryFile(source.site, request.title, newId, extension)
        target = file
        file.parentFile?.mkdirs()
        if (!output.renameTo(file)) {
          output.copyTo(file, overwrite = false)
          output.delete()
        }
        val metadata = mediaInfo.read(file)
        thumbnail = if (request.kind == EditKind.AUDIO) null else thumbnails.create(newId, file, metadata)
        val type = MediaTypes.forFileName(file.name)
        val item = LibraryItem(
          id = newId,
          title = request.title,
          site = source.site,
          pageUrl = source.pageUrl,
          sourceUrl = null,
          file = file,
          mimeType = type?.mimeType ?: if (request.kind == EditKind.AUDIO) "audio/mp4" else "video/mp4",
          container = Container.MP4,
          videoCodec = metadata.videoCodec,
          audioCodec = metadata.audioCodec,
          hasAudio = metadata.hasAudio,
          width = metadata.width,
          height = metadata.height,
          durationMs = metadata.durationMs,
          sizeBytes = file.length(),
          thumbnail = thumbnail,
          favorite = false,
          galleryUri = null,
          createdAt = now(),
          completedAt = now(),
        )
        library.insert(item)
        item
      }
    } catch (e: Throwable) {
      // Cancelled or failed: nothing partial stays behind; the original was never touched.
      target?.delete()
      thumbnail?.delete()
      throw when (e) {
        // A coded rejection, so JavaScript tells a cancel (also one from the notification) from a failure.
        is CancellationException -> EditCancelledException()
        is CodedException -> e
        else -> StorageException("The edit failed", e)
      }
    } finally {
      workDir.deleteRecursively()
      running = null
      progressValue = null
      busy.set(false)
    }
  }

  /**
   * P12 Create GIF (#676): a part of a library video as a GIF in the Gallery (Pictures/VidoraX), with one private copy
   * for Share. It runs as the one edit ([runExclusive]: the same lock, progress, Cancel and notification as [edit]),
   * but its result is an image, not a library item. The video is only read. [GifExport] and [GifEncoder] do the work.
   */
  suspend fun gif(request: GifRequest, gallery: ThumbnailExport): GifResult = runExclusive { workDir ->
    val source = library.get(request.sourceId) ?: throw NotFoundException("Unknown library item ${request.sourceId}")
    val plan = withContext(Dispatchers.IO) { GifExport.plan(source, request) }
    if (!gallery.canSaveToGallery()) {
      throw StoragePermissionException("Saving to the gallery needs the storage permission on Android 9 and older")
    }
    if (paths.workRoot.apply { mkdirs() }.usableSpace < GifPlan.spaceNeeded(plan) + FREE_SPACE_MARGIN_BYTES) {
      throw EditNoSpaceException("Not enough free space for this GIF")
    }
    MediaEditForeground.start(context, request.title)
    workDir.mkdirs()
    val output = File(workDir, "edit.gif")
    withContext(Dispatchers.IO) {
      val scope = this
      GifExport.write(
        source.file,
        plan,
        output,
        onFrame = { done -> progressValue = (done.toDouble() / plan.frames * GIF_FRAMES_PROGRESS).coerceAtMost(0.99) },
        checkActive = { scope.ensureActive() },
      )
    }
    val bytes = output.length()
    val uri = gallery.saveGif(output, request.title)
    // Share is offered only with its copy; the GIF is in the Gallery either way.
    val shareName = withContext(Dispatchers.IO) {
      runCatching { GifExport.keepShareCopy(paths, output, request.title).name }.getOrDefault("")
    }
    progressValue = 1.0
    GifResult(uri, shareName, plan.width, plan.height, plan.frames, bytes, plan.endMs - plan.startMs)
  }

  /**
   * P12: runs [block] as the one edit — [edit]'s lock (ERR_INVALID_STATE while another runs), progress, Cancel
   * (ERR_EDIT_CANCELLED, also from the notification) and clean-up — for an export that isn't a new library item.
   * [block] gets a work folder of its own, deleted afterwards with anything partial in it.
   */
  private suspend fun <T> runExclusive(block: suspend (workDir: File) -> T): T {
    if (!busy.compareAndSet(false, true)) throw InvalidStateException("Another edit is running")
    running = currentCoroutineContext()[Job]
    progressValue = 0.0
    val workDir = File(paths.workRoot, "edit-${UUID.randomUUID()}")
    try {
      return block(workDir)
    } catch (e: Throwable) {
      throw when (e) {
        is CancellationException -> EditCancelledException()
        is CodedException -> e
        else -> StorageException("The export failed", e)
      }
    } finally {
      workDir.deleteRecursively()
      running = null
      progressValue = null
      busy.set(false)
    }
  }

  private data class Plan(
    val durationMs: Long,
    val clipStartMs: Long,
    val clipEndMs: Long?,
    val hasAudio: Boolean,
    /** P12: the source's frame rate (SPEED drops frames over 60 fps); null when unknown. */
    val frameRate: Float? = null,
    /** P12 MERGE: the videos joined and the output's size. */
    val merge: MergeLayout? = null,
    /** P12: the output's expected length when it isn't the part kept (MERGE: all videos; SPEED: the part ÷ speed). */
    val expectedMs: Long? = null,
  )

  /** Refusals, range clamping and the free-space check — everything decided before a byte is written. */
  private fun check(source: LibraryItem, request: EditRequest, mergeItems: List<LibraryItem>? = null): Plan {
    if (!source.file.isFile) throw NotFoundException("The file of ${source.id} is missing")
    val verdict = Verifier.verify(source.file)
    if (verdict is VerifyResult.Invalid) throw EditRefusedException("This file cannot be edited (${verdict.detail})")
    val info = MediaFiles.read(source.file, MediaProcessor.trackContainer(source.container))
      ?: MediaFiles.read(source.file, TrackContainer.UNKNOWN)
      ?: throw EditRefusedException("This file cannot be read")
    if (info.encrypted) throw EditRefusedException("This file is protected")
    val durationMs = source.durationMs ?: info.durationUs?.let { it / 1_000 } ?: throw EditRefusedException("Unknown length")
    val hasAudio = info.audio != null
    if (request.kind == EditKind.AUDIO && !hasAudio) throw EditRefusedException("This video has no sound")
    if (request.kind != EditKind.AUDIO && info.video == null) throw EditRefusedException("This file has no video")
    var start = 0L
    var end: Long? = null
    if (request.kind == EditKind.TRIM) {
      start = request.startMs.coerceIn(0, maxOf(0, durationMs - MIN_TRIM_MS))
      end = (request.endMs ?: durationMs).coerceIn(start + MIN_TRIM_MS, durationMs)
      if (end - start < MIN_TRIM_MS) throw InvalidRequestException("A trim keeps at least one second")
    }
    // P12 SPEED: the part (or the whole video), clamped like a trim.
    val speedSettings = request.speed
    if (speedSettings != null) {
      val (partStart, partEnd) = SpeedPlan.range(speedSettings, durationMs)
      start = partStart
      end = partEnd
    }
    // P12 MERGE: every video read and checked like the source; the output takes the first one's size.
    val merge = mergeItems?.let { items -> MergePlan.layout(items.map(MergePlan::inspect)) }
    val fraction = if (end != null) (end - start).toDouble() / durationMs else 1.0
    val reencodes = request.video == TrackPlan.H264
    // P10 COMPRESS: its own size comes from the target bitrate (twice the source would refuse it on a full phone).
    val estimate = request.compress?.let { (CompressPlan.estimateBytes(durationMs, it, hasAudio) * COPY_FACTOR).toLong() }
      // P12: a merge counts every video it joins; a speed change its part, ÷ the speed (a slower copy is longer).
      ?: merge?.let { MergePlan.estimateBytes(it) }
      ?: request.speed?.let { SpeedPlan.estimateBytes(source.sizeBytes, durationMs, start, end, it.speed) }
      ?: (source.sizeBytes * fraction * (if (reencodes) REENCODE_FACTOR else COPY_FACTOR)).toLong()
    if (paths.workRoot.apply { mkdirs() }.usableSpace < estimate + FREE_SPACE_MARGIN_BYTES) {
      throw EditNoSpaceException("Not enough free space for this edit")
    }
    // P12: what MERGE and SPEED add to the plan (nothing for the other kinds).
    val expectedMs = merge?.totalMs ?: request.speed?.let { SpeedPlan.outputMs((end ?: durationMs) - start, it.speed) }
    val frameRate = info.video?.format?.frameRate?.takeIf { it > 0f }
    return Plan(durationMs, start, end, merge?.hasAudio ?: hasAudio, frameRate, merge, expectedMs)
  }

  private suspend fun export(source: LibraryItem, request: EditRequest, plan: Plan, output: File) {
    output.delete()
    val thread = HandlerThread("vidorax-edit").apply { start() }
    val handler = Handler(thread.looper)
    var transformer: Transformer? = null
    try {
      suspendCancellableCoroutine { continuation ->
        val progress = ProgressHolder()
        val poll = object : Runnable {
          override fun run() {
            val current = transformer ?: return
            if (current.getProgress(progress) == Transformer.PROGRESS_STATE_AVAILABLE) {
              progressValue = (progress.progress / 100.0).coerceIn(0.0, 0.99)
            }
            handler.postDelayed(this, PROGRESS_POLL_MS)
          }
        }
        val listener = object : Transformer.Listener {
          override fun onCompleted(composition: Composition, exportResult: ExportResult) {
            handler.removeCallbacks(poll)
            if (continuation.isActive) continuation.resume(Unit)
          }

          override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
            handler.removeCallbacks(poll)
            output.delete()
            if (continuation.isActive) {
              continuation.resumeWithException(StorageException("The edit failed (${exportException.errorCodeName})", exportException))
            }
          }
        }
        handler.post {
          try {
            val builder = Transformer.Builder(context).setLooper(thread.looper).addListener(listener)
            videoMime(source, request.video)?.let { builder.setVideoMimeType(it) }
            audioMime(source, request.audio)?.let { builder.setAudioMimeType(it) }
            // P10 COMPRESS: the encoder's target bitrate (this alone makes Transformer re-encode the video).
            request.compress?.let { builder.setEncoderFactory(CompressPlan.encoderFactory(context, it)) }
            val built = builder.build()
            transformer = built
            // P12 MERGE: one sequence of every video, fitted to the first one's size ([MergePlan]).
            val merge = plan.merge
            if (merge != null) {
              built.start(MergePlan.composition(merge, keepAudio = merge.hasAudio && request.audio != TrackPlan.DROP), output.path)
            } else {
              built.start(editedItem(source, request, plan), output.path)
            }
            handler.postDelayed(poll, PROGRESS_POLL_MS)
          } catch (e: Exception) {
            output.delete()
            if (continuation.isActive) continuation.resumeWithException(StorageException("The edit could not start", e))
          }
        }
        continuation.invokeOnCancellation {
          handler.post {
            handler.removeCallbacks(poll)
            runCatching { transformer?.cancel() }
            output.delete()
          }
        }
      }
    } finally {
      thread.quitSafely()
    }
  }

  private fun editedItem(source: LibraryItem, request: EditRequest, plan: Plan): EditedMediaItem {
    val media = MediaItem.Builder().setUri(Uri.fromFile(source.file))
    if (request.kind == EditKind.TRIM) {
      val clipping = MediaItem.ClippingConfiguration.Builder()
        .setStartPositionMs(plan.clipStartMs)
        // A keyframe start lets Transformer copy the video; otherwise it re-encodes from the exact start.
        .setStartsAtKeyFrame(request.keyframeStart)
      plan.clipEndMs?.let { clipping.setEndPositionMs(it) }
      media.setClippingConfiguration(clipping.build())
    }
    // P12 SPEED of a part: that part alone, from its exact start (the video is re-encoded anyway).
    val partEndMs = plan.clipEndMs
    if (request.speed != null && partEndMs != null) {
      media.setClippingConfiguration(
        MediaItem.ClippingConfiguration.Builder().setStartPositionMs(plan.clipStartMs).setEndPositionMs(partEndMs).build(),
      )
    }
    return EditedMediaItem.Builder(media.build())
      .setRemoveVideo(request.kind == EditKind.AUDIO)
      .setRemoveAudio(request.audio == TrackPlan.DROP)
      // P10 COMPRESS: scaled down (never up) when the video is bigger than asked.
      .apply { request.compress?.let { setEffects(CompressPlan.effects(it, source.width, source.height)) } }
      // P12 SPEED: Transformer's own speed change (picture and sound), frames over 60 fps dropped ([SpeedPlan]).
      .apply {
        request.speed?.let {
          setSpeed(SpeedPlan.provider(it.speed))
          setEffects(SpeedPlan.effects(it, plan.frameRate))
        }
      }
      .build()
  }

  /** COPY keeps the source's own codec (so Transformer transmuxes it); H264 re-encodes; DROP sets nothing. */
  private fun videoMime(source: LibraryItem, plan: TrackPlan): String? = when (plan) {
    TrackPlan.COPY -> source.videoCodec?.takeIf { it == MimeTypes.VIDEO_H264 || it == MimeTypes.VIDEO_H265 }
      ?: MimeTypes.VIDEO_H264
    TrackPlan.H264 -> MimeTypes.VIDEO_H264
    else -> null
  }

  private fun audioMime(source: LibraryItem, plan: TrackPlan): String? = when (plan) {
    TrackPlan.COPY, TrackPlan.AAC -> MimeTypes.AUDIO_AAC
    else -> null
  }

  /** The output must read back with the tracks asked for, and about as long as the part that was kept. */
  private fun verifyOutput(output: File, request: EditRequest, plan: Plan) {
    val info = MediaFiles.read(output, TrackContainer.MP4)
    if (info == null || !output.isFile || output.length() == 0L) throw StorageException("The edited file cannot be read back")
    if (request.kind == EditKind.AUDIO) {
      if (info.audio == null || info.video != null) throw StorageException("The audio file is not audio only")
    } else {
      if (info.video == null) throw StorageException("The edited file has no video")
      if (plan.hasAudio && request.audio != TrackPlan.DROP && info.audio == null) throw StorageException("The edited file lost its sound")
    }
    // P12: a merge is as long as its videos together, a speed change as its part ÷ the speed.
    val expectedMs = plan.expectedMs ?: ((plan.clipEndMs ?: plan.durationMs) - plan.clipStartMs)
    val producedMs = info.durationUs?.let { it / 1_000 }
    // A keyframe start may begin a little earlier than asked: only a far-off length is wrong.
    if (producedMs != null && !MediaProcessor.lengthsAgree(expectedMs * 1_000, producedMs * 1_000) && !request.keyframeStart) {
      throw StorageException("The edited file is ${producedMs} ms long, expected about $expectedMs ms")
    }
  }

  internal companion object {
    const val MIN_TRIM_MS = 1_000L
    const val PROGRESS_POLL_MS = 500L
    const val FREE_SPACE_MARGIN_BYTES = 64L * 1024 * 1024

    /** Output size against the part of the source it keeps: copied tracks about the same, re-encoded up to double. */
    const val COPY_FACTOR = 1.1
    const val REENCODE_FACTOR = 2.0

    /** P12 Create GIF: the share of its progress the frames take; saving to the Gallery is the rest. */
    const val GIF_FRAMES_PROGRESS = 0.95

    private val busy = AtomicBoolean(false)

    @Volatile
    private var running: Job? = null

    @Volatile
    private var progressValue: Double? = null

    /** 0..1 while an edit runs; null when none does. */
    fun progress(): Double? = progressValue

    /** P10: the edit kinds this build runs (JavaScript offers Compress only when "compress" is listed). */
    fun kinds(): List<String> = EditKind.values().map { it.wire }

    /** Stops the running edit (its partial output is deleted); does nothing when none runs. */
    fun cancel() {
      running?.cancel(CancellationException("Edit cancelled"))
    }
  }
}
