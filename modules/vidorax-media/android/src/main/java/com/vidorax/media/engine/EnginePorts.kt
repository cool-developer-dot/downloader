package com.vidorax.media.engine

import com.vidorax.media.InvalidStateException
import com.vidorax.media.library.GalleryExport
import com.vidorax.media.library.LibraryStore
import com.vidorax.media.library.MediaInfo
import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.library.SavedCopy
import com.vidorax.media.library.SavedVideoIndex
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.net.MediaRefusedException
import com.vidorax.media.model.DownloadErrorCode
import com.vidorax.media.model.ProcessingStage
import com.vidorax.media.plan.DashResolution
import com.vidorax.media.plan.SplitResolution
import com.vidorax.media.process.MediaProcessor
import com.vidorax.media.process.ProcessingInput
import com.vidorax.media.process.ProcessingOperation
import com.vidorax.media.process.ProcessingResult
import com.vidorax.media.plan.HlsPlanResult
import com.vidorax.media.plan.HlsPlanner
import com.vidorax.media.plan.Probe
import com.vidorax.media.transfer.HlsTransfer
import com.vidorax.media.transfer.HlsTransferOutcome
import com.vidorax.media.transfer.HlsTransferSpec
import com.vidorax.media.transfer.ProgressiveTransfer
import com.vidorax.media.transfer.TransferOutcome
import com.vidorax.media.transfer.TransferSpec
import com.vidorax.media.verify.VerifyExpectation
import com.vidorax.media.verify.VerifyResult
import com.vidorax.media.verify.Verifier
import java.io.File

/**
 * The download engine orchestrates side effects through these narrow ports rather than the concrete components
 * directly, so the orchestration logic (state machine, race safety, idempotency) is unit-testable with fakes and
 * without a network, a device, or a real database. The production adapters below just delegate to the already
 * tested progressive foundation — no logic is duplicated. `DownloadEngineApi` remains the one public API.
 */
internal fun interface Prober {
  suspend fun probe(request: ProbeRequest): ProbeResult
}

internal interface Transfers {
  suspend fun transfer(
    spec: TransferSpec,
    onProgress: (bytesDone: Long, totalBytes: Long?) -> Unit,
  ): TransferOutcome.Completed

  fun finalizeToFile(partFile: File, destFile: File)
}

internal fun interface Verification {
  fun verify(file: File, expectation: VerifyExpectation): VerifyResult
}

/**
 * Unencrypted VOD HLS: [plan] resolves and classifies the stream (variant, media playlist, live/DRM/format
 * refusals); [transfer] writes its segments, in order and resumably, into the download's `.part`.
 */
internal interface HlsDownloads {
  suspend fun plan(url: String, context: RequestContext, choice: VariantChoice?): HlsPlanResult

  suspend fun transfer(spec: HlsTransferSpec, onProgress: (bytesDone: Long, totalBytes: Long?) -> Unit): HlsTransferOutcome

  companion object {
    /** A host without HLS support: every HLS source is refused as unsupported, never half-downloaded. */
    val UNSUPPORTED = object : HlsDownloads {
      override suspend fun plan(url: String, context: RequestContext, choice: VariantChoice?): HlsPlanResult =
        HlsPlanResult.Refused(ProbeResult.Failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "HLS is not available"))

      override suspend fun transfer(spec: HlsTransferSpec, onProgress: (Long, Long?) -> Unit): HlsTransferOutcome =
        throw MediaRefusedException(ProbeFailure.UNSUPPORTED_FORMAT, "HLS is not available")
    }
  }
}

/**
 * DASH: [resolve] classifies the manifest and what it would download — one complete file (the download then runs as
 * the progressive file it is), or a video track and an optional separate audio track (single files or segments),
 * downloaded one after the other and merged. Live and protected manifests are refused with their own codes.
 */
internal fun interface DashDownloads {
  suspend fun resolve(url: String, context: RequestContext, choice: VariantChoice?): DashResolution

  companion object {
    /** A host without DASH support: every DASH source is refused as unsupported, never half-downloaded. */
    val UNSUPPORTED = DashDownloads { _, _, _ ->
      DashResolution.Refused(ProbeResult.Failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "DASH is not available"))
    }
  }
}

/** A split source (separate video and audio files): both classified for their role and checked to belong together. */
internal fun interface SplitDownloads {
  suspend fun resolve(videoUrl: String, audioUrl: String, context: RequestContext): SplitResolution

  companion object {
    val UNSUPPORTED = SplitDownloads { _, _, _ ->
      SplitResolution.Refused(ProbeResult.Failure(ProbeFailure.UNSUPPORTED_FORMAT, null, "Merging tracks is not available"))
    }
  }
}

/**
 * Turns the downloaded track files into the one file the library keeps: keep, remux, merge or transcode, then
 * re-read it (see [MediaProcessor]). [onProgress] reports the stage and its fraction.
 */
internal fun interface MediaProcessing {
  suspend fun process(
    input: ProcessingInput,
    workDir: File,
    onProgress: (ProcessingStage, Double?) -> Unit,
  ): ProcessingResult

  companion object {
    /**
     * No processing layer (unit tests of the engine's other steps): one downloaded file is kept exactly as it is, and
     * separately downloaded tracks cannot be merged.
     */
    val PASSTHROUGH = MediaProcessing { input, _, _ ->
      when (input) {
        is ProcessingInput.Single ->
          ProcessingResult.Done(input.track.file, MediaProcessor.keptContainer(input.track.container), ProcessingOperation.KEEP)
        is ProcessingInput.Split -> ProcessingResult.Failed(DownloadErrorCode.MUX_FAILED, "merging is not available")
      }
    }
  }
}

internal class RealMediaProcessing(private val processor: MediaProcessor) : MediaProcessing {
  override suspend fun process(input: ProcessingInput, workDir: File, onProgress: (ProcessingStage, Double?) -> Unit): ProcessingResult =
    processor.process(input, workDir, onProgress)
}

internal class RealSplitDownloads(private val probe: Probe) : SplitDownloads {
  override suspend fun resolve(videoUrl: String, audioUrl: String, context: RequestContext): SplitResolution =
    probe.resolveSplit(videoUrl, audioUrl, context)
}

internal fun interface MediaInspector {
  fun inspect(file: File): MediaMetadata
}

/** Writes the library thumbnail for a finished file; null when the file has no decodable frame. */
internal fun interface ThumbnailMaker {
  fun create(id: String, file: File, metadata: MediaMetadata): File?
}

internal fun interface LibraryWriter {
  /** Inserts a completed item; returns false when an item with that id already exists (idempotent completion). */
  suspend fun insertCompleted(item: LibraryItem): Boolean
}

/** Videos the user already has, so the same video is never downloaded twice (library/SavedVideoIndex). */
internal interface SavedVideos {
  /** A library item with its file, or a VidoraX gallery copy that still exists, for this source identity. */
  suspend fun findByIdentity(identityKey: String): SavedCopy?

  /** A library item (other than [excludeId]) or a VidoraX gallery copy with exactly the bytes of [file]. */
  suspend fun findByContent(file: File, excludeId: String, audioOnly: Boolean): SavedCopy?

  /** Items saved before identities existed get the identity of their recorded source. */
  suspend fun backfillIdentities()

  companion object {
    /** Nothing is ever known as saved: every download is new (tests that are not about duplicates). */
    val NONE = object : SavedVideos {
      override suspend fun findByIdentity(identityKey: String): SavedCopy? = null
      override suspend fun findByContent(file: File, excludeId: String, audioOnly: Boolean): SavedCopy? = null
      override suspend fun backfillIdentities() = Unit
    }
  }
}

/** The device-gallery copy of a completed download. Never throws: a failed copy never touches the download. */
internal interface GalleryPublisher {
  /** Copies the completed library item [id] into the gallery and records the copy on it. */
  suspend fun publish(id: String)

  /** After a restart: finishes the copies a process death interrupted. */
  suspend fun resumePending()

  companion object {
    val NONE = object : GalleryPublisher {
      override suspend fun publish(id: String) = Unit
      override suspend fun resumePending() = Unit
    }
  }
}

// --- production adapters over the tested progressive foundation ---

internal class RealProber(private val probe: Probe) : Prober {
  override suspend fun probe(request: ProbeRequest): ProbeResult = probe.probe(request)
}

internal class RealTransfers(private val transfer: ProgressiveTransfer) : Transfers {
  override suspend fun transfer(
    spec: TransferSpec,
    onProgress: (Long, Long?) -> Unit,
  ): TransferOutcome.Completed = transfer.transfer(spec, onProgress)

  override fun finalizeToFile(partFile: File, destFile: File) = transfer.finalizeToFile(partFile, destFile)
}

internal object RealVerification : Verification {
  override fun verify(file: File, expectation: VerifyExpectation): VerifyResult = Verifier.verify(file, expectation)
}

internal class RealHlsDownloads(private val planner: HlsPlanner, private val hls: HlsTransfer) : HlsDownloads {
  override suspend fun plan(url: String, context: RequestContext, choice: VariantChoice?): HlsPlanResult =
    planner.plan(url, context, choice)

  override suspend fun transfer(spec: HlsTransferSpec, onProgress: (Long, Long?) -> Unit): HlsTransferOutcome =
    hls.transfer(spec, onProgress)
}

internal class RealDashDownloads(private val probe: Probe) : DashDownloads {
  override suspend fun resolve(url: String, context: RequestContext, choice: VariantChoice?): DashResolution =
    probe.resolveDash(url, context, choice)
}

internal class RealMediaInspector(private val mediaInfo: MediaInfo) : MediaInspector {
  override fun inspect(file: File): MediaMetadata = mediaInfo.read(file)
}

internal class RealThumbnails(private val thumbnails: com.vidorax.media.library.Thumbnails) : ThumbnailMaker {
  override fun create(id: String, file: File, metadata: MediaMetadata): File? = thumbnails.create(id, file, metadata)
}

internal class RealSavedVideos(private val index: SavedVideoIndex) : SavedVideos {
  override suspend fun findByIdentity(identityKey: String): SavedCopy? = index.findByIdentity(identityKey)

  override suspend fun findByContent(file: File, excludeId: String, audioOnly: Boolean): SavedCopy? =
    index.findByContent(file, excludeId, audioOnly)

  override suspend fun backfillIdentities() =
    index.backfillIdentities { sourceUrl, pageUrl -> DownloadIdentity.of(sourceUrl, variant = null, pageUrl = pageUrl) }
}

internal class RealGalleryPublisher(private val gallery: GalleryExport) : GalleryPublisher {
  override suspend fun publish(id: String) = gallery.publishCompleted(id)

  override suspend fun resumePending() = gallery.resumePending()
}

internal class RealLibraryWriter(private val library: LibraryStore) : LibraryWriter {
  override suspend fun insertCompleted(item: LibraryItem): Boolean =
    try {
      library.insert(item)
      true
    } catch (e: InvalidStateException) {
      // Already present: a duplicate/stale completion callback. The verified file is in the library already.
      false
    }
}

/**
 * What the engine needs to know about connectivity, so "wait for the network" and Wi-Fi-only are decisions the
 * engine makes rather than errors the user has to recover from by hand.
 */
internal interface NetworkGate {
  /** True when a transfer may run right now under [wifiOnly]. */
  fun isUsable(wifiOnly: Boolean): Boolean

  /** Suspends until [isUsable] holds; returns immediately when it already does. */
  suspend fun awaitUsable(wifiOnly: Boolean)

  /**
   * Suspends until [isUsable] stops holding. This is what turns Wi-Fi-only into a promise: a transfer already
   * running when the phone falls back to mobile data is stopped, not left spending the user's data.
   */
  suspend fun awaitUnusable(wifiOnly: Boolean)

  companion object {
    /** No connectivity information (unit tests, and any host that does not provide one): never blocks. */
    val ALWAYS_USABLE = object : NetworkGate {
      override fun isUsable(wifiOnly: Boolean) = true

      override suspend fun awaitUsable(wifiOnly: Boolean) = Unit

      override suspend fun awaitUnusable(wifiOnly: Boolean) = kotlinx.coroutines.awaitCancellation()
    }
  }
}

/** Free bytes on the volume that holds the work and library folders. */
internal fun interface FreeSpace {
  fun bytes(): Long
}
