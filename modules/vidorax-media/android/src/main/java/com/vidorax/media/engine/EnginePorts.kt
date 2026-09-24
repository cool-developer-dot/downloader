package com.vidorax.media.engine

import com.vidorax.media.InvalidStateException
import com.vidorax.media.library.LibraryStore
import com.vidorax.media.library.MediaInfo
import com.vidorax.media.library.MediaMetadata
import com.vidorax.media.model.LibraryItem
import com.vidorax.media.model.ProbeFailure
import com.vidorax.media.model.ProbeRequest
import com.vidorax.media.model.ProbeResult
import com.vidorax.media.model.RequestContext
import com.vidorax.media.model.VariantChoice
import com.vidorax.media.net.MediaRefusedException
import com.vidorax.media.plan.DashResolution
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
 * DASH whose chosen representation is one complete file: [resolve] classifies the manifest and that file, and the
 * download then runs as the progressive file it is. Segmented, separate-audio, live and protected manifests are
 * refused there with their own codes.
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
