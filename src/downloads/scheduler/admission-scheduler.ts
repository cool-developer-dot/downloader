/**
 * Pure admission scheduler — single source of "can this download start now?".
 * Engine manager owns real workers; this owns eligibility, FIFO, capacity, and drain serialization.
 *
 * Testable without React Native / NetInfo.
 */

import {
  logSchedulerDecision,
  logSchedulerDrain,
} from '../engine/audit-diagnostics.service';
import type { DownloadNetworkState } from '../network/types';
import { DEFAULT_DOWNLOAD_NETWORK_STATE } from '../network/types';
import type { AdmissionResult } from './admission-result';
import { normalizeAdmissionResult } from './admission-result';
import { evaluateNetworkAdmission, resolvePendingWaitingReason } from './network-policy';
import type { QueueWaitingReason } from './waiting-reason';

export type SchedulerDrainReason =
  | 'create'
  | 'completion'
  | 'network_change'
  | 'resume'
  | 'retry'
  | 'settings_change'
  | 'cancel'
  | 'release'
  | 'reevaluate'
  | 'recovery';

export type SchedulerPolicy = {
  maxConcurrentDownloads: number;
  wifiOnly: boolean;
};

export type SchedulerJobInput = {
  id: string;
  sourceUrl: string;
  fileName: string;
  fileSize: string;
  title?: string;
  /** Verified analyze transport — prefer over URL heuristics for HLS routing. */
  streamType?: 'HLS' | 'PROGRESSIVE' | 'AUDIO' | 'DASH' | null;
  requestContext?: import('@/downloads/types/request-context').MediaRequestContext | null;
};

export type JobStatusProbe = {
  /** Customer-facing status if known. */
  status: 'QUEUED' | 'DOWNLOADING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  /** True when an auto-retry timer owns this id (not an active transfer slot). */
  retryDelay?: boolean;
  /** True while recovery is still preparing the job. */
  recoveryPending?: boolean;
};

export type QueueActiveItem = {
  downloadId: string;
};

export type QueuePendingItem = {
  downloadId: string;
  position: number;
  waitingReason: QueueWaitingReason;
};

export type QueueSnapshot = {
  active: QueueActiveItem[];
  pending: QueuePendingItem[];
  policy: SchedulerPolicy;
  network: DownloadNetworkState;
};

export type AdmissionSchedulerHooks = {
  /** Optional status probe for terminal / failed protection. */
  probeJob?: (downloadId: string) => JobStatusProbe | null;
  /**
   * Called when a job is admitted. Must register ownership quickly and return.
   * Must NOT await the full transfer.
   */
  onAdmit: (
    job: SchedulerJobInput,
  ) => AdmissionResult | boolean | Promise<AdmissionResult | boolean>;
};

type PendingEntry = SchedulerJobInput & { enqueuedAt: number };

const DEFAULT_POLICY: SchedulerPolicy = {
  maxConcurrentDownloads: 2,
  wifiOnly: false,
};

export class AdmissionScheduler {
  private readonly pending: PendingEntry[] = [];
  private readonly activeIds = new Set<string>();
  private readonly startingIds = new Set<string>();
  private readonly waitingReasons = new Map<string, QueueWaitingReason>();
  private readonly listeners = new Set<(snapshot: QueueSnapshot) => void>();

  private policy: SchedulerPolicy = { ...DEFAULT_POLICY };
  private network: DownloadNetworkState = { ...DEFAULT_DOWNLOAD_NETWORK_STATE };

  private drainRunning = false;
  private drainAgain = false;
  private disposed = false;
  private lastDrainReason: SchedulerDrainReason = 'reevaluate';

  private lastEmittedKey = '';

  constructor(private readonly hooks: AdmissionSchedulerHooks) {}

  getPolicy(): SchedulerPolicy {
    return { ...this.policy };
  }

  getNetwork(): DownloadNetworkState {
    return { ...this.network };
  }

  getPendingCount(): number {
    return this.pending.length;
  }

  getStartingCount(): number {
    return this.startingIds.size;
  }

  getActiveWorkerCount(): number {
    return this.activeIds.size;
  }

  setPolicy(patch: Partial<SchedulerPolicy>): void {
    const next: SchedulerPolicy = {
      maxConcurrentDownloads:
        typeof patch.maxConcurrentDownloads === 'number' &&
        Number.isInteger(patch.maxConcurrentDownloads) &&
        patch.maxConcurrentDownloads >= 1 &&
        patch.maxConcurrentDownloads <= 4
          ? patch.maxConcurrentDownloads
          : this.policy.maxConcurrentDownloads,
      wifiOnly:
        typeof patch.wifiOnly === 'boolean'
          ? patch.wifiOnly
          : this.policy.wifiOnly,
    };
    const changed =
      next.maxConcurrentDownloads !== this.policy.maxConcurrentDownloads ||
      next.wifiOnly !== this.policy.wifiOnly;
    this.policy = next;
    if (changed) {
      this.refreshWaitingReasons();
      this.emitSnapshot();
      this.requestDrain('settings_change');
    }
  }

  setNetwork(state: DownloadNetworkState): void {
    const changed =
      state.connected !== this.network.connected ||
      state.internetReachable !== this.network.internetReachable ||
      state.type !== this.network.type;
    this.network = { ...state };
    if (changed) {
      this.refreshWaitingReasons();
      this.emitSnapshot();
      this.requestDrain('network_change');
    }
  }

  /**
   * Enqueue for admission. INV: at most one pending entry per id.
   * No-op if already pending, starting, or active.
   */
  enqueue(job: SchedulerJobInput): boolean {
    if (this.disposed) {
      return false;
    }
    if (
      this.activeIds.has(job.id) ||
      this.startingIds.has(job.id) ||
      this.pending.some((item) => item.id === job.id)
    ) {
      return false;
    }

    const probe = this.hooks.probeJob?.(job.id) ?? null;
    if (
      probe?.status === 'COMPLETED' ||
      probe?.status === 'CANCELLED' ||
      probe?.status === 'PAUSED'
    ) {
      return false;
    }
    if (probe?.status === 'FAILED') {
      // FAILED may only enter via legal retry that already moved status to QUEUED.
      return false;
    }

    this.pending.push({ ...job, enqueuedAt: Date.now() });
    this.refreshWaitingReasons();
    this.emitSnapshot();
    this.requestDrain('create');
    return true;
  }

  /** Remove from pending only (queued cancel). */
  cancelPending(downloadId: string): boolean {
    const index = this.pending.findIndex((item) => item.id === downloadId);
    if (index < 0) {
      return false;
    }
    this.pending.splice(index, 1);
    this.waitingReasons.delete(downloadId);
    this.emitSnapshot();
    this.requestDrain('cancel');
    return true;
  }

  has(downloadId: string): boolean {
    return (
      this.activeIds.has(downloadId) ||
      this.startingIds.has(downloadId) ||
      this.pending.some((item) => item.id === downloadId)
    );
  }

  isActive(downloadId: string): boolean {
    return this.activeIds.has(downloadId) || this.startingIds.has(downloadId);
  }

  isPending(downloadId: string): boolean {
    return this.pending.some((item) => item.id === downloadId);
  }

  getActiveCount(): number {
    return this.activeIds.size + this.startingIds.size;
  }

  /**
   * Release active/starting ownership after worker settles or failed admit.
   */
  release(downloadId: string, releaseReason = 'worker_settled'): void {
    const wasActive = this.activeIds.delete(downloadId);
    const wasStarting = this.startingIds.delete(downloadId);
    if (wasActive || wasStarting) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        logSchedulerDecision({
          downloadId,
          decision: 'REMOVE',
          reason: releaseReason,
          schedulerActiveCount: this.getActiveCount(),
          schedulerLimit: this.policy.maxConcurrentDownloads,
        });
      }
      this.refreshWaitingReasons();
      this.emitSnapshot();
      this.requestDrain('release');
    }
  }

  /** Mark id as starting/active without pending (resume / recovery handoff). */
  markOwned(downloadId: string): void {
    this.startingIds.delete(downloadId);
    this.activeIds.add(downloadId);
    const index = this.pending.findIndex((item) => item.id === downloadId);
    if (index >= 0) {
      this.pending.splice(index, 1);
    }
    this.waitingReasons.delete(downloadId);
    this.emitSnapshot();
  }

  requestDrain(reason: SchedulerDrainReason = 'reevaluate'): void {
    if (this.disposed) {
      return;
    }
    this.lastDrainReason = reason;
    if (this.drainRunning) {
      this.drainAgain = true;
      return;
    }
    void this.runDrain();
  }

  getSnapshot(): QueueSnapshot {
    this.refreshWaitingReasons();
    return {
      active: [...this.activeIds, ...this.startingIds].map((downloadId) => ({
        downloadId,
      })),
      pending: this.pending.map((item, index) => ({
        downloadId: item.id,
        position: index + 1,
        waitingReason: this.waitingReasons.get(item.id) ?? 'CAPACITY',
      })),
      policy: { ...this.policy },
      network: { ...this.network },
    };
  }

  subscribe(listener: (snapshot: QueueSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.pending.length = 0;
    this.activeIds.clear();
    this.startingIds.clear();
    this.waitingReasons.clear();
  }

  private async runDrain(): Promise<void> {
    this.drainRunning = true;
    try {
      do {
        this.drainAgain = false;
        this.refreshWaitingReasons();

        logSchedulerDrain({
          reason: this.lastDrainReason,
          queued: this.pending.length,
          active: this.getActiveCount(),
          limit: this.policy.maxConcurrentDownloads,
        });

        let safety = 0;
        while (
          this.getActiveCount() < this.policy.maxConcurrentDownloads &&
          safety < this.pending.length + 8
        ) {
          safety += 1;

          const network = evaluateNetworkAdmission(
            this.policy.wifiOnly,
            this.network,
          );
          if (!network.allowed) {
            if (this.pending.length > 0) {
              logSchedulerDecision({
                downloadId: this.pending[0]!.id,
                decision: 'BLOCK',
                reason: network.reason,
                schedulerActiveCount: this.getActiveCount(),
                schedulerLimit: this.policy.maxConcurrentDownloads,
              });
            }
            break;
          }

          const next = this.peekFirstEligiblePending();
          if (!next) {
            break;
          }

          this.startingIds.add(next.id);

          let result: AdmissionResult;
          try {
            result = normalizeAdmissionResult(
              await Promise.resolve(this.hooks.onAdmit(next)),
            );
          } catch {
            result = { outcome: 'REQUEUE', reason: 'TRANSIENT_ADMIT_FAILURE' };
          }

          this.startingIds.delete(next.id);
          this.assertInvariants(next.id);

          switch (result.outcome) {
            case 'STARTED':
              this.removePendingEntry(next.id);
              this.activeIds.add(next.id);
              this.waitingReasons.delete(next.id);
              logSchedulerDecision({
                downloadId: next.id,
                decision: 'ADMIT',
                reason: 'slot_available',
                schedulerActiveCount: this.getActiveCount(),
                schedulerLimit: this.policy.maxConcurrentDownloads,
              });
              break;

            case 'HANDOFF_REQUEUED':
              logSchedulerDecision({
                downloadId: next.id,
                decision: 'REQUEUE',
                reason: result.reason,
                schedulerActiveCount: this.getActiveCount(),
                schedulerLimit: this.policy.maxConcurrentDownloads,
              });
              this.rotatePendingToBack(next.id);
              break;

            case 'REQUEUE':
              logSchedulerDecision({
                downloadId: next.id,
                decision: 'REQUEUE',
                reason: result.reason,
                schedulerActiveCount: this.getActiveCount(),
                schedulerLimit: this.policy.maxConcurrentDownloads,
              });
              this.rotatePendingToBack(next.id);
              break;

            case 'TERMINAL':
              this.removePendingEntry(next.id);
              this.waitingReasons.delete(next.id);
              logSchedulerDecision({
                downloadId: next.id,
                decision: 'REMOVE',
                reason: result.reason,
                schedulerActiveCount: this.getActiveCount(),
                schedulerLimit: this.policy.maxConcurrentDownloads,
              });
              break;
          }

          this.emitSnapshot();
          this.assertInvariants(next.id);
        }

        this.refreshWaitingReasons();
        this.emitSnapshot();
      } while (this.drainAgain && !this.disposed);
    } finally {
      this.drainRunning = false;
      if (this.drainAgain && !this.disposed) {
        this.drainAgain = false;
        this.requestDrain(this.lastDrainReason);
      }
    }
  }

  /** Inspect FIFO head without removing — removal happens on admission outcome. */
  private peekFirstEligiblePending(): PendingEntry | null {
    for (let i = 0; i < this.pending.length; i += 1) {
      const item = this.pending[i]!;

      if (this.activeIds.has(item.id)) {
        this.removePendingEntry(item.id);
        i -= 1;
        continue;
      }
      if (this.startingIds.has(item.id)) {
        continue;
      }

      const probe = this.hooks.probeJob?.(item.id) ?? null;
      if (
        probe?.status === 'COMPLETED' ||
        probe?.status === 'CANCELLED' ||
        probe?.status === 'PAUSED' ||
        probe?.status === 'FAILED'
      ) {
        this.removePendingEntry(item.id);
        this.waitingReasons.delete(item.id);
        i -= 1;
        continue;
      }

      return item;
    }
    return null;
  }

  private removePendingEntry(downloadId: string): void {
    const index = this.pending.findIndex((item) => item.id === downloadId);
    if (index >= 0) {
      this.pending.splice(index, 1);
    }
  }

  private rotatePendingToBack(downloadId: string): void {
    const index = this.pending.findIndex((item) => item.id === downloadId);
    if (index < 0) {
      return;
    }
    const [entry] = this.pending.splice(index, 1);
    if (entry) {
      this.pending.push(entry);
    }
  }

  private refreshWaitingReasons(): void {
    const activeCount = this.getActiveCount();
    for (const item of this.pending) {
      const probe = this.hooks.probeJob?.(item.id) ?? null;
      const reason = resolvePendingWaitingReason({
        wifiOnly: this.policy.wifiOnly,
        network: this.network,
        activeCount,
        maxConcurrent: this.policy.maxConcurrentDownloads,
        retryDelay: probe?.retryDelay === true,
        recoveryPending: probe?.recoveryPending === true,
      });
      this.waitingReasons.set(item.id, reason);
    }
  }

  private assertInvariants(downloadId: string): void {
    if (typeof __DEV__ === 'undefined' || !__DEV__) {
      return;
    }
    if (this.startingIds.has(downloadId) && this.activeIds.has(downloadId)) {
      console.warn('[Scheduler] invariant: starting ∩ active', { downloadId });
    }
    const pendingDupes = this.pending.filter((item) => item.id === downloadId);
    if (pendingDupes.length > 1) {
      console.warn('[Scheduler] invariant: duplicate pending', { downloadId });
    }
    if (
      this.waitingReasons.get(downloadId) === 'WAITING_FOR_WIFI' &&
      this.activeIds.has(downloadId)
    ) {
      console.warn('[Scheduler] invariant: WAITING_FOR_WIFI cannot be active', {
        downloadId,
      });
    }
    if (this.getActiveCount() > this.policy.maxConcurrentDownloads + 1) {
      console.warn('[Scheduler] invariant: active exceeds limit unexpectedly', {
        active: this.getActiveCount(),
        limit: this.policy.maxConcurrentDownloads,
      });
    }
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot();
    const key = JSON.stringify({
      a: snapshot.active.map((item) => item.downloadId),
      p: snapshot.pending.map((item) => [
        item.downloadId,
        item.position,
        item.waitingReason,
      ]),
      pol: snapshot.policy,
      net: snapshot.network,
    });
    if (key === this.lastEmittedKey) {
      return;
    }
    this.lastEmittedKey = key;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // never break scheduler
      }
    }
  }
}
