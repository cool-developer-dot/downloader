import { DownloadTask, File, type DownloadPauseState } from 'expo-file-system';
import { Platform } from 'react-native';

import { resumeAppendRangeTransfer } from './append-range-transfer';
import {
  assertEnoughDiskSpace,
  assertEnoughDiskSpaceForTransfer,
  assertValidDestination,
  deleteDownloadFiles,
  deleteFinalQuiet,
  deletePartialTransferQuiet,
  deleteRangePartQuiet,
  getPartialTransferFile,
  migrateLegacyFinalToPartial,
  resolveDestinationFile,
} from './file-paths';
import {
  classifyTransferError,
  classifyTransferFailure,
  DownloadEngineError,
  toUserFacingErrorMessage,
} from './errors';
import { DOWNLOAD_ENGINE } from './constants';
import {
  assertDurablePauseReady,
  buildDurablePauseState,
  mergeRangeValidators,
  parseAndroidResumeOffset,
  readPartialFileSize,
} from './pause-state';
import { upsertLocalRecord, getLocalRecord } from './persistence';
import {
  createProgressTracker,
  computeProgressPercent,
  normalizeTotalBytes,
  toTransferSnapshot,
} from './progress';
import { isManualRetryAllowed } from './retry-policy';
import {
  isSafeHttpUrl,
  sanitizeFileName,
  shouldUseHlsTransfer,
} from './resource-guard';
import {
  assertSourceIdentityCompatible,
  probeSourceIdentity,
} from './source-identity';
import {
  cleanupMultiRangeWorkspace,
  getGlobalNetworkBudget,
  hasResumableMultiRange,
  runMultiRangeTransfer,
  sumMultiRangeDownloaded,
} from './multi-range';
import { buildDownloadHeaders, mergeResumeHeaders } from './download-headers';
import {
  isAuthDeniedError,
  resolveEphemeralHeadersForTarget,
  tryBoundedAuthContextRetry,
} from './ephemeral-target-headers';
import { getDownloadSessionMeta, isSessionBoundMeta } from './download-session-meta';
import { fetchSingleStreamTransfer } from './fetch-single-stream-transfer';
import { StallWatchdog } from './stall-watchdog';
import {
  assertSessionContextReady,
  detectSocialCdnKind,
  shouldUseAuthenticatedFetchTransfer,
  shouldUseMultiRangeForSource,
} from './source-capability';
import {
  logDownloadRuntime,
  safeDownloadHostname,
} from './download-runtime-diagnostics.service';
import {
  logDownloadStateTransition,
  logFinalize,
  logFirstByte,
  logNetworkPolicy,
  logPauseResume,
  logDownloadRuntimeTrace,
  logTransferProgressThrottled,
  logWorkerLifecycle,
} from './audit-diagnostics.service';
import { logSocialDownload } from './social-download-diagnostics.service';
import { validateFinalDownloadFile } from './finalize-download';
import { applyCompletedFileIdentity } from '@/downloads/completed-file/apply-identity';
import { MIN_VALID_MEDIA_BYTES } from './media-signature';
import {
  capturePauseSettleHandle,
  createWorkerSettleBarrier,
  waitForCapturedSettle,
  waitForCapturedSettleWithTimeout,
  type PauseSettleHandle,
  type WorkerSettleBarrier,
} from './worker-settle';
import {
  awaitNativePauseTask,
  captureNativePauseState,
  shouldAbortAbortSignalAfterNativePause,
} from './pause-ack';
import {
  clearSyncState,
  syncProgressThrottled,
  syncStatusImmediate,
} from './synchronizer';
import type {
  EnqueueInput,
  EngineEvent,
  LocalDownloadRecord,
  MultiRangeTransferState,
  RangeValidators,
  TransferProgressSnapshot,
} from './types';

type Emit = (event: EngineEvent) => void;
type OnProgress = (snapshot: TransferProgressSnapshot) => void;
type GetActiveDownloadIds = () => string[];

type ActiveWorker = {
  downloadId: string;
  generation: number;
  task: DownloadTask | null;
  abortController: AbortController;
  running: boolean;
  /** Set by cancel() — beats late progress/completion callbacks. */
  cancelled: boolean;
  /** Set by pause() — run() must prefer PAUSED over FAILED if settle is noisy. */
  pauseRequested: boolean;
  /** Cumulative floor after resume — detect silent restart-from-0. */
  resumeByteFloor: number;
};

/**
 * Owns a single progressive HTTP(S) transfer lifecycle.
 * Completion requires file verification — network success alone is not enough.
 * Multi-range acceleration is delegated inside run() when eligible; otherwise
 * the existing single-stream / Phase 2 append-range path is used.
 */
export class TransferWorker {
  private active: ActiveWorker | null = null;
  private settleBarrier: WorkerSettleBarrier | null = null;
  private pauseSettleHandle: PauseSettleHandle | null = null;
  private capturedNativePause: DownloadPauseState | null = null;
  private finalizationCommitted = false;

  constructor(
    private readonly emit: Emit,
    private readonly onProgress: OnProgress,
    private readonly getActiveDownloadIds: GetActiveDownloadIds = () => [],
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

  /** Test/manager: generation this pause wait is bound to. */
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

  /** Progress ownership after pause is requested — blocks DOWNLOADING resurrection. */
  private canPublishTransferProgress(generation: number): boolean {
    return (
      this.isCurrentGeneration(generation) &&
      !this.active?.pauseRequested
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

    // Progressive worker refuses playlists — manager routes those to HlsTransferWorker.
    if (
      shouldUseHlsTransfer({
        sourceUrl: input.sourceUrl,
        streamType: input.streamType,
      })
    ) {
      await this.fail(
        input,
        existing,
        'HLS_UNSUPPORTED',
        toUserFacingErrorMessage('HLS_UNSUPPORTED'),
      );
      return;
    }

    const expectedBytes = Number(input.fileSize);

    const generation = (existing?.generation ?? 0) + 1;
    const finalFile = resolveDestinationFile(input.id, input.fileName, {
      sourceUrl: input.sourceUrl,
    });
    const transferFile = getPartialTransferFile(finalFile);
    assertValidDestination(transferFile);
    migrateLegacyFinalToPartial(finalFile, transferFile);

    const existingPartial = readPartialFileSize(transferFile);
    assertEnoughDiskSpaceForTransfer({
      expectedTotalBytes:
        Number.isFinite(expectedBytes) && expectedBytes > 0
          ? expectedBytes
          : existing?.totalBytes ?? null,
      partialBytes: existingPartial,
    });
    if (
      (!Number.isFinite(expectedBytes) || expectedBytes <= 0) &&
      existingPartial <= 0
    ) {
      assertEnoughDiskSpace(0);
    }

    const abortController = new AbortController();
    const tracker = createProgressTracker();

    let pauseState: DownloadPauseState | null = existing?.pauseState ?? null;
    let rangeValidators: RangeValidators | null =
      existing?.rangeValidators ?? null;
    let multiRangeState: MultiRangeTransferState | null =
      existing?.multiRange ?? null;
    let bytesWritten = existing?.bytesWritten ?? 0;
    let totalBytes = normalizeTotalBytes(existing?.totalBytes);
    let task: DownloadTask | null = null;
    let retryCount = existing?.retryCount ?? 0;
    const maxRetries =
      existing?.maxRetries ?? DOWNLOAD_ENGINE.maxAutoRetryAttempts;

    const recordBase = async (
      localState: LocalDownloadRecord['localState'],
      extras?: Partial<LocalDownloadRecord>,
    ) => {
      const record: LocalDownloadRecord = {
        downloadId: input.id,
        sourceUrl: input.sourceUrl,
        fileName: sanitizeFileName(input.fileName),
        expectedFileSize: input.fileSize,
        localUri: transferFile.uri,
        localState,
        bytesWritten,
        totalBytes,
        pauseState,
        rangeValidators,
        multiRange: multiRangeState,
        generation,
        errorCode: extras?.errorCode ?? null,
        errorMessage: extras?.errorMessage ?? null,
        remoteStatus: extras?.remoteStatus ?? null,
        retryCount,
        maxRetries,
        retryEligible: extras?.retryEligible ?? existing?.retryEligible ?? true,
        lastAttemptAt: extras?.lastAttemptAt ?? existing?.lastAttemptAt ?? null,
        nextRetryAt: extras?.nextRetryAt ?? null,
        updatedAt: new Date().toISOString(),
        ...extras,
      };
      await upsertLocalRecord(record);
      return record;
    };

    const publishProgress = (
      forceUi = false,
      localState: TransferProgressSnapshot['localState'] = 'transferring',
    ) => {
      if (localState === 'transferring') {
        if (!this.canPublishTransferProgress(generation) && !forceUi) {
          return null;
        }
      } else if (!this.isCurrentGeneration(generation) && !forceUi) {
        return null;
      }

      const noted = tracker.note(bytesWritten, totalBytes);
      const attemptBaseline = this.active?.resumeByteFloor ?? 0;
      if (
        !firstByteLogged &&
        bytesWritten > attemptBaseline &&
        localState === 'transferring'
      ) {
        firstByteLogged = true;
        logFirstByte({
          downloadId: input.id,
          latencyMs: Date.now() - transferStartedAt,
          bytesWritten,
          totalBytes: normalizeTotalBytes(totalBytes),
        });
      }
      if (bytesWritten > 0 && localState === 'transferring') {
        logTransferProgressThrottled({
          downloadId: input.id,
          bytesWritten,
          totalBytes: normalizeTotalBytes(totalBytes),
        });
      }
      const snapshot = toTransferSnapshot(
        input.id,
        {
          bytesWritten: noted.bytesWritten,
          totalBytes: noted.totalBytes,
          // Never publish a synthetic 0% over known cumulative bytes.
          progress:
            noted.progress === 0 && bytesWritten > attemptBaseline
              ? Math.max(
                  noted.progress,
                  computeProgressPercent(
                    bytesWritten,
                    normalizeTotalBytes(totalBytes) ??
                      normalizeTotalBytes(Number(input.fileSize)),
                  ),
                )
              : noted.progress,
          bytesPerSecond: noted.bytesPerSecond,
          etaSeconds: noted.etaSeconds,
        },
        transferFile.uri,
        localState,
      );
      snapshot.generation = generation;
      snapshot.attemptStartBytes = attemptBaseline;
      snapshot.workerState =
        bytesWritten > attemptBaseline ? 'TRANSFERRING' : 'STARTING';

      const knownTotal = normalizeTotalBytes(totalBytes);
      const shouldUpdateUi =
        forceUi || !('shouldUpdateUi' in noted) || noted.shouldUpdateUi;
      const shouldUpdateBackend =
        !forceUi &&
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
      task: null,
      abortController,
      running: true,
      cancelled: false,
      pauseRequested: false,
      resumeByteFloor: 0,
    };

    const transferStartedAt = Date.now();
    let firstByteLogged = false;
    const settleBarrier = createWorkerSettleBarrier();
    this.settleBarrier = settleBarrier;
    this.pauseSettleHandle = capturePauseSettleHandle(generation, settleBarrier);
    this.capturedNativePause = null;
    this.finalizationCommitted = false;

    const transferWatchdog = new StallWatchdog({
      downloadId: input.id,
      generation,
      shouldPause: () => Boolean(this.active?.pauseRequested),
      onStall: () => {
        if (!this.isCurrentGeneration(generation)) {
          return;
        }
        try {
          abortController.abort();
        } catch {
          // ignore
        }
        try {
          task?.cancel();
        } catch {
          // ignore
        }
      },
    });

    const armFirstByteWatchdog = (baselineBytes: number) => {
      transferWatchdog.startFirstBytePhase({
        generation,
        baselineBytes: Math.max(0, Math.trunc(baselineBytes)),
      });
    };

    const capturePauseState = (
      taskRef: DownloadTask | null,
    ): DownloadPauseState | null => {
      const fromTask =
        captureNativePauseState(taskRef) ?? this.capturedNativePause;
      return buildDurablePauseState(
        input.sourceUrl,
        transferFile,
        fromTask ?? pauseState,
        bytesWritten,
      );
    };

    const settlePaused = async (nextPause: DownloadPauseState | null) => {
      let durable = nextPause
        ? buildDurablePauseState(
            input.sourceUrl,
            transferFile,
            nextPause,
            bytesWritten,
          )
        : capturePauseState(task);

      if (!durable) {
        durable = capturePauseState(task);
      }

      // USER_PAUSE: transport is already down. Persist PAUSED from disk when
      // possible; do not fail the user because native pause() was redundant.
      if (!durable && this.active?.pauseRequested && !this.active.cancelled) {
        const diskBytes = readPartialFileSize(transferFile);
        if (diskBytes > 0) {
          durable = buildDurablePauseState(
            input.sourceUrl,
            transferFile,
            this.capturedNativePause ?? pauseState,
            Math.max(bytesWritten, diskBytes),
          );
        }
      }

      if (!durable && this.active?.pauseRequested && !this.active.cancelled) {
        pauseState = this.capturedNativePause ?? pauseState;
        await recordBase('paused', {
          pauseState,
          rangeValidators,
          multiRange: multiRangeState,
          remoteStatus: 'PAUSED',
          errorCode: null,
          errorMessage: null,
        });
        if (!this.isCurrentGeneration(generation)) {
          return;
        }
        this.emit({
          type: 'status',
          downloadId: input.id,
          status: 'PAUSED',
          workerState: 'PAUSED',
        });
        publishProgress(true, 'paused');
        await syncStatusImmediate(input.id, 'PAUSED');
        return;
      }

      // Never declare a clean PAUSED without durable resume state + matching partial
      // unless USER_PAUSE already persisted above.
      if (!durable) {
        throw new DownloadEngineError(
          'PAUSE_FAILED',
          'Couldn’t pause this download right now. Try again in a moment.',
        );
      }

      assertDurablePauseReady(transferFile, durable, {
        // iOS opaque resume may have empty destination while resumeData is valid.
        requireBytes: parseAndroidResumeOffset(durable.resumeData) != null,
      });

      pauseState = durable;
      const offset = parseAndroidResumeOffset(durable.resumeData);
      if (offset != null) {
        bytesWritten = Math.max(bytesWritten, offset);
      } else {
        bytesWritten = Math.max(bytesWritten, readPartialFileSize(transferFile));
      }

      await recordBase('paused', {
        pauseState: durable,
        rangeValidators,
        multiRange: multiRangeState,
        remoteStatus: 'PAUSED',
        errorCode: null,
        errorMessage: null,
      });
      if (!this.isCurrentGeneration(generation)) {
        return;
      }
      // Status before paused progress so the store bridge does not drop the snapshot
      // while still showing DOWNLOADING.
      this.emit({
        type: 'status',
        downloadId: input.id,
        status: 'PAUSED',
        workerState: 'PAUSED',
      });
      publishProgress(true, 'paused');
      // Status-only PAUSED sync — do not bundle regressing progress.
      await syncStatusImmediate(input.id, 'PAUSED');
    };

    const settleMultiRangePaused = async (state: MultiRangeTransferState) => {
      multiRangeState = state;
      rangeValidators = mergeRangeValidators(
        rangeValidators,
        state.sourceValidators,
      );
      bytesWritten = sumMultiRangeDownloaded(state);
      totalBytes = state.contentLength;
      // Multi-range pause uses part checkpoints — not DownloadTask resumeData.
      pauseState = null;

      await recordBase('paused', {
        pauseState: null,
        multiRange: state,
        rangeValidators,
        remoteStatus: 'PAUSED',
        errorCode: null,
        errorMessage: null,
      });
      if (!this.isCurrentGeneration(generation)) {
        return;
      }
      this.emit({
        type: 'status',
        downloadId: input.id,
        status: 'PAUSED',
        workerState: 'PAUSED',
      });
      publishProgress(true, 'paused');
      await syncStatusImmediate(input.id, 'PAUSED');
    };

    let resumeRestartDetected = false;

    try {
      await recordBase('transferring', { remoteStatus: 'QUEUED' });
      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      // Best-effort source identity capture / revalidation before bytes move.
      assertSessionContextReady(input.sourceUrl, input.requestContext, input.id);
      let resolved = await resolveEphemeralHeadersForTarget({
        downloadId: input.id,
        targetUrl: input.sourceUrl,
        requestKind: 'progressive',
        checkCoherence: true,
      });
      let sessionHeaders =
        Object.keys(resolved.headers).length > 0
          ? resolved.headers
          : buildDownloadHeaders(input.requestContext);
      logDownloadRuntime('start', {
        downloadId: input.id,
        hostname: safeDownloadHostname(input.sourceUrl),
      });
      logDownloadRuntime('request_context', {
        hasReferer: Boolean(sessionHeaders.Referer),
        hasCookies: Boolean(sessionHeaders.Cookie),
        hasUserAgent: Boolean(sessionHeaders['User-Agent']),
      });
      logSocialDownload('start', input.sourceUrl, {
        platform: detectSocialCdnKind(input.sourceUrl),
        hasReferer: Boolean(sessionHeaders.Referer),
        hasCookie: Boolean(sessionHeaders.Cookie),
        hasUserAgent: Boolean(sessionHeaders['User-Agent']),
      });

      try {
        const probe = await probeSourceIdentity(
          input.sourceUrl,
          abortController.signal,
          sessionHeaders,
        );
        if (probe.validators) {
          if (
            pauseState?.resumeData ||
            existingPartial > 0 ||
            hasResumableMultiRange(multiRangeState)
          ) {
            assertSourceIdentityCompatible(rangeValidators, probe.validators);
          }
          rangeValidators = mergeRangeValidators(
            rangeValidators,
            probe.validators,
          );
          if (
            probe.validators.contentLength != null &&
            probe.validators.contentLength > 0
          ) {
            totalBytes =
              normalizeTotalBytes(totalBytes) ??
              normalizeTotalBytes(probe.validators.contentLength);
          }
        }
      } catch (probeError) {
        if (
          probeError instanceof DownloadEngineError &&
          (probeError.code === 'SOURCE_CHANGED' ||
            probeError.code === 'AUTH_ERROR' ||
            probeError.code === 'INVALID_RESOURCE' ||
            probeError.code === 'CANCELLED')
        ) {
          throw probeError;
        }
        // Soft failure — continue without validators.
      }

      let transferPromise: Promise<File | null>;

      const handleNativeProgress = (data: {
        bytesWritten: number;
        totalBytes: number | null;
      }) => {
        if (!this.canPublishTransferProgress(generation)) {
          return;
        }

        const floor = this.active?.resumeByteFloor ?? 0;
        const nextBytes = Math.max(0, data.bytesWritten);

        // Expo Android rewrites from byte 0 when Range is ignored (HTTP 200).
        // Abort instead of corrupting the partial / presenting a fake fresh start.
        if (floor > 0 && nextBytes + 1024 < floor) {
          resumeRestartDetected = true;
          try {
            abortController.abort();
          } catch {
            // ignore
          }
          try {
            task?.cancel();
          } catch {
            // ignore
          }
          return;
        }

        bytesWritten = Math.max(floor, nextBytes);
        transferWatchdog.noteBytes(bytesWritten);
        const nextTotal = normalizeTotalBytes(data.totalBytes);
        if (nextTotal != null) {
          totalBytes =
            totalBytes != null ? Math.max(nextTotal, totalBytes) : nextTotal;
        }
        publishProgress(false, 'transferring');
      };

      // Multi-range acceleration (Android progressive only). Never convert an
      // in-flight single-stream Phase 2 resume (pauseState.resumeData).
      const preferSingleStreamResume = Boolean(pauseState?.resumeData);
      const tryMultiRange =
        Platform.OS === 'android' &&
        !preferSingleStreamResume &&
        shouldUseMultiRangeForSource(input.sourceUrl, input.requestContext, Platform.OS) &&
        (hasResumableMultiRange(multiRangeState) || existingPartial <= 0);

      if (tryMultiRange) {
        this.active.task = null;
        if (hasResumableMultiRange(multiRangeState)) {
          bytesWritten = Math.max(
            bytesWritten,
            sumMultiRangeDownloaded(multiRangeState!),
          );
          totalBytes =
            normalizeTotalBytes(totalBytes) ??
            multiRangeState!.contentLength;
          this.active.resumeByteFloor = bytesWritten;
          tracker.seed(bytesWritten);
        }
        publishProgress(true, 'transferring');
        armFirstByteWatchdog(bytesWritten);

        const multiResult = await runMultiRangeTransfer({
          downloadId: input.id,
          sourceUrl: input.sourceUrl,
          destination: transferFile,
          knownFileSize:
            Number.isFinite(expectedBytes) && expectedBytes > 0
              ? expectedBytes
              : totalBytes,
          platformOs: Platform.OS,
          priorValidators: rangeValidators,
          priorState: multiRangeState,
          activeDownloadIds: this.getActiveDownloadIds(),
          signal: abortController.signal,
          shouldPause: () => Boolean(this.active?.pauseRequested),
          sessionHeaders,
          onProgress: (event) => {
            if (!this.canPublishTransferProgress(generation)) {
              return;
            }
            bytesWritten = event.bytesWritten;
            totalBytes = event.totalBytes;
            transferWatchdog.noteBytes(bytesWritten);
            publishProgress(false, 'transferring');
          },
          stallWatchdog: transferWatchdog,
          onCheckpoint: (state, force) => {
            multiRangeState = state;
            rangeValidators = mergeRangeValidators(
              rangeValidators,
              state.sourceValidators,
            );
            bytesWritten = sumMultiRangeDownloaded(state);
            totalBytes = state.contentLength;
            if (force) {
              void recordBase('transferring', {
                remoteStatus: 'DOWNLOADING',
                multiRange: state,
              });
            }
          },
        });

        if (!this.isCurrentGeneration(generation)) {
          return;
        }

        if (multiResult.status === 'completed') {
          multiRangeState = null;
          await this.complete(
            input,
            finalFile,
            transferFile,
            multiResult.file,
            multiResult.state.contentLength,
            generation,
          );
          return;
        }

        if (multiResult.status === 'paused') {
          await settleMultiRangePaused(multiResult.state);
          return;
        }

        // Ineligible → existing single-stream. Never mix with an active multi-range checkpoint.
        if (hasResumableMultiRange(multiRangeState)) {
          throw new DownloadEngineError(
            'TRANSFER_INTERRUPTED',
            'Unable to continue this multi-range download.',
          );
        }
        await cleanupMultiRangeWorkspace(input.id);
        multiRangeState = null;
      }

      if (pauseState?.resumeData) {
        const durable = buildDurablePauseState(
          input.sourceUrl,
          transferFile,
          pauseState,
          bytesWritten,
        );
        if (!durable?.resumeData) {
          throw new DownloadEngineError(
            'RESUME_STATE_MISSING',
            'Unable to resume this download.',
          );
        }

        const androidOffset = parseAndroidResumeOffset(durable.resumeData);
        const partialSize = readPartialFileSize(transferFile);
        // Android numeric resume needs on-disk bytes. iOS opaque resumeData can
        // resume from a temp file even when the transfer file size is still 0.
        if (partialSize <= 0 && androidOffset != null) {
          throw new DownloadEngineError(
            'PARTIAL_FILE_MISSING',
            'The partial download file is no longer available.',
          );
        }
        if (partialSize <= 0 && !durable.resumeData) {
          throw new DownloadEngineError(
            'PARTIAL_FILE_MISSING',
            'The partial download file is no longer available.',
          );
        }

        pauseState = {
          ...durable,
          resumeData:
            androidOffset != null ? String(partialSize) : durable.resumeData,
          fileUri: transferFile.uri,
          isDirectory: false,
        };
        bytesWritten = Math.max(bytesWritten, partialSize);
        totalBytes =
          normalizeTotalBytes(totalBytes) ??
          normalizeTotalBytes(Number(input.fileSize));
        this.active.resumeByteFloor = partialSize;
        tracker.seed(partialSize);

        publishProgress(true, 'transferring');

        // Android: HTTP Range append only. Never Expo resumeAsync (truncates on
        // HTTP 200) and never a fresh downloadAsync (deletes the partial).
        const useAppendRangeResume = Platform.OS === 'android' && partialSize > 0;

        if (useAppendRangeResume) {
          this.active.task = null;
          armFirstByteWatchdog(partialSize);
          transferPromise = resumeAppendRangeTransfer({
            sourceUrl: input.sourceUrl,
            destination: transferFile,
            offset: partialSize,
            signal: abortController.signal,
            headers: {
              ...mergeResumeHeaders(pauseState.headers ?? null, null),
              ...sessionHeaders,
            },
            validators: rangeValidators,
            knownTotalBytes: totalBytes,
            shouldPause: () => Boolean(this.active?.pauseRequested),
            onProgress: (data) => {
              handleNativeProgress({
                bytesWritten: data.bytesWritten,
                totalBytes: data.totalBytes,
              });
            },
            onValidators: (next) => {
              rangeValidators = mergeRangeValidators(rangeValidators, next);
            },
            stallWatchdog: transferWatchdog,
          });
        } else {
          armFirstByteWatchdog(bytesWritten);
          task = DownloadTask.fromSavable(pauseState, {
            signal: abortController.signal,
            onProgress: handleNativeProgress,
            sessionType: 'background',
          });
          this.active.task = task;
          transferPromise = task.resumeAsync();
        }
      } else {
        // Fresh transfer — remove any partial workspace first.
        try {
          deletePartialTransferQuiet(transferFile);
          deleteFinalQuiet(finalFile);
        } catch {
          // continue; createDownloadTask may overwrite depending on platform
        }

        if (!this.isCurrentGeneration(generation)) {
          return;
        }

        this.active.resumeByteFloor = 0;
        const useAuthenticatedFetch = shouldUseAuthenticatedFetchTransfer(
          input.sourceUrl,
          input.requestContext,
          Platform.OS,
        );

        if (useAuthenticatedFetch) {
          this.active.task = null;
          armFirstByteWatchdog(0);
          transferPromise = fetchSingleStreamTransfer({
            sourceUrl: input.sourceUrl,
            destination: transferFile,
            signal: abortController.signal,
            headers: sessionHeaders,
            knownTotalBytes:
              Number.isFinite(expectedBytes) && expectedBytes > 0
                ? expectedBytes
                : totalBytes,
            shouldPause: () => Boolean(this.active?.pauseRequested),
            onProgress: handleNativeProgress,
            stallWatchdog: transferWatchdog,
          });
        } else {
          armFirstByteWatchdog(0);
          task = File.createDownloadTask(input.sourceUrl, transferFile, {
            signal: abortController.signal,
            onProgress: handleNativeProgress,
            sessionType: 'background',
            headers: Object.keys(sessionHeaders).length > 0 ? sessionHeaders : undefined,
          });
          this.active.task = task;
          transferPromise = task.downloadAsync();
        }
      }

      await syncStatusImmediate(input.id, 'QUEUED', { workerState: 'STARTING' });

      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      let file: File | null;
      try {
        file = await transferPromise;
      } catch (transferError) {
        if (resumeRestartDetected) {
          throw new DownloadEngineError(
            'RESUME_UNSUPPORTED',
            'This server doesn’t support resumable downloads.',
          );
        }
        if (this.active.pauseRequested) {
          throw transferError;
        }
        const floor = this.active.resumeByteFloor;
        if (floor > 0 && readPartialFileSize(transferFile) + 1024 < floor) {
          throw new DownloadEngineError(
            'RESUME_UNSUPPORTED',
            'This server doesn’t support resumable downloads.',
          );
        }

        const classifiedAuth = classifyTransferError(transferError);
        if (
          (classifiedAuth.code === 'AUTH_ERROR' || isAuthDeniedError(classifiedAuth)) &&
          isSessionBoundMeta(getDownloadSessionMeta(input.id))
        ) {
          resolved = await tryBoundedAuthContextRetry({
            downloadId: input.id,
            targetUrl: input.sourceUrl,
            requestKind: 'progressive',
          });
          sessionHeaders =
            Object.keys(resolved.headers).length > 0
              ? resolved.headers
              : sessionHeaders;
          try {
            deletePartialTransferQuiet(transferFile);
          } catch {
            // ignore
          }
          this.active.resumeByteFloor = 0;
          armFirstByteWatchdog(0);
          transferPromise = fetchSingleStreamTransfer({
            sourceUrl: input.sourceUrl,
            destination: transferFile,
            signal: abortController.signal,
            headers: sessionHeaders,
            knownTotalBytes:
              Number.isFinite(expectedBytes) && expectedBytes > 0
                ? expectedBytes
                : totalBytes,
            shouldPause: () => Boolean(this.active?.pauseRequested),
            onProgress: handleNativeProgress,
            stallWatchdog: transferWatchdog,
          });
          file = await transferPromise;
        } else {
          throw transferError;
        }
      }

      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      // USER_PAUSE must not finalize a partial just because native returned a File.
      // Legitimate completion (full object already on disk) still wins.
      if (this.active.pauseRequested && !this.active.cancelled) {
        const diskNow = readPartialFileSize(transferFile);
        const knownTotal = normalizeTotalBytes(totalBytes);
        const completionWon =
          file != null &&
          knownTotal != null &&
          knownTotal > 0 &&
          diskNow + 1024 >= knownTotal;
        if (!completionWon) {
          if (hasResumableMultiRange(multiRangeState)) {
            await settleMultiRangePaused(multiRangeState!);
            return;
          }
          await settlePaused(capturePauseState(task));
          return;
        }
      }

      if (file === null) {
        await settlePaused(capturePauseState(task));
        return;
      }

      await this.complete(input, finalFile, transferFile, file, totalBytes, generation);
    } catch (error) {
      if (!this.active || this.active.generation !== generation) {
        return;
      }

      // pause() may abort the fetch to unblock reads — USER_PAUSE, never FAILED.
      if (this.active.pauseRequested && !this.active.cancelled) {
        try {
          if (hasResumableMultiRange(multiRangeState)) {
            await settleMultiRangePaused(multiRangeState!);
            return;
          }
          const nextPause = capturePauseState(task);
          await settlePaused(nextPause);
          return;
        } catch (pauseError) {
          // Transport already stopped. Last-chance persist PAUSED so manager can
          // commit — do not leave DOWNLOADING after a successful abort.
          try {
            await recordBase('paused', {
              pauseState:
                capturePauseState(task) ??
                this.capturedNativePause ??
                pauseState,
              rangeValidators,
              multiRange: multiRangeState,
              remoteStatus: 'PAUSED',
              errorCode: null,
              errorMessage: null,
            });
            if (this.isCurrentGeneration(generation)) {
              this.emit({
                type: 'status',
                downloadId: input.id,
                status: 'PAUSED',
                workerState: 'PAUSED',
              });
              publishProgress(true, 'paused');
            }
          } catch {
            // Manager still commits from disk / transport-stop truth.
          }
          void pauseError;
          return;
        }
      }

      // External cancel() owns terminal CANCELLED sync/emit/cleanup.
      if (this.active.cancelled || abortController.signal.aborted) {
        if (resumeRestartDetected) {
          const classifiedRestart = new DownloadEngineError(
            'RESUME_UNSUPPORTED',
            'This server doesn’t support resumable downloads.',
          );
          await this.fail(
            input,
            existing,
            classifiedRestart.code,
            classifiedRestart.message,
            generation,
            {
              finalFile,
              transferFile,
              bytesWritten: Math.max(bytesWritten, this.active.resumeByteFloor),
              totalBytes,
              pauseState,
              rangeValidators,
              wipePartial: true,
            },
          );
          return;
        }
        this.active.running = false;
        return;
      }

      const classified = classifyTransferFailure(error).error;
      if (classified.code === 'CANCELLED') {
        this.active.running = false;
        return;
      }

      let failCode = classified.code;
      let failMessage = classified.message;
      if (
        (failCode === 'AUTH_ERROR' || isAuthDeniedError(classified)) &&
        isSessionBoundMeta(getDownloadSessionMeta(input.id))
      ) {
        const meta = getDownloadSessionMeta(input.id);
        if (!meta || meta.authRetryBudget <= 0) {
          failCode = 'SESSION_EXPIRED';
          failMessage =
            'Your website session expired. Open the website and try again.';
        }
      }

      // Resume outcomes:
      // - Retryable network → FAILED with partial preserved (auto-retry).
      // - SOURCE_CHANGED / invalid range / resume unsupported → FAILED + wipe.
      // - Other resume failures → FAILED; preserve only when disk partial is safe.
      const wasResuming =
        this.active.resumeByteFloor > 0 ||
        existing?.localState === 'paused' ||
        existing?.remoteStatus === 'PAUSED' ||
        Boolean(existing?.pauseState?.resumeData) ||
        hasResumableMultiRange(multiRangeState) ||
        hasResumableMultiRange(existing?.multiRange);

      if (wasResuming) {
        const wipeCodes = new Set([
          'SOURCE_CHANGED',
          'RESUME_UNSUPPORTED',
          'RANGE_REJECTED',
          'INVALID_RANGE_RESPONSE',
          'PARTIAL_FILE_MISSING',
          'RESUME_STATE_MISSING',
          'PARTIAL_FILE_CORRUPT',
          'MERGE_FAILED',
          'PART_SIZE_MISMATCH',
          'FINAL_SIZE_MISMATCH',
          'AUTH_ERROR',
          'SESSION_EXPIRED',
          'SESSION_CHANGED',
          'SESSION_CONTEXT_LOST',
          'AUTH_CONTEXT_UNAVAILABLE',
          'INVALID_RESOURCE',
        ]);
        const shouldWipe = wipeCodes.has(failCode);
        await this.fail(
          input,
          existing,
          failCode,
          failMessage,
          generation,
          {
            finalFile,
            transferFile,
            bytesWritten,
            totalBytes,
            pauseState,
            rangeValidators,
            multiRange: multiRangeState,
            wipePartial: shouldWipe,
          },
        );
        return;
      }

      await this.fail(
        input,
        existing,
        failCode,
        failMessage,
        generation,
        {
          finalFile,
          transferFile,
          bytesWritten,
          totalBytes,
          pauseState,
          rangeValidators,
          multiRange: multiRangeState,
        },
      );
    } finally {
      transferWatchdog.stop();
      settleBarrier.resolve();
      this.settleBarrier = null;
      if (this.active?.generation === generation) {
        try {
          this.active.task?.release();
        } catch {
          // ignore
        }
        this.active.running = false;
        // Keep cancelled flag visible until manager clears the worker map entry.
        if (!this.active.cancelled) {
          this.active = null;
        }
      }
    }
  }

  async pause(downloadId: string): Promise<boolean> {
    if (!this.active || this.active.downloadId !== downloadId) {
      return false;
    }
    if (this.active.cancelled) {
      return false;
    }

    this.active.pauseRequested = true;
    this.pauseSettleHandle = capturePauseSettleHandle(
      this.active.generation,
      this.settleBarrier,
    );

    const task = this.active.task;
    const nativePauseApplies = Boolean(task && typeof task.pause === 'function');
    let nativeAttempted = false;

    // Native pause FIRST so Expo can flush the partial + resumeData.
    // Abort-first leaves the writer dead with no checkpoint.
    if (nativePauseApplies) {
      const native = await awaitNativePauseTask(task);
      nativeAttempted = native.attempted;
      void native.redundantFalse;
      this.capturedNativePause = captureNativePauseState(task);
    }

    // Fetch / multi-range / append-range: abort unblocks the reader.
    // Native DownloadTask: pause() already cancelled OkHttp with isPausing=true.
    // Aborting the wired AbortSignal calls DownloadTask.cancel() which can hang
    // downloadAsync() forever (native isCancelling return without coroutine resume).
    if (
      shouldAbortAbortSignalAfterNativePause({
        hasNativeDownloadTask: nativePauseApplies,
        nativePauseAttempted: nativeAttempted,
      })
    ) {
      try {
        this.active.abortController.abort();
      } catch {
        // ignore
      }
    } else {
      logDownloadRuntimeTrace({
        downloadId,
        event: 'PAUSE_ABORT_SKIPPED_NATIVE_TASK',
        operation: 'native_pause_owns_okhttp',
      });
    }

    return true;
  }

  /**
   * Abort the in-flight native transfer. Manager owns CANCELLED persistence.
   * Sets cancelled so a late completion callback cannot resurrect the job.
   */
  async cancel(downloadId: string): Promise<boolean> {
    if (!this.active || this.active.downloadId !== downloadId) {
      return false;
    }
    this.active.cancelled = true;
    this.active.running = false;
    try {
      this.active.abortController.abort();
      this.active.task?.cancel();
      getGlobalNetworkBudget().releaseAll(downloadId);
      await cleanupMultiRangeWorkspace(downloadId);
      return true;
    } catch {
      getGlobalNetworkBudget().releaseAll(downloadId);
      return true;
    }
  }

  private async complete(
    input: EnqueueInput,
    finalFile: File,
    transferFile: File,
    file: File,
    totalBytes: number | null,
    generation: number,
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

    // Cancellation must beat late completion.
    if (!this.isCurrentGeneration(generation)) {
      try {
        if (file.exists) {
          file.delete();
        }
      } catch {
        // ignore
      }
      return;
    }

    const expected =
      normalizeTotalBytes(totalBytes) ??
      (Number(input.fileSize) > 0 ? Number(input.fileSize) : null);

    // Drop any leftover range temp before final verification.
    deleteRangePartQuiet(transferFile);
    deleteRangePartQuiet(finalFile);

    const fileSize =
      typeof transferFile.size === 'number' && Number.isFinite(transferFile.size)
        ? Math.trunc(transferFile.size)
        : typeof file.size === 'number' && Number.isFinite(file.size)
          ? Math.trunc(file.size)
          : 0;
    logDownloadRuntime('bytes_written', {
      actual: fileSize,
      expected: expected ?? null,
    });

    // Finalizing phase — bytes complete at 100%, validation runs separately.
    const finalizingBytes = fileSize > 0 ? fileSize : (expected ?? 0);
    const finalizingSnapshot = toTransferSnapshot(
      input.id,
      {
        bytesWritten: finalizingBytes,
        totalBytes: expected ?? (fileSize > 0 ? fileSize : null),
        progress: 100,
        bytesPerSecond: null,
        etaSeconds: 0,
      },
      transferFile.uri,
      'finalizing',
    );
    finalizingSnapshot.workerState = 'VERIFYING';
    this.onProgress(finalizingSnapshot);
    await syncStatusImmediate(input.id, 'DOWNLOADING', {
      progress: 100,
      workerState: 'VERIFYING',
    });

    const finalizeWatchdog = new StallWatchdog({ downloadId: input.id });
    finalizeWatchdog.enterFinalizing();
    finalizeWatchdog.start();

    try {
      finalizeWatchdog.assertHealthy();

      const validation = await validateFinalDownloadFile({
        file: transferFile,
        destination: finalFile,
        expectedBytes: expected,
        downloadId: input.id,
      });

      if (!validation.ok) {
        logDownloadRuntime('validation', { ok: false, stage: 'finalize' });
        try {
          deleteRangePartQuiet(transferFile);
          deletePartialTransferQuiet(transferFile);
          deleteFinalQuiet(finalFile);
        } catch {
          // ignore
        }
        await this.fail(
          input,
          null,
          validation.code,
          validation.message,
          generation,
          {
            transferFile,
            finalFile,
            bytesWritten: fileSize,
            totalBytes: expected,
            pauseState: null,
            rangeValidators: null,
            wipePartial: true,
          },
        );
        return;
      }

      logDownloadRuntime('signature', { ok: true });
      logDownloadRuntime('validation', { ok: true });
      logDownloadRuntime('commit', { downloadId: input.id });
      logFinalize({
        downloadId: input.id,
        tempPathCategory: 'download_workspace',
        finalBytes: validation.size,
        signatureValidation: true,
        containerValidation: true,
        commitSuccess: true,
        libraryEligible: true,
      });

      // Re-check after verification I/O — cancel may have landed.
      if (!this.isCurrentGeneration(generation)) {
        try {
          deletePartialTransferQuiet(transferFile);
          deleteFinalQuiet(finalFile);
        } catch {
          // ignore
        }
        return;
      }

      const finalSize = String(validation.size);
      let identityLocalUri = validation.finalUri;
      let identityFileName = sanitizeFileName(input.fileName);
      let identityMime: string | null = null;
      let identityContainer: string | null = null;

      try {
        const identity = await applyCompletedFileIdentity({
          downloadId: input.id,
          finalUri: validation.finalUri,
          currentFileName: sanitizeFileName(input.fileName),
          fileSize: validation.size,
          displayTitle: input.title ?? null,
          sourceUrl: input.sourceUrl,
          evidence: {
            signatureKind: validation.signatureKind,
          },
        });
        identityLocalUri = identity.localUri;
        identityFileName = identity.fileName;
        identityMime = identity.descriptor.mimeType;
        identityContainer = identity.descriptor.container;
      } catch {
        // Keep Phase 1 validated path — identity is best-effort metadata.
      }

      const record: LocalDownloadRecord = {
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
        multiRange: null,
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
      };
      await upsertLocalRecord(record);

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
        record.localUri,
        'complete',
      );
      this.onProgress(snapshot);

      // File is local truth — always mark complete locally even if PATCH fails.
      try {
        await syncStatusImmediate(input.id, 'COMPLETED', {
          progress: 100,
          fileSize: finalSize,
          fileName: identityFileName,
          errorMessage: null,
          workerState: 'COMPLETED',
        });
      } catch {
        // synchronizer already swallows; keep local complete
      }

      if (!this.isCurrentGeneration(generation)) {
        return;
      }

      this.emit({
        type: 'completed',
        downloadId: input.id,
        localUri: record.localUri!,
        fileSize: finalSize,
        progress: 100,
        fileName: identityFileName,
        mimeType: identityMime,
        container: identityContainer,
      });
      this.emit({ type: 'status', downloadId: input.id, status: 'COMPLETED' });
      this.finalizationCommitted = true;
    } finally {
      finalizeWatchdog.stop();
    }
  }

  private async fail(
    input: EnqueueInput,
    existing: LocalDownloadRecord | null,
    code: LocalDownloadRecord['errorCode'] & string,
    message: string,
    generation = (existing?.generation ?? 0) + 1,
    context?: {
      finalFile?: ReturnType<typeof resolveDestinationFile>;
      transferFile?: File;
      bytesWritten?: number;
      totalBytes?: number | null;
      pauseState?: LocalDownloadRecord['pauseState'];
      rangeValidators?: RangeValidators | null;
      multiRange?: MultiRangeTransferState | null;
      wipePartial?: boolean;
    },
  ): Promise<void> {
    if (this.active?.cancelled) {
      return;
    }

    const engineCode = code as NonNullable<LocalDownloadRecord['errorCode']>;
    const classification = classifyTransferFailure(
      new DownloadEngineError(engineCode, message),
    );
    const finalFile =
      context?.finalFile ??
      resolveDestinationFile(input.id, input.fileName, {
        sourceUrl: input.sourceUrl,
      });
    const transferFile =
      context?.transferFile ?? getPartialTransferFile(finalFile);

    deleteRangePartQuiet(transferFile);
    deleteRangePartQuiet(finalFile);

    const wipe =
      context?.wipePartial === true ||
      engineCode === 'SOURCE_CHANGED' ||
      engineCode === 'RESUME_UNSUPPORTED' ||
      engineCode === 'RANGE_REJECTED' ||
      engineCode === 'INVALID_RANGE_RESPONSE' ||
      engineCode === 'PARTIAL_FILE_CORRUPT' ||
      engineCode === 'FINAL_FILE_INVALID' ||
      engineCode === 'MERGE_FAILED' ||
      engineCode === 'PART_SIZE_MISMATCH' ||
      engineCode === 'FINAL_SIZE_MISMATCH' ||
      engineCode === 'INVALID_RESOURCE' ||
      engineCode === 'AUTH_ERROR' ||
      engineCode === 'SESSION_EXPIRED' ||
      engineCode === 'SESSION_CHANGED' ||
      engineCode === 'SESSION_CONTEXT_LOST' ||
      engineCode === 'AUTH_CONTEXT_UNAVAILABLE';

    let pauseState: LocalDownloadRecord['pauseState'] = null;
    let bytesWritten = 0;
    let localUri: string | null = null;
    let rangeValidators = context?.rangeValidators ?? existing?.rangeValidators ?? null;
    let multiRange: MultiRangeTransferState | null =
      context?.multiRange ?? existing?.multiRange ?? null;

    if (!wipe) {
      if (hasResumableMultiRange(multiRange)) {
        bytesWritten = sumMultiRangeDownloaded(multiRange!);
        localUri = transferFile.uri;
        pauseState = null;
      } else {
        const durable = buildDurablePauseState(
          input.sourceUrl,
          transferFile,
          context?.pauseState ?? existing?.pauseState,
          context?.bytesWritten ?? existing?.bytesWritten ?? 0,
        );
        if (durable) {
          try {
            assertDurablePauseReady(transferFile, durable, {
              requireBytes: parseAndroidResumeOffset(durable.resumeData) != null,
            });
            pauseState = durable;
            bytesWritten =
              parseAndroidResumeOffset(durable.resumeData) ??
              readPartialFileSize(transferFile);
            localUri = transferFile.uri;
            multiRange = null;
          } catch {
            // Partial unsafe — wipe rather than risk a corrupt append later.
            try {
              await deleteDownloadFiles(input.id);
            } catch {
              // ignore
            }
            pauseState = null;
            bytesWritten = 0;
            localUri = null;
            rangeValidators = null;
            multiRange = null;
          }
        } else if ((context?.bytesWritten ?? 0) <= 0) {
          // No durable bytes — clean empty job dir noise.
          try {
            await deleteDownloadFiles(input.id);
          } catch {
            // ignore
          }
          multiRange = null;
        }
      }
    } else {
      try {
        await cleanupMultiRangeWorkspace(input.id);
        await deleteDownloadFiles(input.id);
      } catch {
        // ignore
      }
      rangeValidators = null;
      multiRange = null;
    }

    const retryEligible = isManualRetryAllowed(engineCode);
    const record: LocalDownloadRecord = {
      downloadId: input.id,
      sourceUrl: input.sourceUrl,
      fileName: sanitizeFileName(input.fileName),
      expectedFileSize: input.fileSize,
      localUri,
      localState: 'failed',
      bytesWritten,
      totalBytes:
        context?.totalBytes ?? existing?.totalBytes ?? null,
      pauseState,
      rangeValidators,
      multiRange,
      generation,
      errorCode: engineCode,
      errorMessage: toUserFacingErrorMessage(engineCode, message),
      remoteStatus: 'FAILED',
      retryCount: existing?.retryCount ?? 0,
      maxRetries:
        existing?.maxRetries ?? DOWNLOAD_ENGINE.maxAutoRetryAttempts,
      retryEligible,
      lastAttemptAt: new Date().toISOString(),
      nextRetryAt: null,
      updatedAt: new Date().toISOString(),
    };
    await upsertLocalRecord(record);

    const snapshot = toTransferSnapshot(
      input.id,
      {
        bytesWritten,
        totalBytes: record.totalBytes,
        progress:
          record.totalBytes != null && record.totalBytes > 0
            ? Math.min(
                99,
                Math.floor((bytesWritten / record.totalBytes) * 100),
              )
            : 0,
        bytesPerSecond: null,
        etaSeconds: null,
      },
      localUri,
      'failed',
      engineCode,
      record.errorMessage,
    );
    this.onProgress(snapshot);

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

    // Expose classification for manager auto-retry via local record fields.
    void classification;
  }
}

export async function cleanupCancelledDownload(downloadId: string): Promise<void> {
  clearSyncState(downloadId);
  await deleteDownloadFiles(downloadId);
}
