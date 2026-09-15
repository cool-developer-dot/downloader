/**
 * Basic unencrypted HLS transfer strategy.
 * Same progress/status/sync contract as progressive TransferWorker.
 */

import { File } from 'expo-file-system';

import {
  assertEnoughDiskSpace,
  deleteDownloadFiles,
  resolveDestinationFile,
  verifyCompletedFile,
} from '../file-paths';
import { verifyDownloadedMediaContent } from '../media-validation';
import {
  classifyTransferError,
  DownloadEngineError,
  toUserFacingErrorMessage,
} from '../errors';
import { DOWNLOAD_ENGINE } from '../constants';
import { upsertLocalRecord } from '../persistence';
import {
  createProgressTracker,
  normalizeTotalBytes,
  toTransferSnapshot,
} from '../progress';
import { isManualRetryAllowed } from '../retry-policy';
import { isSafeHttpUrl, sanitizeFileName } from '../resource-guard';
import {
  syncProgressThrottled,
  syncStatusImmediate,
} from '../synchronizer';
import type {
  EnqueueInput,
  EngineEvent,
  HlsTransferState,
  LocalDownloadRecord,
  TransferProgressSnapshot,
} from '../types';
import { buildDownloadHeaders } from '../download-headers';
import {
  isAuthDeniedError,
  resolveEphemeralHeadersForTarget,
  tryBoundedAuthContextRetry,
} from '../ephemeral-target-headers';
import { getDownloadSessionMeta } from '../download-session-meta';
import { assertSessionContextReady } from '../source-capability';
import { fetchAndParseHlsPlaylist } from './fetch-playlist';
import { cleanupHlsWorkspace } from './paths';
import { createHlsPersistGate, createEmptyHlsTransferState } from './persist-gate';
import {
  outputExtensionForHint,
  selectHlsVariant,
  type HlsMediaPlaylist,
} from './playlist';
import { isUnrecoverableHlsCode } from './segment-retry';
import {
  assembleHlsOutput,
  copyHlsAssembledFile,
  downloadHlsSegments,
} from './segment-transfer';
import { verifyAssembledHlsFile } from './verifier';
import { StallWatchdog } from '../stall-watchdog';
import { validateFinalDownloadFile } from '../finalize-download';
import { applyCompletedFileIdentity } from '@/downloads/completed-file/apply-identity';
import { getLocalRecord } from '../persistence';
import {
  capturePauseSettleHandle,
  createWorkerSettleBarrier,
  waitForCapturedSettle,
  waitForCapturedSettleWithTimeout,
  type PauseSettleHandle,
  type WorkerSettleBarrier,
} from '../worker-settle';

type Emit = (event: EngineEvent) => void;
type OnProgress = (snapshot: TransferProgressSnapshot) => void;

type ActiveHls = {
  downloadId: string;
  generation: number;
  abortController: AbortController;
  running: boolean;
  cancelled: boolean;
  /** Soft hold for Wi-Fi Only / offline — not user cancel, not failure. */
  networkPolicyHold: boolean;
  /** User-initiated pause — distinct from network policy hold. */
  userPauseRequested: boolean;
};

function ensureOutputFileName(
  fileName: string,
  hint: 'ts' | 'fmp4',
): string {
  const sanitized = sanitizeFileName(fileName);
  const ext = outputExtensionForHint(hint);
  const lower = sanitized.toLowerCase();
  if (
    lower.endsWith('.ts') ||
    lower.endsWith('.mp4') ||
    lower.endsWith('.m4s') ||
    lower.endsWith('.m3u8')
  ) {
    const base = sanitized.replace(/\.[^.]+$/, '') || 'download';
    return sanitizeFileName(`${base}.${ext}`);
  }
  if (sanitized.includes('.')) {
    return sanitized;
  }
  return sanitizeFileName(`${sanitized}.${ext}`);
}

/**
 * HLS transfer worker — one job at a time, sequential segments.
 * User pause preserves segment workspace for resume when safe.
 */
export class HlsTransferWorker {
  private active: ActiveHls | null = null;
  private settleBarrier: WorkerSettleBarrier | null = null;
  private pauseSettleHandle: PauseSettleHandle | null = null;
  private finalizationCommitted = false;

  constructor(
    private readonly emit: Emit,
    private readonly onProgress: OnProgress,
  ) {}

  get activeDownloadId(): string | null {
    return this.active?.downloadId ?? null;
  }

  isActive(downloadId: string): boolean {
    return this.active?.downloadId === downloadId && Boolean(this.active?.running);
  }

  async waitUntilSettled(generation?: number): Promise<void> {
    const handle =
      generation == null || this.pauseSettleHandle?.generation === generation
        ? this.pauseSettleHandle
        : null;
    await waitForCapturedSettle(handle, this.settleBarrier);
  }

  async waitUntilSettledBounded(
    generation?: number,
    timeoutMs: number = DOWNLOAD_ENGINE.pauseSettleTimeoutMs,
  ): Promise<boolean> {
    const handle =
      generation == null || this.pauseSettleHandle?.generation === generation
        ? this.pauseSettleHandle
        : null;
    const result = await waitForCapturedSettleWithTimeout(
      handle,
      this.settleBarrier,
      timeoutMs,
    );
    return result.settled;
  }

  getPauseSettleGeneration(): number | null {
    return this.pauseSettleHandle?.generation ?? null;
  }

  private isCurrentGeneration(generation: number): boolean {
    return (
      this.active != null &&
      this.active.generation === generation &&
      !this.active.cancelled
    );
  }

  async run(
    input: EnqueueInput,
    existing: LocalDownloadRecord | null,
  ): Promise<void> {
    if (this.active?.running) {
      throw new DownloadEngineError(
        'UNKNOWN_ERROR',
        'Transfer worker is already busy.',
      );
    }

    if (!isSafeHttpUrl(input.sourceUrl)) {
      await this.fail(input, existing, 'INVALID_RESOURCE', 'Invalid download URL.');
      return;
    }

    const expectedBytes = Number(input.fileSize);
    assertEnoughDiskSpace(
      Number.isFinite(expectedBytes) && expectedBytes > 0 ? expectedBytes : 0,
    );

    const generation = (existing?.generation ?? 0) + 1;
    const abortController = new AbortController();
    const tracker = createProgressTracker();

    let bytesWritten = 0;
    let totalBytes: number | null = normalizeTotalBytes(
      Number(input.fileSize) > 0 ? Number(input.fileSize) : null,
    );
    let destinationUri: string | null = null;
    let hlsState: HlsTransferState = createEmptyHlsTransferState();
    let persistHls: (state: HlsTransferState, force: boolean) => Promise<void> =
      async () => {};

    let attemptStartBytes = 0;

    const transferWatchdog = new StallWatchdog({
      downloadId: input.id,
      generation,
      shouldPause: () => false,
      onStall: () => {
        if (!this.isCurrentGeneration(generation)) {
          return;
        }
        try {
          abortController.abort();
        } catch {
          // ignore
        }
      },
    });

    const publishProgress = (
      force = false,
      localState: TransferProgressSnapshot['localState'] = 'transferring',
    ) => {
      if (!this.isCurrentGeneration(generation) && !force) {
        return null;
      }
      const noted = force
        ? tracker.forceComplete(bytesWritten, totalBytes)
        : tracker.note(bytesWritten, totalBytes);
      const snapshot = toTransferSnapshot(
        input.id,
        noted,
        destinationUri,
        localState,
      );
      snapshot.generation = generation;
      snapshot.attemptStartBytes = attemptStartBytes;
      snapshot.workerState =
        bytesWritten > attemptStartBytes ? 'TRANSFERRING' : 'STARTING';
      const shouldUpdateUi =
        force || !('shouldUpdateUi' in noted) || noted.shouldUpdateUi;
      const knownTotal = normalizeTotalBytes(totalBytes);
      const shouldUpdateBackend =
        !force &&
        'shouldUpdateBackend' in noted &&
        noted.shouldUpdateBackend &&
        knownTotal != null &&
        snapshot.progress > 0;

      if (shouldUpdateUi) {
        this.onProgress(snapshot);
      }
      if (shouldUpdateBackend && knownTotal != null) {
        syncProgressThrottled(input.id, snapshot.progress, String(knownTotal));
      }
      return snapshot;
    };

    this.active = {
      downloadId: input.id,
      generation,
      abortController,
      running: true,
      cancelled: false,
      networkPolicyHold: false,
      userPauseRequested: false,
    };

    const settleBarrier = createWorkerSettleBarrier();
    this.settleBarrier = settleBarrier;
    this.pauseSettleHandle = capturePauseSettleHandle(generation, settleBarrier);
    this.finalizationCommitted = false;

    try {
      const reuseWorkspace =
        existing?.sourceUrl === input.sourceUrl &&
        existing.hlsTransfer != null &&
        existing.hlsTransfer.completedSegments > 0;

      if (!reuseWorkspace) {
        await cleanupHlsWorkspace(input.id);
      }

      hlsState =
        reuseWorkspace && existing?.hlsTransfer
          ? { ...existing.hlsTransfer }
          : createEmptyHlsTransferState();
      attemptStartBytes = hlsState.downloadedBytes;
      bytesWritten = hlsState.downloadedBytes;
      tracker.seed(attemptStartBytes);
      const persistGate = createHlsPersistGate();

      persistHls = async (state: HlsTransferState, force: boolean) => {
        hlsState = state;
        if (!this.isCurrentGeneration(generation) && !force) {
          return;
        }
        if (!persistGate.shouldPersist(state.completedSegments, Date.now(), force)) {
          return;
        }
        await upsertLocalRecord({
          downloadId: input.id,
          sourceUrl: input.sourceUrl,
          fileName: sanitizeFileName(input.fileName),
          expectedFileSize: input.fileSize,
          localUri: destinationUri,
          localState: 'transferring',
          bytesWritten: state.downloadedBytes,
          totalBytes,
          pauseState: null,
          rangeValidators: null,
          generation,
          errorCode: null,
          errorMessage: null,
          remoteStatus: 'QUEUED',
          retryCount: existing?.retryCount ?? 0,
          maxRetries:
            existing?.maxRetries ?? DOWNLOAD_ENGINE.maxAutoRetryAttempts,
          retryEligible: true,
          lastAttemptAt: existing?.lastAttemptAt ?? null,
          nextRetryAt: null,
          updatedAt: new Date().toISOString(),
          hlsTransfer: state,
        });
      };

      await upsertLocalRecord({
        downloadId: input.id,
        sourceUrl: input.sourceUrl,
        fileName: sanitizeFileName(input.fileName),
        expectedFileSize: input.fileSize,
        localUri: null,
        localState: 'transferring',
        bytesWritten: hlsState.downloadedBytes,
        totalBytes,
        pauseState: null,
        rangeValidators: null,
        generation,
        errorCode: null,
        errorMessage: null,
        remoteStatus: 'QUEUED',
        retryCount: existing?.retryCount ?? 0,
        maxRetries:
          existing?.maxRetries ?? DOWNLOAD_ENGINE.maxAutoRetryAttempts,
        retryEligible: true,
        lastAttemptAt: existing?.lastAttemptAt ?? null,
        nextRetryAt: null,
        updatedAt: new Date().toISOString(),
        hlsTransfer: hlsState,
      });

      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      await syncStatusImmediate(input.id, 'QUEUED', { workerState: 'STARTING' });

      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      assertSessionContextReady(input.sourceUrl, input.requestContext, input.id);
      transferWatchdog.startHlsManifestPhase({ generation });
      const media = await this.resolveMediaPlaylist(
        input.id,
        input.sourceUrl,
        abortController.signal,
        transferWatchdog,
        generation,
      );

      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      const outputName = ensureOutputFileName(input.fileName, media.containerHint);
      const destination = resolveDestinationFile(input.id, outputName);
      destinationUri = destination.uri;

      try {
        if (destination.exists) {
          destination.delete();
        }
      } catch {
        // continue
      }

      transferWatchdog.startFirstBytePhase({
        generation,
        baselineBytes: attemptStartBytes,
      });

      const transfer = await downloadHlsSegments({
        downloadId: input.id,
        media,
        signal: abortController.signal,
        resolveHeaders: async (targetUrl, parentUrl) => {
          const resolved = await resolveEphemeralHeadersForTarget({
            downloadId: input.id,
            targetUrl,
            requestKind: 'segment',
            parentUrl,
            checkCoherence: true,
          });
          if (Object.keys(resolved.headers).length > 0) {
            return resolved.headers;
          }
          // Public HLS: no session registry — empty or legacy context headers.
          return buildDownloadHeaders(input.requestContext);
        },
        onAuthDenied: async (targetUrl, parentUrl) => {
          const resolved = await tryBoundedAuthContextRetry({
            downloadId: input.id,
            targetUrl,
            requestKind: 'segment',
            parentUrl,
          });
          return resolved.headers;
        },
        stallWatchdog: transferWatchdog,
        generation,
        attemptStartBytes,
        onCheckpoint: (state, force) => {
          void persistHls(state, force).catch(() => {
            // Local persist must not abort a healthy transfer.
          });
        },
        onProgress: (event) => {
          if (!this.isCurrentGeneration(generation)) {
            return;
          }
          bytesWritten = event.bytesWritten;
          if (event.totalBytes != null && event.totalBytes > 0) {
            totalBytes = event.totalBytes;
          }

          // When byte totals are unknown, segment completion is still a real ratio.
          if (
            (totalBytes == null || totalBytes <= 0) &&
            event.totalSegments > 0
          ) {
            const ratio = event.completedSegments / event.totalSegments;
            const progress = Math.max(
              0,
              Math.min(99, Math.floor(ratio * 100)),
            );
            const noted = tracker.note(bytesWritten, null);
            const snapshot = toTransferSnapshot(
              input.id,
              {
                bytesWritten,
                totalBytes: null,
                progress,
                bytesPerSecond: noted.bytesPerSecond,
                etaSeconds: null,
              },
              destinationUri,
              'transferring',
            );
            snapshot.generation = generation;
            snapshot.attemptStartBytes = attemptStartBytes;
            snapshot.workerState =
              bytesWritten > attemptStartBytes ? 'TRANSFERRING' : 'STARTING';
            if (noted.shouldUpdateUi) {
              this.onProgress(snapshot);
            }
            if (noted.shouldUpdateBackend && progress > 0) {
              syncProgressThrottled(input.id, progress);
            }
            return;
          }

          publishProgress(false, 'transferring');
        },
      });

      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      await persistHls(
        {
          ...hlsState,
          completedSegments: transfer.plan.totalSegments,
          downloadedBytes: bytesWritten,
          currentSegment: null,
        },
        true,
      );

      const assembled = await assembleHlsOutput({
        downloadId: input.id,
        media,
        plan: transfer.plan,
        signal: abortController.signal,
      });

      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      // Move assembled temp → final destination without loading the full VOD.
      try {
        if (destination.exists) {
          destination.delete();
        }
      } catch {
        // continue
      }

      copyHlsAssembledFile(assembled, destination, abortController.signal);
      verifyAssembledHlsFile(destination, input.id);

      try {
        if (assembled.exists) {
          assembled.delete();
        }
      } catch {
        // Workspace cleanup still runs on completion / cancel.
      }

      await this.complete(input, destination, generation, outputName);
    } catch (error) {
      if (!this.active || this.active.generation !== generation) {
        return;
      }
      if (this.active.userPauseRequested && !this.active.cancelled) {
        this.active.running = false;
        try {
          await persistHls(hlsState, true);
        } catch {
          // ignore
        }
        await this.settleUserPaused(
          input,
          existing,
          generation,
          hlsState,
          destinationUri,
          totalBytes,
        );
        return;
      }
      if (this.active.networkPolicyHold) {
        this.active.running = false;
        try {
          await persistHls(hlsState, true);
        } catch {
          // ignore
        }
        await this.settleNetworkPolicyHold(
          input,
          existing,
          generation,
          hlsState,
          destinationUri,
          totalBytes,
        );
        return;
      }
      if (this.active.cancelled || abortController.signal.aborted) {
        this.active.running = false;
        return;
      }
      const classified = classifyTransferError(error);
      if (classified.code === 'CANCELLED') {
        this.active.running = false;
        try {
          await persistHls(hlsState, true);
        } catch {
          // ignore
        }
        return;
      }
      let failCode = classified.code;
      let failMessage = classified.message;
      if (
        (failCode === 'AUTH_ERROR' || isAuthDeniedError(classified)) &&
        getDownloadSessionMeta(input.id)?.authRetryBudget !== undefined &&
        (getDownloadSessionMeta(input.id)?.authRetryBudget ?? 0) <= 0
      ) {
        failCode = 'SESSION_EXPIRED';
        failMessage =
          'Your website session expired. Open the website and try again.';
      }
      await this.fail(
        input,
        existing,
        failCode,
        failMessage,
        generation,
        hlsState,
      );    } finally {
      transferWatchdog.stop();
      settleBarrier.resolve();
      this.settleBarrier = null;
      if (this.active?.generation === generation) {
        this.active.running = false;
        if (!this.active.cancelled) {
          this.active = null;
        }
      }
    }
  }

  private async resolveMediaPlaylist(
    downloadId: string,
    sourceUrl: string,
    signal: AbortSignal,
    stallWatchdog?: StallWatchdog | null,
    generation?: number,
  ): Promise<HlsMediaPlaylist> {
    const masterHeaders = await resolveEphemeralHeadersForTarget({
      downloadId,
      targetUrl: sourceUrl,
      requestKind: 'master',
      checkCoherence: true,
    });
    let headers =
      Object.keys(masterHeaders.headers).length > 0
        ? masterHeaders.headers
        : buildDownloadHeaders(
            // public path only — empty when session meta absent
            null,
          );

    const fetchMaster = async (hdrs: Record<string, string>) =>
      fetchAndParseHlsPlaylist(sourceUrl, signal, hdrs, {
        stallWatchdog,
        generation,
        resolveRedirectHeaders: async (redirectUrl) => {
          const resolved = await resolveEphemeralHeadersForTarget({
            downloadId,
            targetUrl: redirectUrl,
            requestKind: 'redirect',
            parentUrl: sourceUrl,
            checkCoherence: true,
          });
          return resolved.headers;
        },
      });

    let first;
    try {
      first = await fetchMaster(headers);
    } catch (error) {
      if (!isAuthDeniedError(error) && classifyTransferError(error).code !== 'AUTH_ERROR') {
        throw error;
      }
      const retried = await tryBoundedAuthContextRetry({
        downloadId,
        targetUrl: sourceUrl,
        requestKind: 'master',
      });
      headers = retried.headers;
      first = await fetchMaster(headers);
    }

    if (first.playlist.kind === 'media') {
      return first.playlist;
    }

    const variant = selectHlsVariant(first.playlist.variants, sourceUrl);
    const childHeaders = await resolveEphemeralHeadersForTarget({
      downloadId,
      targetUrl: variant.url,
      requestKind: 'child',
      parentUrl: sourceUrl,
      checkCoherence: true,
    });
    let childHdrs =
      Object.keys(childHeaders.headers).length > 0
        ? childHeaders.headers
        : headers;

    const fetchChild = async (hdrs: Record<string, string>) =>
      fetchAndParseHlsPlaylist(variant.url, signal, hdrs, {
        stallWatchdog,
        generation,
        resolveRedirectHeaders: async (redirectUrl) => {
          const resolved = await resolveEphemeralHeadersForTarget({
            downloadId,
            targetUrl: redirectUrl,
            requestKind: 'redirect',
            parentUrl: variant.url,
            checkCoherence: true,
          });
          return resolved.headers;
        },
      });

    let second;
    try {
      second = await fetchChild(childHdrs);
    } catch (error) {
      if (!isAuthDeniedError(error) && classifyTransferError(error).code !== 'AUTH_ERROR') {
        throw error;
      }
      const retried = await tryBoundedAuthContextRetry({
        downloadId,
        targetUrl: variant.url,
        requestKind: 'child',
        parentUrl: sourceUrl,
      });
      childHdrs = retried.headers;
      second = await fetchChild(childHdrs);
    }

    if (second.playlist.kind !== 'media') {
      throw new DownloadEngineError(
        'INVALID_HLS_PLAYLIST',
        'HLS variant did not resolve to a media playlist.',
      );
    }
    return second.playlist;
  }

  async pause(downloadId: string): Promise<boolean> {
    if (!this.active || this.active.downloadId !== downloadId) {
      return false;
    }
    if (this.active.cancelled) {
      return false;
    }
    this.active.userPauseRequested = true;
    this.pauseSettleHandle = capturePauseSettleHandle(
      this.active.generation,
      this.settleBarrier,
    );
    try {
      this.active.abortController.abort();
    } catch {
      // ignore
    }
    return true;
  }

  /**
   * Soft-hold for Wi-Fi Only / offline: abort bytes, keep workspace,
   * persist PAUSED (not FAILED/CANCELLED) so scheduler can resume later.
   */
  async holdForNetworkPolicy(downloadId: string): Promise<boolean> {
    if (!this.active || this.active.downloadId !== downloadId) {
      return false;
    }
    if (this.active.cancelled) {
      return false;
    }
    this.active.networkPolicyHold = true;
    try {
      this.active.abortController.abort();
    } catch {
      // ignore
    }
    return true;
  }

  async cancel(downloadId: string): Promise<boolean> {
    if (!this.active || this.active.downloadId !== downloadId) {
      return false;
    }
    this.active.cancelled = true;
    this.active.running = false;
    try {
      this.active.abortController.abort();
    } catch {
      // ignore
    }
    return true;
  }

  private async settleUserPaused(
    input: EnqueueInput,
    existing: LocalDownloadRecord | null,
    generation: number,
    hlsState: HlsTransferState,
    destinationUri: string | null,
    totalBytes: number | null,
  ): Promise<void> {
    const record: LocalDownloadRecord = {
      downloadId: input.id,
      sourceUrl: input.sourceUrl,
      fileName: sanitizeFileName(input.fileName),
      expectedFileSize: input.fileSize,
      localUri: destinationUri,
      localState: 'paused',
      bytesWritten: hlsState.downloadedBytes,
      totalBytes: totalBytes ?? existing?.totalBytes ?? null,
      pauseState: null,
      rangeValidators: null,
      generation,
      errorCode: null,
      errorMessage: null,
      remoteStatus: 'PAUSED',
      retryCount: existing?.retryCount ?? 0,
      maxRetries:
        existing?.maxRetries ?? DOWNLOAD_ENGINE.maxAutoRetryAttempts,
      retryEligible: true,
      lastAttemptAt: existing?.lastAttemptAt ?? null,
      nextRetryAt: null,
      updatedAt: new Date().toISOString(),
      hlsTransfer: hlsState,
      pauseReason: 'USER',
    };
    await upsertLocalRecord(record);
    if (!this.isCurrentGeneration(generation)) {
      return;
    }
    this.emit({
      type: 'status',
      downloadId: input.id,
      status: 'PAUSED',
      workerState: 'PAUSED',
    });
    await syncStatusImmediate(input.id, 'PAUSED');
  }

  private async settleNetworkPolicyHold(
    input: EnqueueInput,
    existing: LocalDownloadRecord | null,
    generation: number,
    hlsState: HlsTransferState,
    destinationUri: string | null,
    totalBytes: number | null,
  ): Promise<void> {
    const record: LocalDownloadRecord = {
      downloadId: input.id,
      sourceUrl: input.sourceUrl,
      fileName: sanitizeFileName(input.fileName),
      expectedFileSize: input.fileSize,
      localUri: destinationUri,
      localState: 'paused',
      bytesWritten: hlsState.downloadedBytes,
      totalBytes: totalBytes ?? existing?.totalBytes ?? null,
      pauseState: null,
      rangeValidators: null,
      generation,
      errorCode: null,
      errorMessage: null,
      remoteStatus: 'PAUSED',
      retryCount: existing?.retryCount ?? 0,
      maxRetries:
        existing?.maxRetries ?? DOWNLOAD_ENGINE.maxAutoRetryAttempts,
      retryEligible: true,
      lastAttemptAt: existing?.lastAttemptAt ?? null,
      nextRetryAt: null,
      updatedAt: new Date().toISOString(),
      hlsTransfer: { ...hlsState, lastFailureReason: null },
      pauseReason: 'NETWORK_POLICY',
    };
    await upsertLocalRecord(record);
    try {
      await syncStatusImmediate(input.id, 'PAUSED', {
        workerState: 'PAUSED',
      });
    } catch {
      // ignore
    }
    this.emit({ type: 'status', downloadId: input.id, status: 'PAUSED' });
    this.active = null;
  }

  private async complete(
    input: EnqueueInput,
    destination: File,
    generation: number,
    outputName: string,
  ): Promise<void> {
    if (this.finalizationCommitted) {
      return;
    }

    const priorRecord = await getLocalRecord(input.id);
    if (
      priorRecord?.localState === 'complete' &&
      priorRecord.remoteStatus === 'COMPLETED'
    ) {
      this.finalizationCommitted = true;
      return;
    }

    if (!this.isCurrentGeneration(generation)) {
      try {
        if (destination.exists) {
          destination.delete();
        }
      } catch {
        // ignore
      }
      return;
    }

    const validation = await validateFinalDownloadFile({
      file: destination,
      destination,
      expectedBytes: null,
      downloadId: input.id,
    });

    if (!validation.ok) {
      try {
        if (destination.exists) {
          destination.delete();
        }
      } catch {
        // ignore
      }
      await this.fail(
        input,
        null,
        validation.code,
        validation.message,
        generation,
      );
      return;
    }

    if (!this.isCurrentGeneration(generation)) {
      return;
    }

    await cleanupHlsWorkspace(input.id);

    const finalSize = String(validation.size);
    let identityLocalUri = validation.finalUri;
    let identityFileName = sanitizeFileName(outputName);
    let identityMime: string | null = null;
    let identityContainer: string | null = null;

    try {
      const identity = await applyCompletedFileIdentity({
        downloadId: input.id,
        finalUri: validation.finalUri,
        currentFileName: sanitizeFileName(outputName),
        fileSize: validation.size,
        displayTitle: input.title ?? null,
        sourceUrl: input.sourceUrl,
        evidence: {
          signatureKind: validation.signatureKind,
          containerHint: validation.signatureKind === 'mp4' ? 'mp4' : 'ts',
        },
      });
      identityLocalUri = identity.localUri;
      identityFileName = identity.fileName;
      identityMime = identity.descriptor.mimeType;
      identityContainer = identity.descriptor.container;
    } catch {
      // Keep Phase 1 validated path.
    }

    if (!verifyCompletedFile(new File(identityLocalUri), validation.size, { downloadId: input.id }).ok) {
      throw new DownloadEngineError('FINAL_FILE_INVALID', 'Completed file is unavailable.');
    }

    await upsertLocalRecord({
      downloadId: input.id,
      sourceUrl: input.sourceUrl,
      fileName: identityFileName,
      expectedFileSize: finalSize,
      localUri: identityLocalUri,
      localState: 'complete',
      bytesWritten: validation.size,
      totalBytes: validation.size,
      pauseState: null,
      rangeValidators: null,
      generation,
      errorCode: null,
      errorMessage: null,
      remoteStatus: 'COMPLETED',
      retryCount: 0,
      maxRetries: DOWNLOAD_ENGINE.maxAutoRetryAttempts,
      retryEligible: false,
      lastAttemptAt: null,
      nextRetryAt: null,
      updatedAt: new Date().toISOString(),
      hlsTransfer: null,
    });

    if (!this.isCurrentGeneration(generation)) {
      return;
    }

    const snapshot = toTransferSnapshot(
      input.id,
      {
        bytesWritten: validation.size,
        totalBytes: validation.size,
        progress: 100,
        bytesPerSecond: null,
        etaSeconds: 0,
      },
      identityLocalUri,
      'complete',
    );
    this.onProgress(snapshot);

    try {
      await syncStatusImmediate(input.id, 'COMPLETED', {
        progress: 100,
        fileSize: finalSize,
        fileName: identityFileName,
        errorMessage: null,
      });
    } catch {
      // local complete remains
    }

    if (!this.isCurrentGeneration(generation)) {
      return;
    }

    this.emit({
      type: 'completed',
      downloadId: input.id,
      localUri: identityLocalUri,
      fileSize: finalSize,
      progress: 100,
      fileName: identityFileName,
      mimeType: identityMime,
      container: identityContainer,
    });
    this.emit({ type: 'status', downloadId: input.id, status: 'COMPLETED' });
    this.finalizationCommitted = true;
  }

  private async fail(
    input: EnqueueInput,
    existing: LocalDownloadRecord | null,
    code: LocalDownloadRecord['errorCode'] & string,
    message: string,
    generation = (existing?.generation ?? 0) + 1,
    hlsState: HlsTransferState | null = existing?.hlsTransfer ?? null,
  ): Promise<void> {
    if (this.active?.cancelled) {
      return;
    }

    const engineCode = code as NonNullable<LocalDownloadRecord['errorCode']>;
    const wipeWorkspace = isUnrecoverableHlsCode(engineCode);

    if (wipeWorkspace) {
      try {
        await cleanupHlsWorkspace(input.id);
      } catch {
        // ignore
      }
      try {
        await deleteDownloadFiles(input.id);
      } catch {
        // ignore
      }
    }

    const record: LocalDownloadRecord = {
      downloadId: input.id,
      sourceUrl: input.sourceUrl,
      fileName: sanitizeFileName(input.fileName),
      expectedFileSize: input.fileSize,
      localUri: wipeWorkspace ? null : existing?.localUri ?? null,
      localState: 'failed',
      bytesWritten: wipeWorkspace ? 0 : (hlsState?.downloadedBytes ?? existing?.bytesWritten ?? 0),
      totalBytes: existing?.totalBytes ?? null,
      pauseState: null,
      rangeValidators: null,
      generation,
      errorCode: engineCode,
      errorMessage: toUserFacingErrorMessage(engineCode, message),
      remoteStatus: 'FAILED',
      retryCount: existing?.retryCount ?? 0,
      maxRetries:
        existing?.maxRetries ?? DOWNLOAD_ENGINE.maxAutoRetryAttempts,
      retryEligible: isManualRetryAllowed(engineCode),
      lastAttemptAt: new Date().toISOString(),
      nextRetryAt: null,
      updatedAt: new Date().toISOString(),
      hlsTransfer: wipeWorkspace
        ? null
        : hlsState
          ? { ...hlsState, lastFailureReason: engineCode }
          : existing?.hlsTransfer ?? null,
    };
    await upsertLocalRecord(record);

    try {
      await syncStatusImmediate(input.id, 'FAILED', {
        errorCode: engineCode,
        errorMessage: record.errorMessage,
      });
    } catch {
      // ignore
    }

    this.emit({
      type: 'failed',
      downloadId: input.id,
      code: engineCode,
      message: record.errorMessage ?? message,
    });
    this.emit({
      type: 'status',
      downloadId: input.id,
      status: 'FAILED',
      errorMessage: record.errorMessage,
    });
  }
}
