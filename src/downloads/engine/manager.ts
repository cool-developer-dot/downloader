import {
  DOWNLOAD_ENGINE,
} from './constants';
import { DownloadEngineError, toUserFacingErrorMessage } from './errors';
import {
  deleteDownloadFiles,
  deleteFinalQuiet,
  deletePartialTransferQuiet,
  deleteRangePartQuiet,
  resolveDestinationFile,
  resolveTransferTargets,
  verifyCompletedFile,
  verifyPartialForRetry,
} from './file-paths';
import { cleanupHlsWorkspace, HlsTransferWorker } from './hls';
import {
  cleanupMultiRangeWorkspace,
  hasResumableMultiRange,
  sumMultiRangeDownloaded,
} from './multi-range';
import {
  assessLocalFile,
} from './local-file-state';
import {
  buildDurablePauseState,
  parseAndroidResumeOffset,
  readPartialFileSize,
} from './pause-state';
import {
  getLocalRecord,
  listLocalRecords,
  removeLocalRecord,
  upsertLocalRecord,
} from './persistence';
import { toTransferSnapshot } from './progress';
import {
  decideRecoveryState,
  type RecoveryDecision,
} from './recovery-decision';
import { isPlaylistOrStreamUrl, isSafeHttpUrl, shouldUseHlsTransfer } from './resource-guard';
import {
  applyRetryJitter,
  computeRetryDelayMs,
  isAutoRetryableCode,
  isManualRetryAllowed,
  shouldScheduleAutoRetry,
} from './retry-policy';
import {
  getDownloadSettings,
  getEffectiveMaxConcurrentDownloads,
  isAutoResumeEnabled,
  normalizeMaxConcurrentDownloads,
  subscribeDownloadSettings,
} from '../settings';
import {
  getDownloadNetworkState,
  startDownloadNetworkMonitor,
  subscribeDownloadNetwork,
} from '../network';
import {
  AdmissionScheduler,
  admissionHandoff,
  admissionRequeue,
  admissionStarted,
  admissionTerminal,
  shouldHoldActiveTransfer,
  evaluateNetworkAdmission,
  type AdmissionResult,
  type JobStatusProbe,
  type QueueSnapshot,
  type SchedulerJobInput,
} from '../scheduler';
import { hardeningLog } from '../hardening-diagnostics';
import {
  logDownloadStateTransition,
  logNetworkPolicy,
  logWorkerLifecycle,
} from './audit-diagnostics.service';
import {
  getDownloadExecutionCoordinator,
  downloadAppLifecycle,
  createExecutionSnapshot,
  transitionDownloadExecutionState,
  markFirstValidByte,
  workerStateForExecutionState,
  executionStateFromWaitingReason,
  assertExecutionInvariant,
  type DownloadExecutionSnapshot,
  type DownloadExecutionState,
  type DownloadStateTransitionReason,
} from '../execution';
import { clearSyncState, syncStatusImmediate } from './synchronizer';
import type {
  EnqueueInput,
  EngineEvent,
  LocalDownloadRecord,
  LocalTransferState,
  TransferProgressSnapshot,
  DownloadPauseReason,
} from './types';
import { cleanupCancelledDownload, TransferWorker } from './worker';
import {
  buildSessionMetaFromContext,
  clearDownloadSessionMeta,
  fingerprintSessionMaterial,
  getDownloadSessionMeta,
  markDownloadRefreshAttempted,
  setDownloadSessionMeta,
} from './download-session-meta';
import { assertSessionBoundExecutionContext } from './ephemeral-target-headers';
import { logSessionDownload } from './session-download-diagnostics';
import { getSessionCookiesForUrl } from '@/media-detection/adapters/cookie-bridge.adapter';
import { stripRequestContextSecrets } from '@/media-detection/session-media/strip-secrets';
import { isLikelyExpiredMediaUrl } from '@/media-detection/services/expiring-url.service';
import { isSocialCdnUrl } from './source-capability';
import { decideResumeAction } from './resume-decision';
import {
  assessSourceFreshness,
  shouldRefreshSourceOnResume,
} from './source-freshness';
import { logPauseResume, logDownloadRuntimeTrace } from './audit-diagnostics.service';
import {
  decidePauseCommit,
  detectPauseSplitBrain,
  logDownloadRuntimeInvariantViolation,
  pauseFailureMessageForUi,
} from './pause-ack';
import {
  canonicalResumeOffset,
  classifyPartialPathClass,
  resolveResumeStrategyFromRecord,
  type ResumeStrategy,
} from './resume-strategy';
import {
  resolveFreshSocialSourceForDownload,
  type SocialSourceRefreshReason,
} from './social-source-refresh.provider';
import { ensurePhase1SocialSourceRefreshRegistered } from '@/media-detection/social-source/register-phase1-source-refresh';
import { File } from 'expo-file-system';

type Listener = (event: EngineEvent) => void;
type ProgressListener = (snapshot: TransferProgressSnapshot) => void;

/** Progressive or HLS — same cancel/pause/run surface for the manager. */
type AnyTransferWorker = TransferWorker | HlsTransferWorker;

const TERMINAL_LOCAL: ReadonlySet<LocalTransferState> = new Set([
  'complete',
  'deleted',
  'corrupt',
]);

function defaultRetryFields(
  existing?: LocalDownloadRecord | null,
): Pick<
  LocalDownloadRecord,
  | 'retryCount'
  | 'maxRetries'
  | 'retryEligible'
  | 'lastAttemptAt'
  | 'nextRetryAt'
> {
  return {
    retryCount: existing?.retryCount ?? 0,
    maxRetries: existing?.maxRetries ?? DOWNLOAD_ENGINE.maxAutoRetryAttempts,
    retryEligible: existing?.retryEligible ?? true,
    lastAttemptAt: existing?.lastAttemptAt ?? null,
    nextRetryAt: existing?.nextRetryAt ?? null,
  };
}
/**
 * Public facade for the VidoraX download transfer engine.
 * Owns queue scheduling + worker lifecycle. Does not own UI or Zustand.
 *
 * One authoritative AdmissionScheduler decides capacity / network / FIFO admission.
 * Progressive and HLS share the same concurrency budget.
 */
class DownloadEngine {
  private scheduler: AdmissionScheduler | null = null;
  private unsubNetwork: (() => void) | null = null;
  private unsubSettings: (() => void) | null = null;
  private readonly workers = new Map<string, AnyTransferWorker>();
  private readonly locks = new Set<string>();
  /**
   * IDs suppressed after cancel/remove so a worker promoted before cancel
   * cannot start (or complete) after the terminal transition.
   */
  private readonly suppressedIds = new Set<string>();
  private readonly listeners = new Set<Listener>();
  private readonly progressListeners = new Set<ProgressListener>();
  private readonly snapshots = new Map<string, TransferProgressSnapshot>();
  /** One auto-retry timer per download id — never occupies a worker slot. */
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Prevents duplicate schedule races before the timer is registered. */
  private readonly retryScheduling = new Set<string>();
  /** In-flight user pause/resume — join instead of silent lock no-op. */
  private readonly pauseOps = new Map<string, Promise<void>>();
  private readonly resumeOps = new Map<string, Promise<void>>();
  /** Soft-held by Wi-Fi Only / offline mid-transfer — eligible for auto-resume. */
  private readonly networkPolicyHeldIds = new Set<string>();
  private networkPolicyEnforcing = false;
  private recovering = false;
  /** Lifecycle recovery applied once per id this process (idempotent PATCH). */
  private readonly recoveredLifecycleIds = new Set<string>();
  private foregroundReconciling = false;
  /** Sync status hints for scheduler probe (avoid async I/O on drain). */
  private readonly statusHints = new Map<
    string,
    NonNullable<JobStatusProbe['status']>
  >();
  /** Phase 1C — canonical engine-owned execution snapshots (not persisted). */
  private readonly executionById = new Map<string, DownloadExecutionSnapshot>();
  private unsubQueue: (() => void) | null = null;

  private ensureScheduler(): AdmissionScheduler {
    if (this.scheduler) {
      return this.scheduler;
    }

    this.scheduler = new AdmissionScheduler({
      probeJob: (downloadId) => this.probeJob(downloadId),
      onAdmit: (job) => this.admitWorker(job),
    });

    const settings = getDownloadSettings();
    this.scheduler.setPolicy({
      maxConcurrentDownloads: getEffectiveMaxConcurrentDownloads(),
      wifiOnly: settings.wifiOnly,
    });
    this.scheduler.setNetwork(getDownloadNetworkState());

    this.unsubSettings = subscribeDownloadSettings((next) => {
      this.scheduler?.setPolicy({
        maxConcurrentDownloads: normalizeMaxConcurrentDownloads(
          next.maxConcurrentDownloads,
        ),
        wifiOnly: next.wifiOnly,
      });
      void this.enforceNetworkPolicyOnActiveTransfers();
    });

    this.unsubNetwork = subscribeDownloadNetwork((network) => {
      this.scheduler?.setNetwork(network);
      void this.enforceNetworkPolicyOnActiveTransfers();
    });

    void startDownloadNetworkMonitor();

    if (!this.unsubQueue) {
      this.unsubQueue = this.scheduler.subscribe((snapshot) => {
        this.syncPendingExecutionStates(snapshot);
      });
    }
    return this.scheduler;
  }

  /** Canonical execution snapshot for UI / store projection. */
  getExecutionSnapshot(downloadId: string): DownloadExecutionSnapshot | null {
    return this.executionById.get(downloadId) ?? null;
  }

  private ensureExecutionRecord(
    downloadId: string,
    generation: number,
    attemptStartBytes = 0,
  ): DownloadExecutionSnapshot {
    let record = this.executionById.get(downloadId);
    if (!record) {
      record = createExecutionSnapshot(downloadId, generation, attemptStartBytes);
      this.executionById.set(downloadId, record);
      return record;
    }
    record.generation = generation;
    record.attemptStartBytes = Math.max(
      record.attemptStartBytes,
      Math.trunc(attemptStartBytes),
    );
    return record;
  }

  private applyExecutionTransition(
    downloadId: string,
    to: DownloadExecutionState,
    reason: DownloadStateTransitionReason,
    extra?: {
      generation?: number;
      attemptStartBytes?: number;
      bytesWritten?: number;
      totalBytes?: number | null;
      progress?: number;
      waitingReason?: import('../scheduler/waiting-reason').QueueWaitingReason | null;
    },
  ): DownloadExecutionSnapshot | null {
    let snapshot = this.executionById.get(downloadId);
    if (!snapshot) {
      snapshot = createExecutionSnapshot(
        downloadId,
        extra?.generation ?? 0,
        extra?.attemptStartBytes ?? 0,
      );
      this.executionById.set(downloadId, snapshot);
    }
    const result = transitionDownloadExecutionState({
      snapshot,
      to,
      reason,
      ...extra,
    });
    if (!result.ok) {
      return snapshot;
    }
    return result.snapshot;
  }

  private syncPendingExecutionStates(snapshot: QueueSnapshot): void {
    const activeIds = new Set(snapshot.active.map((item) => item.downloadId));
    for (const pending of snapshot.pending) {
      if (activeIds.has(pending.downloadId)) {
        continue;
      }
      const existing = this.executionById.get(pending.downloadId);
      if (
        existing &&
        (existing.state === 'STARTING' ||
          existing.state === 'DOWNLOADING' ||
          existing.state === 'FINALIZING')
      ) {
        continue;
      }
      if (!existing) {
        this.ensureExecutionRecord(pending.downloadId, 0, 0);
      }
      const to = executionStateFromWaitingReason(pending.waitingReason);
      this.applyExecutionTransition(pending.downloadId, to, 'scheduler_pending', {
        waitingReason: pending.waitingReason,
      });
    }
  }

  private reconcileExecutionFromProgress(snapshot: TransferProgressSnapshot): void {
    const exec = this.executionById.get(snapshot.downloadId);
    if (!exec) {
      return;
    }
    if (
      snapshot.generation != null &&
      snapshot.generation !== exec.generation
    ) {
      return;
    }

    exec.bytesWritten = Math.max(exec.bytesWritten, snapshot.bytesWritten);
    if (snapshot.totalBytes != null) {
      exec.totalBytes = snapshot.totalBytes;
    }
    exec.progress = Math.max(0, Math.min(100, snapshot.progress));

    if (exec.state === 'STARTING' && snapshot.localState === 'transferring') {
      const result = markFirstValidByte({
        snapshot: exec,
        bytesWritten: snapshot.bytesWritten,
        generation: snapshot.generation ?? exec.generation,
      });
      if (result.ok && result.changed) {
        this.setStatusHint(snapshot.downloadId, 'DOWNLOADING', 'first_valid_byte');
        this.emit({
          type: 'status',
          downloadId: snapshot.downloadId,
          status: 'DOWNLOADING',
          workerState: 'TRANSFERRING',
          executionState: 'DOWNLOADING',
        });
      }
    }

    if (
      (exec.state === 'DOWNLOADING' ||
        exec.state === 'STARTING' ||
        exec.state === 'RETRYING') &&
      snapshot.localState === 'paused'
    ) {
      this.applyExecutionTransition(snapshot.downloadId, 'PAUSED', 'user_pause', {
        bytesWritten: snapshot.bytesWritten,
        totalBytes: snapshot.totalBytes,
        progress: snapshot.progress,
      });
    }

    if (
      (exec.state === 'DOWNLOADING' || exec.state === 'STARTING') &&
      snapshot.localState === 'finalizing'
    ) {
      this.applyExecutionTransition(snapshot.downloadId, 'FINALIZING', 'transfer_complete', {
        progress: 100,
        bytesWritten: snapshot.bytesWritten,
        totalBytes: snapshot.totalBytes,
      });
      this.emit({
        type: 'status',
        downloadId: snapshot.downloadId,
        status: 'DOWNLOADING',
        workerState: 'VERIFYING',
        executionState: 'FINALIZING',
      });
    }

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      const valid = assertExecutionInvariant({
        snapshot: exec,
        hasActiveWorker: this.workers.has(snapshot.downloadId),
        progress: snapshot.progress,
      });
      if (!valid) {
        hardeningLog('execution.invariant_violation', {
          downloadId: snapshot.downloadId,
          state: exec.state,
          bytesWritten: exec.bytesWritten,
          attemptStartBytes: exec.attemptStartBytes,
        });
      }
    }
  }

  private probeJob(downloadId: string): JobStatusProbe | null {
    if (this.suppressedIds.has(downloadId)) {
      return { status: 'CANCELLED' };
    }
    if (this.retryTimers.has(downloadId) || this.retryScheduling.has(downloadId)) {
      return { status: 'FAILED', retryDelay: true };
    }
    const hint = this.statusHints.get(downloadId);
    if (hint) {
      return { status: hint };
    }
    return { status: 'QUEUED' };
  }

  private setStatusHint(
    downloadId: string,
    status: NonNullable<JobStatusProbe['status']> | null,
    reason = 'engine_hint',
  ): void {
    const previous = this.statusHints.get(downloadId) ?? null;
    if (status == null) {
      this.statusHints.delete(downloadId);
      return;
    }
    this.statusHints.set(downloadId, status);
    if (previous !== status) {
      logDownloadStateTransition({
        downloadId,
        previousState: previous,
        nextState: status,
        reason,
      });
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  getSnapshot(downloadId: string): TransferProgressSnapshot | null {
    return this.snapshots.get(downloadId) ?? null;
  }

  getLocalUri(downloadId: string): string | null {
    return this.snapshots.get(downloadId)?.localUri ?? null;
  }

  /**
   * Re-probe a COMPLETED job's on-disk file and publish truthful local state.
   * Used by Details focus — does not block navigation or invent downloads.
   */
  async refreshCompletedLocalFile(downloadId: string): Promise<{
    usable: boolean;
    localUri: string | null;
  }> {
    const record = await getLocalRecord(downloadId);
    const snapshot = this.snapshots.get(downloadId);
    const status = record?.remoteStatus;
    if (status !== 'COMPLETED' && snapshot?.localState !== 'complete') {
      const uri = snapshot?.localUri ?? record?.localUri ?? null;
      return {
        usable: false,
        localUri: uri,
      };
    }

    const assessment = assessLocalFile({
      downloadId,
      localUri: snapshot?.localUri ?? record?.localUri ?? null,
      expectedBytes: record?.totalBytes ?? snapshot?.totalBytes ?? null,
    });

    if (assessment.presence === 'complete' && assessment.localUri) {
      if (record) {
        await upsertLocalRecord({
          ...record,
          localUri: assessment.localUri,
          localState: 'complete',
          bytesWritten: assessment.size,
          totalBytes: assessment.size,
          pauseState: null,
          errorCode: null,
          errorMessage: null,
        });
      }
      this.publishSnapshot(
        toTransferSnapshot(
          downloadId,
          {
            bytesWritten: assessment.size,
            totalBytes: assessment.size,
            progress: 100,
            bytesPerSecond: null,
            etaSeconds: 0,
          },
          assessment.localUri,
          'complete',
        ),
      );
      return { usable: true, localUri: assessment.localUri };
    }

    const localState =
      assessment.presence === 'missing' ? 'missing' : 'corrupt';
    if (record) {
      await upsertLocalRecord({
        ...record,
        localState,
        localUri: assessment.localUri,
        pauseState: null,
        errorCode:
          assessment.presence === 'missing'
            ? 'PARTIAL_FILE_MISSING'
            : 'FINAL_FILE_INVALID',
        errorMessage:
          assessment.presence === 'missing'
            ? 'Downloaded file is no longer available on this device.'
            : 'Downloaded file failed integrity checks.',
      });
    }
    this.publishSnapshot(
      toTransferSnapshot(
        downloadId,
        {
          bytesWritten: assessment.size,
          totalBytes: record?.totalBytes ?? null,
          progress: 100,
          bytesPerSecond: null,
          etaSeconds: null,
        },
        assessment.localUri,
        localState,
        assessment.presence === 'missing'
          ? 'PARTIAL_FILE_MISSING'
          : 'FINAL_FILE_INVALID',
        assessment.presence === 'missing'
          ? 'Downloaded file is no longer available on this device.'
          : 'Downloaded file failed integrity checks.',
      ),
    );
    return { usable: false, localUri: assessment.localUri };
  }

  /** Queue introspection for UI / diagnostics — immutable scheduler snapshot. */
  getQueueSnapshot(): QueueSnapshot {
    return this.ensureScheduler().getSnapshot();
  }

  subscribeQueue(listener: (snapshot: QueueSnapshot) => void): () => void {
    return this.ensureScheduler().subscribe(listener);
  }

  /** Request scheduler reevaluation (settings / network / capacity). */
  reevaluate(): void {
    this.ensureScheduler().requestDrain();
  }

  /**
   * Mid-transfer Wi-Fi Only / offline enforcement.
   * Progressive/multi-range → soft pause. HLS → soft hold (workspace kept).
   * Policy hold is not treated as network failure / retry storm.
   */
  private async enforceNetworkPolicyOnActiveTransfers(): Promise<void> {
    if (this.networkPolicyEnforcing) {
      return;
    }
    this.networkPolicyEnforcing = true;
    try {
      const settings = getDownloadSettings();
      const network = getDownloadNetworkState();
      const mustHold = shouldHoldActiveTransfer(settings.wifiOnly, network);
      const admission = evaluateNetworkAdmission(settings.wifiOnly, network);

      if (!mustHold) {
        await this.resumeNetworkPolicyHolds();
        return;
      }

      logNetworkPolicy({
        network: network.type,
        isConnected: network.connected,
        wifiOnly: settings.wifiOnly,
        decision: 'WAIT',
        reason: admission.allowed ? 'hold_active' : admission.reason,
      });

      const activeIds = [...this.workers.keys()];
      for (const downloadId of activeIds) {
        const worker = this.workers.get(downloadId);
        if (!worker?.isActive(downloadId)) {
          continue;
        }

        try {
          if (worker instanceof HlsTransferWorker) {
            const held = await worker.holdForNetworkPolicy(downloadId);
            if (held) {
              this.networkPolicyHeldIds.add(downloadId);
              this.setStatusHint(downloadId, 'PAUSED', 'wifi_policy_hold_hls');
              logNetworkPolicy({
                network: network.type,
                isConnected: network.connected,
                wifiOnly: settings.wifiOnly,
                downloadId,
                decision: 'WAIT',
                reason: 'active_transfer_held',
              });
              hardeningLog('recovery.reconciled', {
                downloadId,
                reason: 'wifi_policy_hold_hls',
              });
            }
            continue;
          }

          // Progressive / multi-range — durable pause with resumeData.
          await this.pause(downloadId, { reason: 'NETWORK_POLICY' });
          this.networkPolicyHeldIds.add(downloadId);
          logNetworkPolicy({
            network: network.type,
            isConnected: network.connected,
            wifiOnly: settings.wifiOnly,
            downloadId,
            decision: 'WAIT',
            reason: 'active_transfer_paused',
            invariantViolation: worker.isActive(downloadId),
          });
          hardeningLog('recovery.reconciled', {
            downloadId,
            reason: 'wifi_policy_hold_progressive',
          });
        } catch (error) {
          hardeningLog(
            'recovery.rejected_transition',
            {
              downloadId,
              reason: 'wifi_policy_hold_failed',
              error: error instanceof Error ? error.message : 'hold_failed',
            },
            'warn',
          );
        }
      }
    } finally {
      this.networkPolicyEnforcing = false;
    }
  }

  private async resumeNetworkPolicyHolds(): Promise<void> {
    if (this.networkPolicyHeldIds.size === 0) {
      return;
    }
    if (!isAutoResumeEnabled()) {
      return;
    }

    const settings = getDownloadSettings();
    const network = getDownloadNetworkState();
    if (shouldHoldActiveTransfer(settings.wifiOnly, network)) {
      return;
    }

    const ids = [...this.networkPolicyHeldIds];
    for (const downloadId of ids) {
      const record = await getLocalRecord(downloadId);
      if (record?.pauseReason === 'USER') {
        continue;
      }
      this.networkPolicyHeldIds.delete(downloadId);
      try {
        await this.resume(downloadId);
        hardeningLog('recovery.reconciled', {
          downloadId,
          reason: 'wifi_policy_resume',
        });
      } catch (error) {
        hardeningLog(
          'recovery.rejected_transition',
          {
            downloadId,
            reason: 'wifi_policy_resume_failed',
            error: error instanceof Error ? error.message : 'resume_failed',
          },
          'warn',
        );
      }
    }
  }

  getJobEvidence(downloadId: string): {
    hasActiveWorker: boolean;
    isQueued: boolean;
    isSuppressed: boolean;
    executionOwner: 'JS' | 'ANDROID_NATIVE' | 'NONE';
    isRetryScheduled: boolean;
  } {
    const scheduler = this.ensureScheduler();
    const worker = this.workers.get(downloadId);
    const coordinator = getDownloadExecutionCoordinator();
    return {
      hasActiveWorker: Boolean(
        worker && (worker.isActive(downloadId) || this.workers.has(downloadId)),
      ),
      isQueued: scheduler.isPending(downloadId),
      isSuppressed: this.suppressedIds.has(downloadId),
      executionOwner: coordinator.getOwner(downloadId),
      isRetryScheduled:
        this.retryTimers.has(downloadId) || this.retryScheduling.has(downloadId),
    };
  }

  /** Platform FGS / ledger snapshot for UI + diagnostics. */
  getBackgroundExecutionLedger() {
    return getDownloadExecutionCoordinator().getLedgerSnapshot();
  }

  /**
   * True when Android FGS is actually protecting work (not iOS/noop/ledger-only).
   * Cached from last native flush; never claims background on UNAVAILABLE platforms.
   */
  isForegroundServiceActive(): boolean {
    const coordinator = getDownloadExecutionCoordinator();
    if (coordinator.getLastServiceError()) {
      return false;
    }
    return coordinator.isNativeForegroundServiceRunning();
  }

  async getNativeExecutionSnapshot() {
    return getDownloadExecutionCoordinator().getNativeSnapshot();
  }

  async enqueue(input: EnqueueInput): Promise<void> {
    if (!isSafeHttpUrl(input.sourceUrl)) {
      throw new DownloadEngineError('INVALID_RESOURCE', 'Invalid download URL.');
    }

    // HLS playlists are a first-class strategy — do not reject here.
    // Encrypted/live/malformed playlists fail inside HlsTransferWorker.

    const scheduler = this.ensureScheduler();

    if (this.locks.has(input.id) || scheduler.has(input.id)) {
      return;
    }

    if (this.workers.has(input.id)) {
      // One download id → at most one active worker.
      return;
    }

    const existing = await getLocalRecord(input.id);
    if (existing?.localState === 'complete' && existing.localUri) {
      const file = new File(existing.localUri);
      const verified = verifyCompletedFile(file, existing.totalBytes, {
        downloadId: input.id,
      });
      if (verified.ok) {
        this.setStatusHint(input.id, 'COMPLETED');
        return;
      }
    }

    if (
      existing?.remoteStatus === 'COMPLETED' ||
      existing?.remoteStatus === 'CANCELLED'
    ) {
      this.setStatusHint(input.id, existing.remoteStatus);
      return;
    }

    if (existing?.remoteStatus === 'FAILED') {
      // FAILED must enter only via retry()/scheduled retry (status already QUEUED).
      this.setStatusHint(input.id, 'FAILED');
      return;
    }

    // A prior cancel/remove suppresses late startWorker; a deliberate enqueue
    // of the same id (e.g. recovery resume) clears that suppression.
    this.suppressedIds.delete(input.id);

    if (input.preferPaused) {
      await upsertLocalRecord({
        downloadId: input.id,
        sourceUrl: input.sourceUrl,
        fileName: input.fileName,
        expectedFileSize: input.fileSize,
        localUri: existing?.localUri ?? null,
        localState: 'paused',
        bytesWritten: existing?.bytesWritten ?? 0,
        totalBytes: existing?.totalBytes ?? null,
        pauseState: existing?.pauseState ?? null,
        rangeValidators: existing?.rangeValidators ?? null,
        generation: existing?.generation ?? 0,
        errorCode: null,
        errorMessage: null,
        remoteStatus: 'PAUSED',
        ...defaultRetryFields(existing),
        updatedAt: new Date().toISOString(),
      });
      this.setStatusHint(input.id, 'PAUSED');
      return;
    }

    await upsertLocalRecord({
      downloadId: input.id,
      sourceUrl: input.sourceUrl,
      fileName: input.fileName,
      expectedFileSize: input.fileSize,
      localUri: existing?.localUri ?? null,
      localState: 'not_started',
      bytesWritten: existing?.bytesWritten ?? 0,
      totalBytes: existing?.totalBytes ?? null,
      pauseState: null,
      rangeValidators: existing?.rangeValidators ?? null,
      generation: existing?.generation ?? 0,
      errorCode: null,
      errorMessage: null,
      remoteStatus: 'QUEUED',
      ...defaultRetryFields(existing),
      nextRetryAt: null,
      updatedAt: new Date().toISOString(),
      requiresEphemeralSession: Boolean(
        input.requestContext?.cookiesRequired ||
          input.requestContext?.hasCookies ||
          input.requestContext?.authMode === 'SESSION_COOKIE' ||
          input.requestContext?.authMode === 'SESSION_PLUS_REFERER' ||
          input.requestContext?.headers?.Cookie,
      ),
    });

    this.setStatusHint(input.id, 'QUEUED');
    this.ensureExecutionRecord(input.id, existing?.generation ?? 0, existing?.bytesWritten ?? 0);
    this.applyExecutionTransition(input.id, 'QUEUED', 'enqueued', {
      bytesWritten: existing?.bytesWritten ?? 0,
    });

    const pageUrl = input.requestContext?.pageUrl ?? null;
    let coherenceFingerprint: string | null = null;
    if (pageUrl) {
      try {
        const pageCookies = await getSessionCookiesForUrl(pageUrl);
        coherenceFingerprint = fingerprintSessionMaterial(pageCookies);
      } catch {
        coherenceFingerprint = fingerprintSessionMaterial(
          input.requestContext?.headers?.Cookie ?? null,
        );
      }
    } else {
      coherenceFingerprint = fingerprintSessionMaterial(
        input.requestContext?.headers?.Cookie ?? null,
      );
    }

    const sessionMeta = buildSessionMetaFromContext(
      input.requestContext,
      input.socialSourceIdentity ?? null,
      input.streamType ?? null,
      {
        coherenceCookieUrl: pageUrl ?? input.sourceUrl,
        sessionCoherenceFingerprint: coherenceFingerprint,
      },
    );
    setDownloadSessionMeta(input.id, sessionMeta);
    logSessionDownload('execution_context_created', {
      downloadId: input.id,
      accessMode: sessionMeta.accessMode,
      cookiePresent: Boolean(input.requestContext?.headers?.Cookie),
    });

    const safeRequestContext = stripRequestContextSecrets(input.requestContext);
    scheduler.enqueue({
      id: input.id,
      sourceUrl: input.sourceUrl,
      fileName: input.fileName,
      fileSize: input.fileSize,
      title: input.title,
      streamType: input.streamType ?? null,
      requestContext: safeRequestContext,
    });
  }

  private async waitForLifecycleLock(downloadId: string, maxMs = 8000): Promise<void> {
    const start = Date.now();
    while (this.locks.has(downloadId) && Date.now() - start < maxMs) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  /**
   * Pause must not hang the UI mutating flag waiting for a stuck native
   * downloadAsync(). After timeout, detach this worker so Resume can claim.
   */
  private async awaitPauseSettle(
    downloadId: string,
    worker: AnyTransferWorker,
    pauseSignalled: boolean,
  ): Promise<boolean> {
    const settled = await worker.waitUntilSettledBounded(
      worker.getPauseSettleGeneration() ?? undefined,
    );
    if (settled) {
      return false;
    }
    logDownloadRuntimeTrace({
      downloadId,
      event: 'PAUSE_SETTLE_TIMEOUT',
      executionState: this.executionById.get(downloadId)?.state ?? null,
      operation: pauseSignalled ? 'pause_signalled' : 'pause_false',
    });
    await this.releasePausedWorkerOwnership(downloadId, worker);
    return true;
  }

  private async releasePausedWorkerOwnership(
    downloadId: string,
    worker: AnyTransferWorker,
  ): Promise<void> {
    if (this.workers.get(downloadId) === worker) {
      this.workers.delete(downloadId);
    }
    this.ensureScheduler().release(downloadId);
    logDownloadRuntimeTrace({
      downloadId,
      event: 'WORKER_RELEASED',
      operation: 'pause_settle',
    });
    try {
      await getDownloadExecutionCoordinator().endExecution(downloadId);
    } catch {
      // never block pause commit
    }
  }

  /**
   * After transport has stopped for USER_PAUSE: reconstruct checkpoint, commit
   * PAUSED, emit to the store. Does not treat a redundant native pause() false
   * as failure when the writer is already down.
   */
  private async commitPauseAfterTransportStop(
    downloadId: string,
    pauseReason: DownloadPauseReason,
    options: {
      worker: AnyTransferWorker | null;
      pauseSignalled: boolean;
      nativePauseReturnedFalse?: boolean;
      settleTimedOut?: boolean;
    },
  ): Promise<void> {
    const settled = await getLocalRecord(downloadId);
    if (
      settled &&
      (settled.remoteStatus === 'COMPLETED' ||
        settled.remoteStatus === 'CANCELLED' ||
        settled.localState === 'complete')
    ) {
      throw new DownloadEngineError(
        'PAUSE_FAILED',
        pauseFailureMessageForUi(),
      );
    }
    const workerStill =
      options.settleTimedOut && options.pauseSignalled
        ? false
        : Boolean(options.worker?.isActive(downloadId));
    const transferFile = settled
      ? resolveTransferTargets(downloadId, settled.fileName, {
          sourceUrl: settled.sourceUrl,
        }).partial
      : null;
    const reconstructed =
      settled && transferFile
        ? buildDurablePauseState(
            settled.sourceUrl,
            transferFile,
            settled.pauseState,
            settled.bytesWritten,
          )
        : null;
    const diskBytes = transferFile ? readPartialFileSize(transferFile) : 0;
    const execState = this.executionById.get(downloadId)?.state ?? null;

    if (
      detectPauseSplitBrain({
        executionState: execState,
        hasActiveTransport: workerStill,
        pauseRequestedOrSettled: options.pauseSignalled,
      })
    ) {
      logDownloadRuntimeInvariantViolation({
        downloadId,
        executionState: execState,
        hasActiveTransport: workerStill,
        pauseRequestedOrSettled: true,
      });
    }

    const decision = decidePauseCommit({
      executionState: execState,
      workerStillTransferring: workerStill,
      pauseRequested: options.pauseSignalled,
      localState: settled?.localState ?? null,
      hasResumeData: Boolean(
        reconstructed?.resumeData ?? settled?.pauseState?.resumeData,
      ),
      hasHlsCheckpoint: Boolean(settled?.hlsTransfer),
      hasMultiRangeCheckpoint: hasResumableMultiRange(settled?.multiRange),
      partialBytes: Math.max(diskBytes, settled?.bytesWritten ?? 0),
      nativePauseReturnedFalse: options.nativePauseReturnedFalse,
    });

    if (decision.fail) {
      throw new DownloadEngineError(
        'PAUSE_FAILED',
        pauseFailureMessageForUi(),
      );
    }

    if (settled) {
      const durablePause = reconstructed ?? settled.pauseState;
      await upsertLocalRecord({
        ...settled,
        rangeValidators: settled.rangeValidators ?? null,
        pauseReason,
        remoteStatus: 'PAUSED',
        localState: 'paused',
        pauseState: durablePause,
        bytesWritten: Math.max(settled.bytesWritten, diskBytes),
        localUri: transferFile?.uri ?? settled.localUri,
        nextRetryAt: null,
        errorCode: null,
        errorMessage: null,
      });
      logDownloadRuntimeTrace({
        downloadId,
        event: 'PAUSE_DURABILITY',
        strategy: decision.reason,
        logicalBytes: settled.bytesWritten,
        filesystemBytes: diskBytes,
        hasResumeData: Boolean(durablePause?.resumeData),
        partialPathClass: classifyPartialPathClass(transferFile?.uri),
        transferKind: settled.hlsTransfer
          ? 'hls'
          : hasResumableMultiRange(settled.multiRange)
            ? 'multi_range'
            : 'progressive',
      });
      logDownloadRuntimeTrace({
        downloadId,
        event: 'PARTIAL_PRESERVED',
        filesystemBytes: diskBytes,
        hasResumeData: Boolean(durablePause?.resumeData),
        partialPathClass: classifyPartialPathClass(transferFile?.uri),
      });
    }

    const latest = (await getLocalRecord(downloadId)) ?? settled;
    this.applyExecutionTransition(downloadId, 'PAUSED', 'user_pause', {
      bytesWritten: latest?.bytesWritten,
      totalBytes: latest?.totalBytes ?? null,
      progress:
        latest && latest.totalBytes != null && latest.totalBytes > 0
          ? Math.min(
              100,
              Math.floor((latest.bytesWritten / latest.totalBytes) * 100),
            )
          : undefined,
    });
    this.setStatusHint(downloadId, 'PAUSED', 'user_pause');
    this.emit({
      type: 'status',
      downloadId,
      status: 'PAUSED',
      workerState: 'PAUSED',
      executionState: 'PAUSED',
    });
    logDownloadRuntimeTrace({
      downloadId,
      event: 'PAUSE_ACKNOWLEDGED',
      canonicalStatus: 'PAUSED',
      executionState: 'PAUSED',
    });
    logDownloadRuntimeTrace({
      downloadId,
      event: 'PAUSE_SETTLED',
      canonicalStatus: 'PAUSED',
      executionState: 'PAUSED',
    });
    logDownloadRuntimeTrace({
      downloadId,
      event: 'PAUSE_COMMITTED',
      canonicalStatus: 'PAUSED',
      executionState: 'PAUSED',
    });
    logPauseResume({
      downloadId,
      action: 'pause',
      outcome: 'ok',
      reason: pauseReason,
      bytesWritten: latest?.bytesWritten,
      generation: latest?.generation,
    });
  }

  async pause(
    downloadId: string,
    options?: { reason?: DownloadPauseReason },
  ): Promise<void> {
    const existingPause = this.pauseOps.get(downloadId);
    if (existingPause) {
      logDownloadRuntimeTrace({
        downloadId,
        event: 'PAUSE_REQUESTED',
        operation: 'join',
      });
      await existingPause;
      return;
    }
    const existingResume = this.resumeOps.get(downloadId);
    if (existingResume) {
      await existingResume;
    }
    const op = this.runPause(downloadId, options);
    this.pauseOps.set(downloadId, op);
    try {
      await op;
    } finally {
      this.pauseOps.delete(downloadId);
    }
  }

  private async runPause(
    downloadId: string,
    options?: { reason?: DownloadPauseReason },
  ): Promise<void> {
    const pauseReason = options?.reason ?? 'USER';
    logDownloadRuntimeTrace({
      downloadId,
      event: 'PAUSE_REQUESTED',
      executionState: this.executionById.get(downloadId)?.state ?? null,
      operation: pauseReason,
    });
    if (this.locks.has(downloadId)) {
      const busyWorker = this.workers.get(downloadId);
      if (busyWorker) {
        logDownloadRuntimeTrace({
          downloadId,
          event: 'PAUSE_SIGNAL_SENT',
          operation: 'lock_held_signal',
        });
        const ok = await busyWorker.pause(downloadId);
        const settleTimedOut = await this.awaitPauseSettle(
          downloadId,
          busyWorker,
          ok,
        );
        await this.commitPauseAfterTransportStop(downloadId, pauseReason, {
          worker: busyWorker,
          pauseSignalled: ok,
          settleTimedOut,
        });
        return;
      }
      await this.commitPauseAfterTransportStop(downloadId, pauseReason, {
        worker: null,
        pauseSignalled: true,
      });
      return;
    }
    this.locks.add(downloadId);
    try {
      // Pause defeats a scheduled auto-retry — do not let RETRYING restart transfer.
      this.clearRetryTimer(downloadId);
      // Canonical USER_PAUSE commit lives in commitPauseAfterTransportStop:
      // applyExecutionTransition(downloadId, 'PAUSED')
      // emit { status: 'PAUSED', workerState: 'PAUSED', executionState: 'PAUSED' }

      const execNow = this.executionById.get(downloadId)?.state ?? null;
      if (
        execNow === 'FINALIZING' ||
        execNow === 'COMPLETED' ||
        execNow === 'CANCELLED'
      ) {
        logPauseResume({
          downloadId,
          action: 'pause',
          outcome: 'blocked',
          reason: execNow,
        });
        throw new DownloadEngineError(
          'PAUSE_FAILED',
          pauseFailureMessageForUi(),
        );
      }

      const worker = this.workers.get(downloadId);
      if (worker && (worker.isActive(downloadId) || this.workers.has(downloadId))) {
        logDownloadRuntimeTrace({
          downloadId,
          event: 'PAUSE_SIGNAL_SENT',
          transferKind: 'worker',
        });
        const ok = await worker.pause(downloadId);
        logDownloadRuntimeTrace({
          downloadId,
          event: 'TRANSPORT_ABORTED_FOR_PAUSE',
          operation: ok ? 'aborted_or_native_paused' : 'pause_false',
        });
        const settleTimedOut = await this.awaitPauseSettle(
          downloadId,
          worker,
          ok,
        );
        await this.commitPauseAfterTransportStop(downloadId, pauseReason, {
          worker,
          pauseSignalled: ok,
          settleTimedOut,
        });
        return;
      }

      const existing = await getLocalRecord(downloadId);

      if (
        existing?.remoteStatus === 'COMPLETED' ||
        existing?.remoteStatus === 'CANCELLED' ||
        existing?.localState === 'complete'
      ) {
        throw new DownloadEngineError(
          'PAUSE_FAILED',
          pauseFailureMessageForUi(),
        );
      }

      // No live worker: transport is not running. Commit PAUSED from disk /
      // USER_PAUSE rather than throwing WORKER_NOT_FOUND (split-brain recovery).
      this.ensureScheduler().cancelPending(downloadId);
      if (existing) {
        await upsertLocalRecord({
          ...existing,
          rangeValidators: existing.rangeValidators ?? null,
          localState: 'paused',
          pauseReason,
          remoteStatus:
            existing.remoteStatus === 'DOWNLOADING' ||
            existing.remoteStatus === 'PAUSED' ||
            existing.remoteStatus === 'FAILED' ||
            existing.remoteStatus === 'QUEUED'
              ? 'PAUSED'
              : existing.remoteStatus,
          pauseState: existing.pauseState,
          nextRetryAt: null,
        });
      }
      if (existing?.remoteStatus === 'DOWNLOADING') {
        await syncStatusImmediate(downloadId, 'PAUSED');
      }
      await this.commitPauseAfterTransportStop(downloadId, pauseReason, {
        worker: null,
        pauseSignalled: true,
      });
      this.pump();
    } catch (error) {
      logPauseResume({
        downloadId,
        action: 'pause',
        outcome: 'failed',
        reason: error instanceof Error ? error.message : 'pause_failed',
      });
      throw error;
    } finally {
      this.locks.delete(downloadId);
    }
  }

  async resume(downloadId: string): Promise<void> {
    const existingResume = this.resumeOps.get(downloadId);
    if (existingResume) {
      logDownloadRuntimeTrace({
        downloadId,
        event: 'RESUME_REQUESTED',
        operation: 'join',
      });
      await existingResume;
      return;
    }
    const existingPause = this.pauseOps.get(downloadId);
    if (existingPause) {
      await existingPause;
    }
    const op = this.runResume(downloadId);
    this.resumeOps.set(downloadId, op);
    try {
      await op;
    } finally {
      this.resumeOps.delete(downloadId);
    }
  }

  private async runResume(downloadId: string): Promise<void> {
    if (this.locks.has(downloadId)) {
      hardeningLog('download.resume_failed', {
        downloadId,
        errorCode: 'RESUME_STATE_CONFLICT',
        workerState: 'lock_held',
      }, 'warn');
      return;
    }
    this.locks.add(downloadId);
    let enqueueInput: SchedulerJobInput | null = null;
    let resumeOffset: number | null = null;
    try {
      hardeningLog('download.resume_requested', {
        downloadId,
        status: this.statusHints.get(downloadId) ?? null,
      });

      // Wait for worker settle barrier before re-enqueueing.
      const settlingWorker = this.workers.get(downloadId);
      if (settlingWorker) {
        logDownloadRuntimeTrace({
          downloadId,
          event: 'RESUME_CLAIMED',
          operation: 'wait_prior_worker',
        });
        await settlingWorker.waitUntilSettledBounded();
        if (
          this.workers.get(downloadId) === settlingWorker &&
          !settlingWorker.isActive(downloadId)
        ) {
          this.workers.delete(downloadId);
          this.ensureScheduler().release(downloadId);
        }
      }

      // Clear ghost pending/active ownership from a prior failed resume before
      // validating — release() frees capacity that cancelPending alone cannot.
      if (this.ensureScheduler().has(downloadId)) {
        this.ensureScheduler().cancelPending(downloadId);
        this.ensureScheduler().release(downloadId);
      }

      let existing = await getLocalRecord(downloadId);
      if (!existing) {
        hardeningLog('download.resume_failed', {
          downloadId,
          errorCode: 'RESUME_STATE_MISSING',
        }, 'warn');
        logDownloadRuntimeTrace({
          downloadId,
          event: 'RESUME_FAILED',
          strategy: 'NOT_RESUMABLE',
          operation: 'no_local_record',
        });
        throw new DownloadEngineError(
          'RESUME_STATE_MISSING',
          'Unable to resume this download.',
        );
      }

      if (existing.localState === 'complete') {
        return;
      }

      if (
        existing.remoteStatus === 'CANCELLED' ||
        existing.remoteStatus === 'COMPLETED'
      ) {
        throw new DownloadEngineError(
          'RESUME_UNSUPPORTED',
          'This download can no longer be resumed.',
        );
      }

      if (!isSafeHttpUrl(existing.sourceUrl)) {
        throw new DownloadEngineError(
          'INVALID_RESOURCE',
          'Invalid download URL.',
        );
      }

      logDownloadRuntimeTrace({
        downloadId,
        event: 'RESUME_REQUESTED',
        canonicalStatus: existing.remoteStatus,
        executionState: this.executionById.get(downloadId)?.state ?? null,
        workerGeneration: existing.generation,
      });

      hardeningLog('download.resume_validating', {
        downloadId,
        status: existing.remoteStatus,
        offset: existing.bytesWritten,
        expectedSize: existing.totalBytes ?? existing.expectedFileSize,
      });

      const { partial: transferFile } = resolveTransferTargets(
        existing.downloadId,
        existing.fileName,
        { sourceUrl: existing.sourceUrl },
      );
      // Always read the canonical progressive .part — never invent size.
      const actualPartialSize = isPlaylistOrStreamUrl(existing.sourceUrl)
        ? Math.max(0, existing.hlsTransfer?.downloadedBytes ?? 0)
        : hasResumableMultiRange(existing.multiRange)
          ? sumMultiRangeDownloaded(existing.multiRange!)
          : readPartialFileSize(transferFile);

      // Reconstruct durable pause from on-disk partial when checkpoint was lost
      // but bytes remain (authoritative file size → Range offset).
      if (
        !isPlaylistOrStreamUrl(existing.sourceUrl) &&
        !existing.pauseState?.resumeData &&
        !hasResumableMultiRange(existing.multiRange) &&
        actualPartialSize > 0
      ) {
        const reconstructed = buildDurablePauseState(
          existing.sourceUrl,
          transferFile,
          existing.pauseState,
          actualPartialSize,
        );
        if (reconstructed?.resumeData) {
          existing = {
            ...existing,
            pauseState: reconstructed,
            bytesWritten: Math.max(existing.bytesWritten, actualPartialSize),
            localUri: transferFile.uri,
          };
          await upsertLocalRecord(existing);
        }
      }

      logDownloadRuntimeTrace({
        downloadId,
        event: 'RESUME_STATE_READ',
        actualPartialSize,
        hasResumeData: Boolean(existing.pauseState?.resumeData),
        partialPathClass: classifyPartialPathClass(transferFile.uri),
        logicalBytes: existing.bytesWritten,
        filesystemBytes: actualPartialSize,
        transferKind: isPlaylistOrStreamUrl(existing.sourceUrl)
          ? 'hls'
          : hasResumableMultiRange(existing.multiRange)
            ? 'multi_range'
            : 'progressive',
        workerGeneration: existing.generation,
      });
      hardeningLog('download.resume_partial_state', {
        downloadId,
        offset: existing.bytesWritten,
        actualPartialSize,
        expectedSize: existing.totalBytes,
      });

      const sessionMeta = getDownloadSessionMeta(downloadId);
      const sessionContextMissing = Boolean(
        existing.requiresEphemeralSession && !sessionMeta,
      );
      const freshness = assessSourceFreshness(existing);
      const strategyResult = resolveResumeStrategyFromRecord({
        record: existing,
        partialSize: actualPartialSize,
        sourceUrlSafe: isSafeHttpUrl(existing.sourceUrl),
        sessionContextMissing,
        sourceRefreshRequired: shouldRefreshSourceOnResume(existing),
      });
      let selectedStrategy: ResumeStrategy = strategyResult.strategy;

      logDownloadRuntimeTrace({
        downloadId,
        event: 'RESUME_STRATEGY_SELECTED',
        strategy: selectedStrategy,
        actualPartialSize,
        hasResumeData: Boolean(existing.pauseState?.resumeData),
        transferKind: isPlaylistOrStreamUrl(existing.sourceUrl)
          ? 'hls'
          : 'progressive',
        sourceRefreshRequired: strategyResult.sourceRefreshRequired,
        operation: strategyResult.reason,
      });

      if (selectedStrategy === 'SESSION_CONTEXT_REQUIRED') {
        logDownloadRuntimeTrace({
          downloadId,
          event: 'RESUME_FAILED',
          strategy: 'SESSION_CONTEXT_REQUIRED',
        });
        throw new DownloadEngineError(
          'SESSION_CONTEXT_LOST',
          'This authenticated download needs the active website session. Open the website and retry.',
        );
      }

      if (selectedStrategy === 'NOT_RESUMABLE') {
        logDownloadRuntimeTrace({
          downloadId,
          event: 'RESUME_FAILED',
          strategy: 'NOT_RESUMABLE',
          operation: strategyResult.reason,
        });
        throw new DownloadEngineError(
          'RESUME_UNSUPPORTED',
          'This download can no longer be resumed.',
        );
      }

      if (selectedStrategy === 'HLS_CHECKPOINT_RESUME') {
        if (!existing.hlsTransfer) {
          throw new DownloadEngineError(
            'RESUME_UNSUPPORTED',
            'Unable to resume this download.',
          );
        }
        resumeOffset = null;
      } else if (selectedStrategy === 'MULTI_RANGE_RESUME') {
        resumeOffset = sumMultiRangeDownloaded(existing.multiRange!);
      } else if (selectedStrategy === 'RANGE_RESUME') {
        const safeOffset = canonicalResumeOffset({
          partialSize: actualPartialSize,
          pauseResumeData: existing.pauseState?.resumeData,
          bytesWrittenHint: existing.bytesWritten,
        });
        if (safeOffset <= 0) {
          selectedStrategy = 'RESTART_FROM_ZERO';
          resumeOffset = null;
        } else {
          resumeOffset = safeOffset;
          logDownloadRuntimeTrace({
            downloadId,
            event: 'RANGE_RESUME_SELECTED',
            strategy: 'RANGE_RESUME',
            actualPartialSize: resumeOffset,
            hasResumeData: Boolean(existing.pauseState?.resumeData),
          });
          // Worker Range path requires pauseState.resumeData — without it the
          // fresh-transfer branch deletes the canonical .part.
          existing = {
            ...existing,
            pauseState: {
              url: existing.sourceUrl,
              fileUri: transferFile.uri,
              isDirectory: false,
              headers: existing.pauseState?.headers,
              resumeData: String(resumeOffset),
            },
            bytesWritten: resumeOffset,
            localUri: transferFile.uri,
          };
        }
      } else if (selectedStrategy === 'NATIVE_CHECKPOINT_RESUME') {
        resumeOffset =
          actualPartialSize > 0 ? actualPartialSize : existing.bytesWritten || null;
      }

      if (selectedStrategy === 'RESTART_FROM_ZERO') {
        logDownloadRuntimeTrace({
          downloadId,
          event: 'RESTART_FROM_ZERO_SELECTED',
          strategy: 'RESTART_FROM_ZERO',
          actualPartialSize,
          hasResumeData: Boolean(existing.pauseState?.resumeData),
          operation: strategyResult.reason,
          transferKind: isPlaylistOrStreamUrl(existing.sourceUrl)
            ? 'hls'
            : 'progressive',
        });
        // Honest restart — clear stale checkpoint metadata and reset progress.
        try {
          deletePartialTransferQuiet(transferFile);
        } catch {
          // ignore
        }
        existing = {
          ...existing,
          pauseState: null,
          multiRange: null,
          rangeValidators: null,
          hlsTransfer: isPlaylistOrStreamUrl(existing.sourceUrl)
            ? null
            : existing.hlsTransfer,
          bytesWritten: 0,
          localUri: transferFile.uri,
        };
        resumeOffset = null;
        this.publishSnapshot(
          toTransferSnapshot(
            downloadId,
            {
              bytesWritten: 0,
              totalBytes: existing.totalBytes,
              progress: 0,
              bytesPerSecond: null,
              etaSeconds: null,
            },
            transferFile.uri,
            'paused',
          ),
        );
      }

      // Manual Resume must succeed regardless of Auto Resume preference.
      this.networkPolicyHeldIds.delete(downloadId);
      this.suppressedIds.delete(downloadId);

      // Persist QUEUED BEFORE enqueue/drain. enqueue() triggers requestDrain()
      // immediately; admitWorker rejects locks.has and remoteStatus===PAUSED
      // and does not requeue — so enqueue-under-lock permanently orphans resume.
      this.applyExecutionTransition(downloadId, 'QUEUED', 'resume', {
        bytesWritten: existing.bytesWritten,
        totalBytes: existing.totalBytes,
        progress:
          selectedStrategy === 'RESTART_FROM_ZERO' || existing.bytesWritten <= 0
            ? 0
            : existing.totalBytes != null && existing.totalBytes > 0
              ? Math.min(
                  100,
                  Math.floor((existing.bytesWritten / existing.totalBytes) * 100),
                )
              : undefined,
        attemptStartBytes:
          selectedStrategy === 'RESTART_FROM_ZERO' ? 0 : existing.bytesWritten,
      });
      this.setStatusHint(downloadId, 'QUEUED');
      logDownloadRuntimeTrace({
        downloadId,
        event: 'RESUME_QUEUED',
        canonicalStatus: 'QUEUED',
        executionState: 'QUEUED',
        workerGeneration: existing.generation,
        strategy: selectedStrategy,
        actualPartialSize,
      });
      await upsertLocalRecord({
        ...existing,
        rangeValidators: existing.rangeValidators ?? null,
        localState: 'not_started',
        remoteStatus: 'QUEUED',
        errorCode: null,
        errorMessage: null,
        pauseReason: null,
        pauseState: existing.pauseState,
        multiRange: existing.multiRange,
        bytesWritten: existing.bytesWritten,
      });
      this.emit({
        type: 'status',
        downloadId,
        status: 'QUEUED',
        workerState: 'WAITING',
        executionState: 'QUEUED',
      });

      const refreshIfStale =
        strategyResult.sourceRefreshRequired ||
        shouldRefreshSourceOnResume(existing);
      if (refreshIfStale) {
        logDownloadRuntimeTrace({
          downloadId,
          event: 'SESSION_REFRESH_SELECTED',
          strategy: selectedStrategy,
          sourceRefreshRequired: true,
        });
      }

      enqueueInput = {
        ...(await this.resolveRetryEnqueueInput(existing, {
          refreshIfStale,
          forceRefresh:
            selectedStrategy === 'RESTART_FROM_ZERO' && freshness.likelyStale,
        })),
      };

      logDownloadRuntimeTrace({
        downloadId,
        event: 'RESUME_STARTED',
        strategy: selectedStrategy,
        actualPartialSize,
        hasResumeData: Boolean(existing.pauseState?.resumeData),
      });

      logPauseResume({
        downloadId,
        action: 'resume',
        outcome: 'ok',
        resumeOffset,
        generation: existing.generation,
        resumeDecision: decideResumeAction({
          record: existing,
          partialBytes: resumeOffset ?? existing.bytesWritten,
          sourceLikelyStale: freshness.likelyStale,
        }),
        sourceFreshness: freshness.reason,
        bytesWritten: existing.bytesWritten,
      });
    } finally {
      // CRITICAL: release the resume lock BEFORE enqueue/pump.
      // enqueue → drain → admitWorker bails on locks.has and drops the job.
      this.locks.delete(downloadId);
    }

    if (!enqueueInput) {
      return;
    }

    // Re-assert QUEUED immediately before enqueue so a late afterWorkerSettled
    // from the prior pause cannot leave probe status as PAUSED.
    this.setStatusHint(downloadId, 'QUEUED');

    const enqueued = this.ensureScheduler().enqueue(enqueueInput);
    hardeningLog('download.resume_admission', {
      downloadId,
      status: this.statusHints.get(downloadId) ?? null,
      offset: resumeOffset,
      workerState: enqueued ? 'enqueued' : 'rejected',
      errorCode: enqueued ? null : 'QUEUE_ADMISSION_FAILED',
    }, enqueued ? 'info' : 'warn');
    if (!enqueued) {
      throw new DownloadEngineError(
        'QUEUE_ADMISSION_FAILED',
        'Unable to resume this download.',
      );
    }

    this.pump();

    hardeningLog('download.resume_worker_started', {
      downloadId,
      offset: resumeOffset,
      status: this.statusHints.get(downloadId) ?? null,
    });

    // Only surface QUEUED when the job is genuinely waiting for a concurrency slot.
    // Free-slot resumes start immediately and the worker emits DOWNLOADING.
    const snapshot = this.getQueueSnapshot();
    if (snapshot.pending.some((item) => item.downloadId === downloadId)) {
      this.emit({ type: 'status', downloadId, status: 'QUEUED' });
    }
  }

  async cancel(downloadId: string): Promise<void> {
    this.networkPolicyHeldIds.delete(downloadId);
    await this.waitForLifecycleLock(downloadId);
    if (this.locks.has(downloadId)) {
      logPauseResume({
        downloadId,
        action: 'cancel',
        outcome: 'blocked',
        reason: 'lock_held',
      });
      return;
    }
    this.locks.add(downloadId);
    // Suppress BEFORE removing from queue so an in-flight admitWorker bails.
    this.suppressedIds.add(downloadId);
    this.clearRetryTimer(downloadId);
    try {
      const worker = this.workers.get(downloadId);
      this.ensureScheduler().cancelPending(downloadId);

      // Abort first so late completion callbacks cannot mark COMPLETED.
      if (worker?.isActive(downloadId) || this.workers.has(downloadId)) {
        await worker?.cancel(downloadId);
      }

      await cleanupCancelledDownload(downloadId);
      await cleanupHlsWorkspace(downloadId);
      await cleanupMultiRangeWorkspace(downloadId);
      await removeLocalRecord(downloadId);
      clearDownloadSessionMeta(downloadId);
      logSessionDownload('context_destroyed', { downloadId, reason: 'cancelled' });
      this.snapshots.delete(downloadId);
      this.workers.delete(downloadId);
      this.ensureScheduler().release(downloadId);
      this.setStatusHint(downloadId, 'CANCELLED');
      await syncStatusImmediate(downloadId, 'CANCELLED', {
        errorMessage: null,
        workerState: 'CANCELLED',
      });
      this.emit({ type: 'cancelled', downloadId });
      this.emit({ type: 'status', downloadId, status: 'CANCELLED' });
      logPauseResume({ downloadId, action: 'cancel', outcome: 'ok' });
      this.pump();
    } finally {
      this.locks.delete(downloadId);
    }
  }

  /**
   * Canonical manual Retry: FAILED → QUEUED → DOWNLOADING (same download id).
   * Resets the auto-retry cycle so the user can recover after budget exhaustion.
   */
  async retry(downloadId: string): Promise<void> {
    if (this.locks.has(downloadId)) {
      return;
    }
    this.locks.add(downloadId);
    let enqueueInput: SchedulerJobInput | null = null;
    try {
      this.clearRetryTimer(downloadId);

      if (this.workers.has(downloadId)) {
        throw new DownloadEngineError(
          'TRANSFER_INTERRUPTED',
          'Unable to retry this download right now.',
        );
      }

      if (this.ensureScheduler().has(downloadId)) {
        this.ensureScheduler().cancelPending(downloadId);
        this.ensureScheduler().release(downloadId);
      }

      const existing = await getLocalRecord(downloadId);
      if (!existing) {
        throw new DownloadEngineError(
          'WORKER_NOT_FOUND',
          'Unable to retry this download.',
        );
      }

      if (
        existing.remoteStatus === 'CANCELLED' ||
        existing.localState === 'deleted'
      ) {
        throw new DownloadEngineError(
          'INVALID_RESOURCE',
          'This download can no longer be retried.',
        );
      }

      if (existing.remoteStatus === 'COMPLETED' || existing.localState === 'complete') {
        return;
      }

      if (
        existing.remoteStatus !== 'FAILED' &&
        existing.localState !== 'failed' &&
        existing.localState !== 'corrupt' &&
        existing.localState !== 'missing'
      ) {
        throw new DownloadEngineError(
          'TRANSFER_INTERRUPTED',
          'Only failed downloads can be retried.',
        );
      }

      if (!isManualRetryAllowed(existing.errorCode)) {
        throw new DownloadEngineError(
          existing.errorCode ?? 'INVALID_RESOURCE',
          existing.errorMessage ?? 'This download can’t be retried.',
        );
      }

      const prepared = await this.prepareRetryPartial(existing);

      this.suppressedIds.delete(downloadId);

      // Persist QUEUED + release lock BEFORE enqueue (same race as resume).
      this.setStatusHint(downloadId, 'QUEUED');
      await upsertLocalRecord({
        ...prepared,
        localState: 'not_started',
        remoteStatus: 'QUEUED',
        errorCode: null,
        errorMessage: null,
        retryCount: 0,
        maxRetries: DOWNLOAD_ENGINE.maxAutoRetryAttempts,
        retryEligible: true,
        lastAttemptAt: new Date().toISOString(),
        nextRetryAt: null,
      });

      try {
        await syncStatusImmediate(downloadId, 'QUEUED', {
          errorCode: null,
          errorMessage: null,
        });
      } catch {
        // Local queue remains authoritative if backend sync races.
      }

      this.emit({ type: 'status', downloadId, status: 'QUEUED' });
      enqueueInput = await this.resolveRetryEnqueueInput(prepared, {
        forceRefresh: true,
      });
    } finally {
      this.locks.delete(downloadId);
    }

    if (!enqueueInput) {
      return;
    }

    const enqueued = this.ensureScheduler().enqueue(enqueueInput);
    if (!enqueued) {
      throw new DownloadEngineError(
        'TRANSFER_INTERRUPTED',
        'Unable to retry this download.',
      );
    }

    this.pump();

    const snapshot = this.getQueueSnapshot();
    if (snapshot.pending.some((item) => item.downloadId === downloadId)) {
      this.emit({ type: 'status', downloadId, status: 'QUEUED' });
    }
  }

  async remove(downloadId: string): Promise<void> {
    this.suppressedIds.add(downloadId);
    this.clearRetryTimer(downloadId);
    this.ensureScheduler().cancelPending(downloadId);
    const worker = this.workers.get(downloadId);
    if (worker?.isActive(downloadId)) {
      await worker.cancel(downloadId);
    }
    clearSyncState(downloadId);
    await cleanupHlsWorkspace(downloadId);
    await cleanupMultiRangeWorkspace(downloadId);
    await deleteDownloadFiles(downloadId);
    await removeLocalRecord(downloadId);
    this.snapshots.delete(downloadId);
    this.workers.delete(downloadId);
    this.pump();
    // Notify Library / playback bridges after local truth is gone (idempotent).
    this.emit({ type: 'removed', downloadId });
  }

  /**
   * Reconcile local records after process start.
   * Uses decideRecoveryState — does not invent transfers or auto-resume.
   * Platform FGS registry is reconciled before recovery enqueue.
   */
  async recover(): Promise<void> {
    if (this.recovering) {
      return;
    }
    this.recovering = true;
    hardeningLog('recovery.start', {});
    try {
      downloadAppLifecycle.ensureAttached();
      // Bootstrap order: native snapshot → align ledger to JS workers → recovery.
      await getDownloadExecutionCoordinator().reconcile({
        jsActiveIds: [...this.workers.keys()],
      });

      const records = await listLocalRecords();

      for (const record of records) {
        await this.applyRecoveryForRecord(record, { allowEnqueue: true });
      }
      hardeningLog('recovery.reconciled', { count: records.length });
    } finally {
      this.recovering = false;
    }
  }

  /**
   * Lightweight foreground check — stale DOWNLOADING without worker only.
   * Does not rebuild the full queue or duplicate workers.
   * Queries native FGS snapshot first (idempotent; Model B JS owns transfer).
   */
  async reconcileForeground(): Promise<void> {
    if (this.recovering || this.foregroundReconciling) {
      return;
    }
    this.foregroundReconciling = true;
    try {
      await getDownloadExecutionCoordinator().reconcile({
        jsActiveIds: [...this.workers.keys()],
      });

      const records = await listLocalRecords();
      for (const record of records) {
        if (
          record.remoteStatus !== 'DOWNLOADING' &&
          record.localState !== 'transferring'
        ) {
          continue;
        }
        if (this.workers.has(record.downloadId)) {
          continue;
        }
        // Native-only ID without JS worker cannot continue transfer in Model B.
        await this.applyRecoveryForRecord(record, { allowEnqueue: false });
      }
    } finally {
      this.foregroundReconciling = false;
    }
  }

  private inspectRecoveryEvidence(record: LocalDownloadRecord): {
    decision: RecoveryDecision;
    transferFile: File;
    finalFile: File;
    durablePause: ReturnType<typeof buildDurablePauseState>;
    assessment: ReturnType<typeof assessLocalFile>;
  } {
    const isHls = isPlaylistOrStreamUrl(record.sourceUrl);
    const hasActiveWorker = this.workers.has(record.downloadId);
    const isQueued = this.ensureScheduler().has(record.downloadId);
    const isSuppressed = this.suppressedIds.has(record.downloadId);

    const { final: finalFile, partial: transferFile } = resolveTransferTargets(
      record.downloadId,
      record.fileName,
      { sourceUrl: record.sourceUrl },
    );

    const assessment = assessLocalFile({
      downloadId: record.downloadId,
      localUri: record.localUri ?? transferFile.uri,
      expectedBytes: record.totalBytes,
      preferPartial: true,
    });

    const partialSize =
      assessment.presence === 'partial'
        ? assessment.size
        : readPartialFileSize(transferFile);
    const hasMultiRangePartial =
      !isHls && hasResumableMultiRange(record.multiRange);
    const hasHlsWorkspace =
      isHls &&
      record.hlsTransfer != null &&
      record.hlsTransfer.completedSegments >= 0 &&
      record.hlsTransfer.totalSegments > 0;
    const hasValidPartial =
      (!isHls && partialSize > 0) || hasMultiRangePartial || hasHlsWorkspace;

    let durablePause = null as ReturnType<typeof buildDurablePauseState>;
    if (hasValidPartial && !hasMultiRangePartial) {
      durablePause = buildDurablePauseState(
        record.sourceUrl,
        transferFile,
        record.pauseState,
        partialSize,
      );
    } else if (
      record.pauseState?.resumeData &&
      parseAndroidResumeOffset(record.pauseState.resumeData) == null
    ) {
      // Opaque iOS resume blob may exist without on-disk bytes yet.
      durablePause = buildDurablePauseState(
        record.sourceUrl,
        transferFile,
        record.pauseState,
        0,
      );
    }

    const canResume =
      Boolean(durablePause?.resumeData) || hasMultiRangePartial;

    let hasVerifiedFinalFile = false;
    let completedFileMissing = false;
    if (
      record.remoteStatus === 'COMPLETED' ||
      record.localState === 'complete'
    ) {
      if (record.localUri) {
        const file = new File(record.localUri);
        const verified = verifyCompletedFile(file, record.totalBytes, {
          downloadId: record.downloadId,
        });
        hasVerifiedFinalFile = verified.ok;
        completedFileMissing = !verified.ok;
      } else {
        completedFileMissing = true;
      }
    }

    const decision = decideRecoveryState({
      remoteStatus: record.remoteStatus,
      localState: record.localState,
      hasActiveWorker,
      isQueued,
      isSuppressed,
      isHls,
      hasValidPartial: hasValidPartial || canResume,
      canResume,
      hasVerifiedFinalFile,
      completedFileMissing,
      sourceUrlSafe: isSafeHttpUrl(record.sourceUrl),
    });

    return { decision, transferFile, finalFile, durablePause, assessment };
  }

  private async applyRecoveryForRecord(
    record: LocalDownloadRecord,
    options: { allowEnqueue: boolean },
  ): Promise<void> {
    const id = record.downloadId;
    const { decision, transferFile, finalFile, durablePause, assessment } =
      this.inspectRecoveryEvidence(record);

    if (__DEV__) {
      console.info(
        JSON.stringify({
          scope: 'download-recovery',
          downloadId: id,
          remoteStatus: record.remoteStatus,
          localState: record.localState,
          workerPresent: this.workers.has(id),
          retryCount: record.retryCount,
          recoveryDecision: decision.action,
          reason: decision.reason,
        }),
      );
    }

    switch (decision.action) {
      case 'KEEP_CANCELLED': {
        this.suppressedIds.add(id);
        this.clearRetryTimer(id);
        this.ensureScheduler().cancelPending(id);
        await cleanupHlsWorkspace(id);
        await cleanupMultiRangeWorkspace(id);
        await removeLocalRecord(id);
        this.snapshots.delete(id);
        return;
      }

      case 'KEEP_DOWNLOADING':
      case 'NO_ACTION':
        return;

      case 'KEEP_COMPLETED': {
        this.publishSnapshot(
          toTransferSnapshot(
            id,
            {
              bytesWritten: record.totalBytes ?? record.bytesWritten,
              totalBytes: record.totalBytes,
              progress: 100,
              bytesPerSecond: null,
              etaSeconds: 0,
            },
            record.localUri,
            'complete',
          ),
        );
        return;
      }

      case 'MARK_LOCAL_UNAVAILABLE': {
        const localState =
          assessment.presence === 'missing' || !record.localUri
            ? 'missing'
            : 'corrupt';
        await upsertLocalRecord({
          ...record,
          localState,
          remoteStatus: 'COMPLETED',
        });
        this.publishSnapshot(
          toTransferSnapshot(
            id,
            {
              bytesWritten: record.bytesWritten,
              totalBytes: record.totalBytes,
              progress: 0,
              bytesPerSecond: null,
              etaSeconds: null,
            },
            record.localUri,
            localState,
            'FINAL_FILE_INVALID',
            localState === 'missing'
              ? 'Downloaded file is no longer available on this device.'
              : 'Downloaded file failed integrity checks.',
          ),
        );
        return;
      }

      case 'KEEP_PAUSED': {
        if (durablePause && durablePause !== record.pauseState) {
          await upsertLocalRecord({
            ...record,
            localState: 'paused',
            remoteStatus: 'PAUSED',
            pauseState: durablePause,
            localUri: transferFile.uri,
            bytesWritten:
              parseAndroidResumeOffset(durablePause.resumeData) ??
              record.bytesWritten,
          });
        }
        return;
      }

      case 'KEEP_FAILED': {
        if (
          shouldScheduleAutoRetry({
            retryEligible: record.retryEligible,
            retryCount: record.retryCount,
            errorCode: record.errorCode,
          })
        ) {
          const due = record.nextRetryAt
            ? Date.parse(record.nextRetryAt)
            : NaN;
          const delay = Number.isFinite(due)
            ? Math.max(0, due - Date.now())
            : computeRetryDelayMs(record.retryCount);
          this.scheduleAutoRetry(id, delay);
        }
        return;
      }

      case 'RECOVER_TO_PAUSED': {
        if (this.recoveredLifecycleIds.has(id)) {
          return;
        }
        this.recoveredLifecycleIds.add(id);
        this.clearRetryTimer(id);

        const isHls = isPlaylistOrStreamUrl(record.sourceUrl);
        // Preserve HLS segment workspace for network-policy / resumable holds.
        // Only wipe when there is no recoverable workspace evidence.
        if (isHls && !record.hlsTransfer) {
          await cleanupHlsWorkspace(id);
        }

        const pauseState = isHls
          ? null
          : durablePause ??
            buildDurablePauseState(
              record.sourceUrl,
              transferFile,
              record.pauseState,
              record.bytesWritten,
            );

        await upsertLocalRecord({
          ...record,
          localState: 'paused',
          remoteStatus: 'PAUSED',
          pauseReason: record.pauseReason ?? 'SYSTEM_RECOVERY',
          pauseState,
          localUri: isHls ? record.localUri : transferFile.uri,
          bytesWritten: isHls
            ? record.hlsTransfer?.downloadedBytes ?? record.bytesWritten
            : parseAndroidResumeOffset(pauseState?.resumeData) ??
              record.bytesWritten,
          errorCode: null,
          errorMessage: null,
          hlsTransfer: isHls ? record.hlsTransfer : record.hlsTransfer,
        });

        if (record.remoteStatus === 'DOWNLOADING') {
          try {
            await syncStatusImmediate(id, 'PAUSED');
          } catch {
            // Sync layer retries; local PAUSED remains authoritative.
          }
        }

        this.emit({ type: 'status', downloadId: id, status: 'PAUSED' });

        const autoResume = isAutoResumeEnabled();
        const canResumeProgressive = Boolean(pauseState?.resumeData);
        const canResumeHls = Boolean(record.hlsTransfer);
        const userPaused = record.pauseReason === 'USER';
        const eligible =
          options.allowEnqueue &&
          autoResume &&
          !userPaused &&
          (canResumeProgressive || canResumeHls) &&
          !this.workers.has(id) &&
          !this.ensureScheduler().has(id);

        if (eligible) {
          try {
            await this.resume(id);
          } catch {
            // Leave PAUSED for manual resume.
          }
        }
        return;
      }

      case 'RECOVER_TO_FAILED': {
        if (this.recoveredLifecycleIds.has(id)) {
          return;
        }
        this.recoveredLifecycleIds.add(id);
        this.clearRetryTimer(id);
        this.ensureScheduler().cancelPending(id);

        const errorCode = decision.errorCode ?? 'TRANSFER_INTERRUPTED';
        const errorMessage =
          decision.errorMessage ?? 'The download was interrupted.';

        await upsertLocalRecord({
          ...record,
          localState: 'failed',
          remoteStatus: 'FAILED',
          pauseState: null,
          errorCode: errorCode as LocalDownloadRecord['errorCode'],
          errorMessage,
          retryEligible: isManualRetryAllowed(
            errorCode as LocalDownloadRecord['errorCode'],
          ),
        });

        try {
          await syncStatusImmediate(id, 'FAILED', {
            errorCode,
            errorMessage,
          });
        } catch {
          // ignore
        }

        this.emit({
          type: 'failed',
          downloadId: id,
          code: errorCode as never,
          message: errorMessage,
        });
        this.emit({
          type: 'status',
          downloadId: id,
          status: 'FAILED',
          errorMessage,
        });
        return;
      }

      case 'REENQUEUE': {
        if (!options.allowEnqueue) {
          return;
        }
        if (this.ensureScheduler().has(id) || this.workers.has(id) || this.suppressedIds.has(id)) {
          return;
        }
        if (this.recoveredLifecycleIds.has(`enqueue:${id}`)) {
          return;
        }
        this.recoveredLifecycleIds.add(`enqueue:${id}`);

        const meta = getDownloadSessionMeta(id);
        // Process death: ephemeral session context is gone — fail safely, no secret inventing.
        if (record.requiresEphemeralSession && !meta) {
          logSessionDownload('execution_context_missing', { downloadId: id });
          await upsertLocalRecord({
            ...record,
            localState: 'failed',
            remoteStatus: 'FAILED',
            errorCode: 'SESSION_CONTEXT_LOST',
            errorMessage:
              'This authenticated download needs the active website session. Open the website and retry.',
            retryEligible: false,
            nextRetryAt: null,
          });
          this.emit({
            type: 'failed',
            downloadId: id,
            code: 'SESSION_CONTEXT_LOST' as never,
            message:
              'This authenticated download needs the active website session. Open the website and retry.',
          });
          this.emit({
            type: 'status',
            downloadId: id,
            status: 'FAILED',
            errorMessage:
              'This authenticated download needs the active website session. Open the website and retry.',
          });
          return;
        }

        this.setStatusHint(id, 'QUEUED');
        const enqueued = this.ensureScheduler().enqueue({
          id: record.downloadId,
          sourceUrl: record.sourceUrl,
          fileName: record.fileName,
          fileSize: record.expectedFileSize,
          requestContext: meta?.requestContext ?? null,
        });
        if (!enqueued) {
          return;
        }

        await upsertLocalRecord({
          ...record,
          localState: 'not_started',
          remoteStatus: 'QUEUED',
          errorCode: null,
          errorMessage: null,
        });
        this.emit({ type: 'status', downloadId: id, status: 'QUEUED' });
        this.ensureScheduler().requestDrain('recovery');
        return;
      }

      default:
        return;
    }
  }

  private clearRetryTimer(downloadId: string): void {
    const timer = this.retryTimers.get(downloadId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(downloadId);
    }
    this.retryScheduling.delete(downloadId);
  }

  private scheduleAutoRetry(downloadId: string, delayMs?: number): void {
    if (
      this.retryTimers.has(downloadId) ||
      this.retryScheduling.has(downloadId)
    ) {
      return;
    }
    if (this.suppressedIds.has(downloadId) || this.ensureScheduler().has(downloadId)) {
      return;
    }

    // Do not arm a new timer while offline / waiting for Wi-Fi — defer.
    {
      const settings = getDownloadSettings();
      const network = getDownloadNetworkState();
      const admission = evaluateNetworkAdmission(settings.wifiOnly, network);
      if (!admission.allowed && delayMs === undefined) {
        // Still record nextRetryAt intent but use a deferred timer.
        delayMs = computeRetryDelayMs(0);
        hardeningLog('retry.scheduled', {
          downloadId,
          deferred: true,
          reason: admission.reason,
        });
      }
    }

    this.retryScheduling.add(downloadId);
    void (async () => {
      try {
        const record = await getLocalRecord(downloadId);
        if (
          !record ||
          record.remoteStatus !== 'FAILED' ||
          !shouldScheduleAutoRetry({
            retryEligible: record.retryEligible,
            retryCount: record.retryCount,
            errorCode: record.errorCode,
          })
        ) {
          return;
        }

        const delay = applyRetryJitter(
          delayMs ?? computeRetryDelayMs(record.retryCount),
        );
        const nextRetryAt = new Date(Date.now() + delay).toISOString();
        await upsertLocalRecord({
          ...record,
          nextRetryAt,
          lastAttemptAt: record.lastAttemptAt ?? new Date().toISOString(),
        });

        try {
          await syncStatusImmediate(downloadId, 'FAILED', {
            workerState: 'RETRY_WAIT',
            errorCode: record.errorCode,
            errorMessage: record.errorMessage,
          });
        } catch {
          // Non-fatal — timer still owns local retry scheduling.
        }

        if (this.retryTimers.has(downloadId)) {
          return;
        }

        const timer = setTimeout(() => {
          this.retryTimers.delete(downloadId);
          void this.executeScheduledRetry(downloadId);
        }, delay);
        this.retryTimers.set(downloadId, timer);
      } finally {
        this.retryScheduling.delete(downloadId);
      }
    })();
  }

  private async executeScheduledRetry(downloadId: string): Promise<void> {
    if (
      this.locks.has(downloadId) ||
      this.suppressedIds.has(downloadId) ||
      this.workers.has(downloadId) ||
      this.ensureScheduler().has(downloadId)
    ) {
      return;
    }

    // Offline / Wi-Fi waiting — do not promote FAILED→QUEUED (avoids retry storms).
    const settings = getDownloadSettings();
    const network = getDownloadNetworkState();
    const admission = evaluateNetworkAdmission(settings.wifiOnly, network);
    if (!admission.allowed) {
      hardeningLog('retry.scheduled', {
        downloadId,
        deferred: true,
        reason: admission.reason,
      });
      // Keep FAILED + RETRY_WAIT; reschedule without resetting retryCount.
      this.scheduleAutoRetry(downloadId, computeRetryDelayMs(0));
      return;
    }

    this.locks.add(downloadId);
    try {
      const existing = await getLocalRecord(downloadId);
      if (
        !existing ||
        existing.remoteStatus !== 'FAILED' ||
        !shouldScheduleAutoRetry({
          retryEligible: existing.retryEligible,
          retryCount: existing.retryCount,
          errorCode: existing.errorCode,
        })
      ) {
        return;
      }

      const prepared = await this.prepareRetryPartial(existing);
      const nextCount = prepared.retryCount + 1;

      this.setStatusHint(downloadId, 'QUEUED');
      const enqueued = this.ensureScheduler().enqueue(
        await this.resolveRetryEnqueueInput(prepared),
      );
      if (!enqueued) {
        return;
      }

      await upsertLocalRecord({
        ...prepared,
        localState: 'not_started',
        remoteStatus: 'QUEUED',
        errorCode: null,
        errorMessage: null,
        retryCount: nextCount,
        nextRetryAt: null,
        lastAttemptAt: new Date().toISOString(),
      });

      try {
        await syncStatusImmediate(downloadId, 'QUEUED', {
          errorCode: null,
          errorMessage: null,
        });
      } catch {
        // ignore
      }
      this.emit({ type: 'status', downloadId, status: 'QUEUED' });
    } finally {
      this.locks.delete(downloadId);
    }

    this.pump();
  }

  /**
   * Validate partial for Range reuse; wipe and clear pauseState when unsafe.
   */
  private async prepareRetryPartial(
    existing: LocalDownloadRecord,
  ): Promise<LocalDownloadRecord> {
    if (isPlaylistOrStreamUrl(existing.sourceUrl)) {
      return {
        ...existing,
        pauseState: null,
        rangeValidators: null,
      };
    }

    const { final: finalFile, partial: transferFile } = resolveTransferTargets(
      existing.downloadId,
      existing.fileName,
      { sourceUrl: existing.sourceUrl },
    );
    deleteRangePartQuiet(transferFile);
    deleteRangePartQuiet(finalFile);

    const forceCleanRestart =
      existing.errorCode === 'SOURCE_CHANGED' ||
      existing.errorCode === 'RESUME_UNSUPPORTED' ||
      existing.errorCode === 'RANGE_REJECTED' ||
      existing.errorCode === 'INVALID_RANGE_RESPONSE' ||
      existing.errorCode === 'PARTIAL_FILE_CORRUPT' ||
      existing.errorCode === 'FINAL_FILE_INVALID' ||
      existing.errorCode === 'FINAL_SIZE_MISMATCH' ||
      existing.errorCode === 'PARTIAL_FILE_MISSING' ||
      existing.errorCode === 'RESUME_STATE_MISSING' ||
      existing.errorCode === 'MERGE_FAILED' ||
      existing.errorCode === 'PART_SIZE_MISMATCH';

    if (forceCleanRestart) {
      try {
        await cleanupMultiRangeWorkspace(existing.downloadId);
        await deleteDownloadFiles(existing.downloadId);
      } catch {
        // ignore
      }
      return {
        ...existing,
        pauseState: null,
        multiRange: null,
        rangeValidators: null,
        bytesWritten: 0,
        localUri: null,
      };
    }

    if (hasResumableMultiRange(existing.multiRange)) {
      return {
        ...existing,
        pauseState: null,
        multiRange: existing.multiRange,
        rangeValidators: existing.rangeValidators ?? null,
        bytesWritten: sumMultiRangeDownloaded(existing.multiRange!),
        localUri: existing.localUri,
      };
    }

    if (!existing.pauseState?.resumeData) {
      // Controlled restart from byte 0 — remove any stray partial.
      try {
        deletePartialTransferQuiet(transferFile);
        deleteFinalQuiet(finalFile);
        await cleanupMultiRangeWorkspace(existing.downloadId);
      } catch {
        // ignore
      }
      return {
        ...existing,
        pauseState: null,
        multiRange: null,
        rangeValidators: existing.rangeValidators,
        bytesWritten: 0,
        localUri: null,
      };
    }

    const verified = verifyPartialForRetry(
      transferFile,
      existing.pauseState.fileUri ?? existing.localUri,
    );
    if (!verified.ok) {
      try {
        await deleteDownloadFiles(existing.downloadId);
      } catch {
        // ignore
      }
      return {
        ...existing,
        pauseState: null,
        multiRange: null,
        rangeValidators: null,
        bytesWritten: 0,
        localUri: null,
      };
    }

    const durable = buildDurablePauseState(
      existing.sourceUrl,
      transferFile,
      existing.pauseState,
      verified.size,
    );
    if (!durable) {
      try {
        await deleteDownloadFiles(existing.downloadId);
      } catch {
        // ignore
      }
      return {
        ...existing,
        pauseState: null,
        multiRange: null,
        bytesWritten: 0,
        localUri: null,
      };
    }

    const offset = parseAndroidResumeOffset(durable.resumeData);
    return {
      ...existing,
      pauseState: durable,
      multiRange: null,
      bytesWritten: offset ?? verified.size,
      localUri: transferFile.uri,
    };
  }

  private pump(): void {
    this.ensureScheduler().requestDrain();
  }

  /**
   * Admission handoff — register worker ownership and kick off transfer without
   * awaiting completion (so the serialized drain can continue).
   * Ensures Android FGS protection via DownloadExecutionCoordinator (Model B).
   */
  private async admitWorker(job: SchedulerJobInput): Promise<AdmissionResult> {
    const input: EnqueueInput = {
      id: job.id,
      sourceUrl: job.sourceUrl,
      fileName: job.fileName,
      fileSize: job.fileSize,
      title: job.title,
      streamType:
        job.streamType ??
        getDownloadSessionMeta(job.id)?.streamType ??
        null,
      requestContext: job.requestContext ?? null,
    };

    if (this.suppressedIds.has(input.id)) {
      return admissionTerminal('SUPPRESSED');
    }

    if (this.locks.has(input.id)) {
      logWorkerLifecycle({
        downloadId: input.id,
        event: 'released',
        releaseReason: 'admit_precheck_rejected',
      });
      return admissionRequeue('LOCK_HELD');
    }

    if (this.workers.has(input.id)) {
      return admissionRequeue('ALREADY_ACTIVE');
    }

    // Duplicate defense: coordinator already tracks this execution.
    const coordinator = getDownloadExecutionCoordinator();
    if (coordinator.isExecutionOwned(input.id) && this.workers.has(input.id)) {
      return admissionRequeue('ALREADY_ACTIVE');
    }

    const existing = await getLocalRecord(input.id);

    if (
      this.suppressedIds.has(input.id) ||
      this.locks.has(input.id) ||
      !existing
    ) {
      return admissionRequeue(
        !existing ? 'INVALID_RECORD' : 'LOCK_HELD',
      );
    }

    if (TERMINAL_LOCAL.has(existing.localState)) {
      return admissionTerminal('TERMINAL');
    }

    if (existing.remoteStatus === 'CANCELLED') {
      this.setStatusHint(input.id, 'CANCELLED', 'admit_record_terminal');
      return admissionTerminal('CANCELLED');
    }

    if (existing.remoteStatus === 'COMPLETED') {
      this.setStatusHint(input.id, 'COMPLETED', 'admit_record_terminal');
      return admissionTerminal('TERMINAL');
    }

    if (existing.remoteStatus === 'FAILED') {
      this.setStatusHint(input.id, 'FAILED', 'admit_record_terminal');
      return admissionTerminal('TERMINAL');
    }

    if (existing.remoteStatus === 'PAUSED') {
      this.setStatusHint(input.id, 'PAUSED', 'admit_record_terminal');
      return admissionTerminal('PAUSED');
    }

    // Provisional FGS ownership BEFORE worker registration (stop-race safe).
    const begin = await coordinator.beginExecution(input.id);
    if (!begin.admitted) {
      await coordinator.endExecution(input.id);
      logWorkerLifecycle({
        downloadId: input.id,
        event: 'released',
        releaseReason: 'fgs_not_admitted',
      });
      return admissionRequeue('FGS_NOT_ADMITTED');
    }

    if (existing.requiresEphemeralSession) {
      try {
        assertSessionBoundExecutionContext(input.id, input.requestContext);
      } catch (error) {
        await coordinator.endExecution(input.id);
        const message =
          error instanceof DownloadEngineError
            ? error.message
            : 'This authenticated download needs the active website session. Open the website and retry.';
        const code =
          error instanceof DownloadEngineError ? error.code : 'SESSION_CONTEXT_LOST';
        await upsertLocalRecord({
          ...existing,
          localState: 'failed',
          remoteStatus: 'FAILED',
          errorCode: code,
          errorMessage: message,
          retryEligible: false,
          nextRetryAt: null,
        });
        this.emit({
          type: 'failed',
          downloadId: input.id,
          code: code as never,
          message,
        });
        return admissionTerminal('TERMINAL');
      }
    }

    if (this.suppressedIds.has(input.id) || this.workers.has(input.id)) {
      await coordinator.endExecution(input.id);
      return this.suppressedIds.has(input.id)
        ? admissionTerminal('SUPPRESSED')
        : admissionRequeue('ALREADY_ACTIVE');
    }

    // Refresh stale social CDN URLs before bytes move.
    if (isSocialCdnUrl(input.sourceUrl)) {
      const meta = getDownloadSessionMeta(input.id);
      const detectedAt =
        meta?.detectedAt ?? input.requestContext?.capturedAt ?? Date.now();
      if (isLikelyExpiredMediaUrl(input.sourceUrl, detectedAt)) {
        const refreshed = await this.tryRefreshExpiredDownload(input.id, existing);
        if (refreshed) {
          await coordinator.endExecution(input.id);
          return admissionHandoff('social_refresh_handoff');
        }
      }
    }

    const worker: AnyTransferWorker = shouldUseHlsTransfer({
      sourceUrl: input.sourceUrl,
      streamType: input.streamType,
    })
      ? new HlsTransferWorker(
          (event) => this.emit(event),
          (snapshot) => this.publishSnapshot(snapshot),
        )
      : new TransferWorker(
          (event) => this.emit(event),
          (snapshot) => this.publishSnapshot(snapshot),
          () => [...this.workers.keys()],
        );

    this.workers.set(input.id, worker);

    const { partial: transferFile } = resolveTransferTargets(
      input.id,
      input.fileName,
      { sourceUrl: input.sourceUrl },
    );
    const attemptStartBytes = Math.max(
      existing.bytesWritten ?? 0,
      existing.hlsTransfer?.downloadedBytes ?? 0,
      readPartialFileSize(transferFile),
    );
    const generation = (existing.generation ?? 0) + 1;
    this.ensureExecutionRecord(input.id, generation, attemptStartBytes);
    this.applyExecutionTransition(input.id, 'STARTING', 'worker_admitted', {
      generation,
      attemptStartBytes,
      bytesWritten: attemptStartBytes,
      totalBytes: existing.totalBytes,
    });
    this.setStatusHint(input.id, 'QUEUED', 'worker_starting');
    this.emit({
      type: 'status',
      downloadId: input.id,
      status: 'QUEUED',
      workerState: 'STARTING',
      executionState: 'STARTING',
    });
    logWorkerLifecycle({
      downloadId: input.id,
      event: 'admitted',
      transferType: worker instanceof HlsTransferWorker ? 'hls' : 'progressive',
      admittedAt: Date.now(),
    });

    void (async () => {
      try {
        if (this.suppressedIds.has(input.id)) {
          await worker.cancel(input.id);
          return;
        }
        await worker.run(input, existing);
      } finally {
        if (this.workers.get(input.id) === worker) {
          this.workers.delete(input.id);
          this.ensureScheduler().release(input.id);
          logWorkerLifecycle({
            downloadId: input.id,
            event: 'released',
            releaseReason: 'worker_settled',
            releasedAt: Date.now(),
          });
          try {
            await coordinator.endExecution(input.id);
          } catch {
            // never block settle
          }
          void this.afterWorkerSettled(input.id);
        }
      }
    })();

    return admissionStarted();
  }

  /**
   * Rebuild enqueue input for retry/resume with in-memory session context.
   * Manual retry on social pages refreshes the CDN URL once before transfer.
   * Uses Phase 4C social source provider when identity is available.
   */
  private async resolveRetryEnqueueInput(
    record: LocalDownloadRecord,
    options?: { forceRefresh?: boolean; refreshIfStale?: boolean },
  ): Promise<EnqueueInput> {
    const meta = getDownloadSessionMeta(record.downloadId);
    let sourceUrl = record.sourceUrl;
    let requestContext = meta?.requestContext ?? null;

    const expiredNow = isLikelyExpiredMediaUrl(record.sourceUrl, Date.now());
    const shouldRefresh =
      Boolean(meta?.pageUrl || meta?.socialIdentity?.pageUrl) &&
      ((Boolean(options?.forceRefresh) && !meta?.refreshAttempted) ||
        (Boolean(options?.refreshIfStale) && expiredNow) ||
        (Boolean(options?.refreshIfStale) &&
          shouldRefreshSourceOnResume(record) &&
          !meta?.refreshAttempted));

    if (shouldRefresh && meta && !meta.refreshAttempted) {
      ensurePhase1SocialSourceRefreshRegistered();
      const reason: SocialSourceRefreshReason = options?.forceRefresh
        ? 'MANUAL_RETRY'
        : 'RESUME_STALE';
      const fresh = await resolveFreshSocialSourceForDownload({
        downloadId: record.downloadId,
        downloadGeneration: record.generation,
        priorSourceUrl: record.sourceUrl,
        priorRequestContext: requestContext,
        identity: meta.socialIdentity
          ? {
              ...meta.socialIdentity,
              pageUrl: meta.socialIdentity.pageUrl ?? meta.pageUrl,
            }
          : meta.pageUrl
            ? {
                contentIdentity: '',
                variantIdentity: '',
                pageUrl: meta.pageUrl,
              }
            : null,
        reason,
      });

      if (fresh.type === 'FRESH' && fresh.sourceUrl) {
        const urlChanged = fresh.sourceUrl !== record.sourceUrl;
        sourceUrl = fresh.sourceUrl;
        requestContext = fresh.requestContext;
        markDownloadRefreshAttempted(record.downloadId);
        setDownloadSessionMeta(record.downloadId, {
          ...meta,
          pageUrl: fresh.requestContext.pageUrl ?? meta.pageUrl,
          requestContext: stripRequestContextSecrets(fresh.requestContext),
          detectedAt: Date.now(),
          refreshAttempted: true,
          streamType: meta.streamType ?? null,
          socialIdentity: meta.socialIdentity
            ? {
                ...meta.socialIdentity,
                contentIdentity:
                  fresh.contentIdentity ?? meta.socialIdentity.contentIdentity,
                variantIdentity:
                  fresh.variantIdentity ?? meta.socialIdentity.variantIdentity,
                pageUrl: fresh.requestContext.pageUrl ?? meta.socialIdentity.pageUrl,
              }
            : meta.socialIdentity,
          // Preserve Account A coherence — never adopt a different session fingerprint from refresh.
          sessionCoherenceFingerprint: meta.sessionCoherenceFingerprint,
          coherenceCookieUrl: meta.coherenceCookieUrl,
          cookieStrategy: meta.cookieStrategy,
          accessMode: meta.accessMode,
          authRetryBudget: meta.authRetryBudget,
        });
        // Fresh URL for same social identity does NOT imply safe append.
        // Wipe resume validators when URL changes; Phase 1 Range probe decides.
        await upsertLocalRecord({
          ...record,
          sourceUrl,
          pauseState: urlChanged ? null : record.pauseState,
          bytesWritten: urlChanged ? 0 : record.bytesWritten,
          multiRange: urlChanged ? null : record.multiRange,
          rangeValidators: urlChanged ? null : record.rangeValidators,
          hlsTransfer: urlChanged ? null : record.hlsTransfer,
          updatedAt: new Date().toISOString(),
        });
      } else {
        markDownloadRefreshAttempted(record.downloadId);
      }
    }

    return {
      id: record.downloadId,
      sourceUrl,
      fileName: record.fileName,
      fileSize: record.expectedFileSize,
      streamType: meta?.streamType ?? null,
      requestContext,
      socialSourceIdentity: meta?.socialIdentity ?? null,
    };
  }

  /**
   * One controlled refresh when a social CDN URL likely expired (403/404).
   * Restarts from byte 0 after AUTH wipe — never blind-appends a refreshed URL.
   */
  private async tryRefreshExpiredDownload(
    downloadId: string,
    record: LocalDownloadRecord,
  ): Promise<boolean> {
    const meta = getDownloadSessionMeta(downloadId);
    if ((!meta?.pageUrl && !meta?.socialIdentity?.pageUrl) || meta.refreshAttempted) {
      return false;
    }

    markDownloadRefreshAttempted(downloadId);

    ensurePhase1SocialSourceRefreshRegistered();

    const reason: SocialSourceRefreshReason =
      record.errorCode === 'AUTH_ERROR' ? 'AUTH_EXPIRED' : 'INVALID_RESOURCE';

    const fresh = await resolveFreshSocialSourceForDownload({
      downloadId,
      downloadGeneration: record.generation,
      priorSourceUrl: record.sourceUrl,
      priorRequestContext: meta.requestContext,
      identity: meta.socialIdentity
        ? {
            ...meta.socialIdentity,
            pageUrl: meta.socialIdentity.pageUrl ?? meta.pageUrl,
          }
        : meta.pageUrl
          ? {
              contentIdentity: '',
              variantIdentity: '',
              pageUrl: meta.pageUrl,
            }
          : null,
      reason,
    });

    if (fresh.type !== 'FRESH' || !fresh.sourceUrl) {
      return false;
    }

    // Mid-transfer auth failure already wiped partial in worker — restart from 0.
    await upsertLocalRecord({
      ...record,
      sourceUrl: fresh.sourceUrl,
      localState: 'not_started',
      bytesWritten: 0,
      totalBytes: null,
      pauseState: null,
      rangeValidators: null,
      multiRange: null,
      hlsTransfer: null,
      errorCode: null,
      errorMessage: null,
      remoteStatus: 'QUEUED',
      nextRetryAt: null,
      updatedAt: new Date().toISOString(),
    });

    setDownloadSessionMeta(downloadId, {
      ...meta,
      pageUrl: fresh.requestContext.pageUrl ?? meta.pageUrl,
      requestContext: stripRequestContextSecrets(fresh.requestContext),
      detectedAt: Date.now(),
      refreshAttempted: true,
      streamType: meta.streamType ?? null,
      socialIdentity: meta.socialIdentity
        ? {
            ...meta.socialIdentity,
            contentIdentity:
              fresh.contentIdentity ?? meta.socialIdentity.contentIdentity,
            variantIdentity:
              fresh.variantIdentity ?? meta.socialIdentity.variantIdentity,
            pageUrl: fresh.requestContext.pageUrl ?? meta.socialIdentity.pageUrl,
          }
        : meta.socialIdentity,
      sessionCoherenceFingerprint: meta.sessionCoherenceFingerprint,
      coherenceCookieUrl: meta.coherenceCookieUrl,
      cookieStrategy: meta.cookieStrategy,
      accessMode: meta.accessMode,
      authRetryBudget: meta.authRetryBudget,
    });

    this.setStatusHint(downloadId, 'QUEUED');
    this.ensureScheduler().enqueue({
      id: downloadId,
      sourceUrl: fresh.sourceUrl,
      fileName: record.fileName,
      fileSize: record.expectedFileSize,
      requestContext: stripRequestContextSecrets(fresh.requestContext),
    });
    this.pump();
    return true;
  }

  /**
   * Slot is already free — schedule auto-retry outside the concurrency budget,
   * then reevaluate so unrelated queued jobs are not starved during backoff.
   */
  private async afterWorkerSettled(downloadId: string): Promise<void> {
    try {
      if (!this.suppressedIds.has(downloadId)) {
        const record = await getLocalRecord(downloadId);
        if (
          record &&
          record.remoteStatus === 'FAILED' &&
          (record.errorCode === 'AUTH_ERROR' ||
            record.errorCode === 'INVALID_RESOURCE' ||
            record.errorCode === 'FINAL_FILE_INVALID' ||
            record.errorCode === 'FINAL_SIZE_MISMATCH') &&
          (await this.tryRefreshExpiredDownload(downloadId, record))
        ) {
          return;
        }
        if (
          record &&
          record.remoteStatus === 'FAILED' &&
          shouldScheduleAutoRetry({
            retryEligible: record.retryEligible,
            retryCount: record.retryCount,
            errorCode: record.errorCode,
          })
        ) {
          this.setStatusHint(downloadId, 'FAILED');
          this.scheduleAutoRetry(downloadId);
        } else if (
          record &&
          record.remoteStatus === 'FAILED' &&
          record.retryEligible &&
          record.retryCount >= DOWNLOAD_ENGINE.maxAutoRetryAttempts &&
          record.errorCode &&
          isAutoRetryableCode(record.errorCode) &&
          record.errorCode !== 'RETRY_EXHAUSTED'
        ) {
          // Budget exhausted — stamp explicit terminal reason without wiping progress.
          const message = toUserFacingErrorMessage(
            'RETRY_EXHAUSTED',
            record.errorMessage ?? undefined,
          );
          await upsertLocalRecord({
            ...record,
            errorCode: 'RETRY_EXHAUSTED',
            errorMessage: message,
            nextRetryAt: null,
            retryEligible: true,
          });
          try {
            await syncStatusImmediate(downloadId, 'FAILED', {
              errorCode: 'RETRY_EXHAUSTED',
              errorMessage: message,
            });
          } catch {
            // ignore
          }
          this.setStatusHint(downloadId, 'FAILED');
          this.emit({
            type: 'failed',
            downloadId,
            code: 'RETRY_EXHAUSTED',
            message,
          });
        } else if (record?.remoteStatus) {
          // Never regress an intentional resume/retry that already advanced
          // past this settle. Pause settle is async: afterWorkerSettled may
          // still see PAUSED after resume() already set QUEUED — that stale
          // hint makes enqueue() reject with RESUME_FAILED.
          const currentHint = this.statusHints.get(downloadId);
          const stalePauseOverAdvanced =
            record.remoteStatus === 'PAUSED' &&
            (currentHint === 'QUEUED' ||
              currentHint === 'DOWNLOADING' ||
              currentHint === 'COMPLETED' ||
              currentHint === 'CANCELLED');
          if (!stalePauseOverAdvanced) {
            this.setStatusHint(downloadId, record.remoteStatus);
          }
        }
      }
    } catch {
      // never block drain
    }
    this.pump();
  }

  private publishSnapshot(snapshot: TransferProgressSnapshot): void {
    if (this.suppressedIds.has(snapshot.downloadId)) {
      return;
    }
    const hint = this.statusHints.get(snapshot.downloadId);
    if (
      hint === 'PAUSED' &&
      snapshot.localState === 'transferring' &&
      snapshot.bytesWritten > 0
    ) {
      return;
    }
    if (hint === 'CANCELLED') {
      return;
    }
    this.reconcileExecutionFromProgress(snapshot);
    const exec = this.executionById.get(snapshot.downloadId);
    const previous = this.snapshots.get(snapshot.downloadId);
    // Live progress must not regress from stale native callbacks.
    const progress =
      previous &&
      snapshot.localState === 'transferring' &&
      previous.localState === 'transferring'
        ? Math.max(previous.progress, snapshot.progress)
        : snapshot.progress;

    const next: TransferProgressSnapshot = {
      ...snapshot,
      progress: Math.max(0, Math.min(100, progress)),
      bytesWritten: Math.max(0, snapshot.bytesWritten),
      executionState: exec?.state ?? snapshot.executionState ?? null,
      generation: snapshot.generation ?? exec?.generation,
      attemptStartBytes:
        snapshot.attemptStartBytes ?? exec?.attemptStartBytes ?? 0,
      workerState:
        snapshot.workerState ??
        (exec ? workerStateForExecutionState(exec.state) : null),
    };
    this.snapshots.set(snapshot.downloadId, next);
    for (const listener of this.progressListeners) {
      try {
        listener(next);
      } catch {
        // never throw into engine
      }
    }
  }

  private emit(event: EngineEvent): void {
    if (
      'downloadId' in event &&
      this.suppressedIds.has(event.downloadId) &&
      event.type !== 'cancelled' &&
      event.type !== 'status'
    ) {
      // Allow cancelled/status terminal emits from cancel(); drop completed/failed/progress.
      if (event.type === 'completed' || event.type === 'failed') {
        return;
      }
    }
    if (
      event.type === 'completed' &&
      this.suppressedIds.has(event.downloadId)
    ) {
      return;
    }
    if (
      event.type === 'status' &&
      this.suppressedIds.has(event.downloadId) &&
      event.status !== 'CANCELLED'
    ) {
      return;
    }

    if (event.type === 'completed') {
      this.applyExecutionTransition(
        event.downloadId,
        'COMPLETED',
        'finalization_success',
        { progress: 100 },
      );
      this.executionById.delete(event.downloadId);
      clearDownloadSessionMeta(event.downloadId);
      logSessionDownload('context_destroyed', {
        downloadId: event.downloadId,
        reason: 'completed',
      });
    } else if (event.type === 'failed') {
      this.applyExecutionTransition(event.downloadId, 'FAILED', 'worker_error');
      clearDownloadSessionMeta(event.downloadId);
      logSessionDownload('context_destroyed', {
        downloadId: event.downloadId,
        reason: 'failed',
      });
    } else if (event.type === 'cancelled') {
      this.applyExecutionTransition(event.downloadId, 'CANCELLED', 'user_cancel');
      this.executionById.delete(event.downloadId);
      clearDownloadSessionMeta(event.downloadId);
    } else if (event.type === 'status' && event.executionState) {
      const snapshot = this.executionById.get(event.downloadId);
      if (snapshot && snapshot.state !== event.executionState) {
        this.applyExecutionTransition(
          event.downloadId,
          event.executionState,
          'recovery',
          {
            generation: snapshot.generation,
          },
        );
      }
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // never throw into engine
      }
    }
  }
}

export const downloadEngine = new DownloadEngine();
