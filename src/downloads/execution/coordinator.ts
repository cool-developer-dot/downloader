/**
 * DownloadExecutionCoordinator — sits between AdmissionScheduler admission
 * and platform FGS. Does NOT schedule, transfer bytes, or replace recovery.
 *
 * Model B: JS owns transfer; coordinator keeps one FGS alive while protected
 * executions exist and syncs download IDs (never URLs/headers) to native.
 */

import { ActiveExecutionLedger } from './active-execution-ledger';
import type { BackgroundExecutionController } from './background-execution-controller';
import type {
  BackgroundExecutionError,
  BackgroundExecutionSnapshot,
  ExecutionOwner,
} from './types';

export type BeginExecutionResult = {
  /** Always true for Model B when JS may transfer (FGS failure is non-fatal). */
  admitted: boolean;
  owner: ExecutionOwner;
  serviceOk: boolean;
  error?: BackgroundExecutionError;
  /** True when transfer may proceed without FGS (foreground-only). */
  foregroundOnly: boolean;
};

export type CoordinatorReconcileResult = {
  native: BackgroundExecutionSnapshot;
  ledger: ReturnType<ActiveExecutionLedger['getSnapshot']>;
  /** IDs native claims that JS ledger does not — suppress duplicate starts. */
  nativeOwnedIds: string[];
};

export class DownloadExecutionCoordinator {
  private readonly ledger = new ActiveExecutionLedger();
  private syncing = false;
  private syncAgain = false;
  private lastServiceError: BackgroundExecutionError | null = null;
  /** Last known native FGS running flag (sync UI). */
  private nativeRunning = false;
  private nativeExecutionMode: BackgroundExecutionSnapshot['executionMode'] =
    'UNAVAILABLE';

  constructor(private readonly controller: BackgroundExecutionController) {}

  getLedgerSnapshot() {
    return this.ledger.getSnapshot();
  }

  getLastServiceError(): BackgroundExecutionError | null {
    return this.lastServiceError;
  }

  /** Sync: real FGS running (Android). False for iOS/noop/unavailable. */
  isNativeForegroundServiceRunning(): boolean {
    return (
      this.nativeRunning && this.nativeExecutionMode === 'JS_TRANSFER_FGS'
    );
  }

  /**
   * Called when AdmissionScheduler admits a job, BEFORE worker.run.
   * Registers provisional ownership, ensures FGS, syncs registry.
   */
  async beginExecution(downloadId: string): Promise<BeginExecutionResult> {
    if (!downloadId) {
      return {
        admitted: false,
        owner: 'NONE',
        serviceOk: false,
        foregroundOnly: true,
        error: {
          code: 'NATIVE_EXECUTION_UNAVAILABLE',
          message: 'Missing download id.',
        },
      };
    }

    // Idempotent if already protected (reconciliation / duplicate admit).
    if (!this.ledger.has(downloadId)) {
      this.ledger.beginStarting(downloadId);
    }

    let serviceOk = true;
    let error: BackgroundExecutionError | undefined;
    let foregroundOnly = false;

    try {
      const ensure = await this.controller.ensureRunning();
      if (!ensure.ok) {
        serviceOk = false;
        error = ensure.error ?? {
          code: 'FOREGROUND_SERVICE_START_FAILED',
          message: 'Foreground service could not start.',
        };
        this.lastServiceError = error;
        // Model B: JS transfer may continue while app is foreground.
        foregroundOnly = true;
      } else {
        this.lastServiceError = null;
      }

      await this.flushToNative();
      this.ledger.promoteToActive(downloadId);
      await this.flushToNative();
    } catch {
      this.ledger.abortStarting(downloadId);
      this.lastServiceError = {
        code: 'BACKGROUND_EXECUTION_UNAVAILABLE',
        message: 'Background execution unavailable.',
      };
      // Still allow JS transfer in foreground — do not leave STARTING forever.
      this.ledger.markActive(downloadId);
      void this.flushToNative();
      return {
        admitted: true,
        owner: 'JS',
        serviceOk: false,
        foregroundOnly: true,
        error: this.lastServiceError,
      };
    }

    return {
      admitted: true,
      owner: 'JS',
      serviceOk,
      foregroundOnly,
      error,
    };
  }

  /**
   * Called when JS worker settles (complete / fail / pause / cancel).
   */
  async endExecution(downloadId: string): Promise<void> {
    this.ledger.end(downloadId);
    await this.flushToNative();
  }

  /** True when ledger owns this id — block duplicate JS start. */
  isExecutionOwned(downloadId: string): boolean {
    return this.ledger.has(downloadId);
  }

  getOwner(_downloadId: string): ExecutionOwner {
    if (this.ledger.has(_downloadId)) {
      return 'JS';
    }
    return 'NONE';
  }

  async getNativeSnapshot(): Promise<BackgroundExecutionSnapshot> {
    return this.controller.getSnapshot();
  }

  /**
   * Bootstrap / foreground reconciliation gate.
   * Native registry is advisory in Model B (JS owns transfer).
   */
  async reconcile(options?: {
    /** IDs that currently have a live JS worker. */
    jsActiveIds?: readonly string[];
  }): Promise<CoordinatorReconcileResult> {
    const native = await this.controller.getSnapshot();
    const jsActive = new Set(options?.jsActiveIds ?? []);

    // Align ledger with live JS workers (source of transfer truth).
    const nextActive = [...jsActive];
    this.ledger.replaceActive(nextActive);

    const nativeOwnedIds = native.activeDownloadIds.filter((id) => !jsActive.has(id));

    await this.flushToNative();

    return {
      native,
      ledger: this.ledger.getSnapshot(),
      nativeOwnedIds,
    };
  }

  private async flushToNative(): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.syncAgain = false;
        const snap = this.ledger.getSnapshot();
        let native: BackgroundExecutionSnapshot;
        if (snap.protectedCount === 0) {
          await this.controller.updateActiveJobs([]);
          native = await this.controller.stopIfIdle();
        } else {
          const ensure = await this.controller.ensureRunning();
          if (!ensure.ok) {
            this.lastServiceError = ensure.error ?? this.lastServiceError;
          } else {
            this.lastServiceError = null;
          }
          native = await this.controller.updateActiveJobs(
            snap.protectedDownloadIds,
          );
        }
        this.nativeRunning = native.running === true;
        this.nativeExecutionMode = native.executionMode;
      } while (this.syncAgain);
    } finally {
      this.syncing = false;
    }
  }
}

let singleton: DownloadExecutionCoordinator | null = null;

export function getDownloadExecutionCoordinator(): DownloadExecutionCoordinator {
  if (!singleton) {
    // Lazy require so Node verify scripts can import this module without RN.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBackgroundExecutionController } = require('./platform-controller') as {
      getBackgroundExecutionController: () => BackgroundExecutionController;
    };
    singleton = new DownloadExecutionCoordinator(getBackgroundExecutionController());
  }
  return singleton;
}

/** Test hook. */
export function setDownloadExecutionCoordinatorForTests(
  value: DownloadExecutionCoordinator | null,
): void {
  singleton = value;
}

export function createDownloadExecutionCoordinator(
  controller: BackgroundExecutionController,
): DownloadExecutionCoordinator {
  return new DownloadExecutionCoordinator(controller);
}
