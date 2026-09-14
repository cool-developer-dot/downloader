/**
 * Production-safe transfer stall + first-byte detection.
 * Fails stuck downloads instead of leaving them at 99% forever.
 */

import { DOWNLOAD_ENGINE } from './constants';
import { DownloadEngineError } from './errors';
import { logWatchdog } from './audit-diagnostics.service';
import { TRANSFER_TIMEOUTS } from './transfer-timeouts';

export type WatchdogPhase =
  | 'connect'
  | 'first_byte'
  | 'transfer'
  | 'finalizing'
  | 'hls_manifest'
  | 'hls_segment';

export type WatchdogStallInfo = {
  phase: WatchdogPhase;
  elapsedMs: number;
  bytesWritten: number;
  lastByteAt: number;
};

export type StallWatchdogOptions = {
  /** No byte progress for this long → stall (ms). */
  inactivityMs?: number;
  /** Max time in finalization phase (ms). */
  finalizationMs?: number;
  /** First-byte phase deadline (ms). */
  firstByteMs?: number;
  shouldPause?: () => boolean;
  onStall?: (info: WatchdogStallInfo) => void;
  downloadId?: string;
  /** Attempt generation — stale timers must not mutate newer attempts. */
  generation?: number;
};

function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export class StallWatchdog {
  private lastBytes = 0;
  private baselineBytes = 0;
  private lastProgressAt = monotonicNow();
  private phaseStartedAt = monotonicNow();
  private finalizingAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly inactivityMs: number;
  private readonly finalizationMs: number;
  private readonly firstByteMs: number;
  private readonly shouldPause: () => boolean;
  private readonly onStall?: (info: WatchdogStallInfo) => void;
  private readonly downloadId?: string;
  private phase: WatchdogPhase = 'transfer';
  private phaseTimeoutMs = 0;
  private boundGeneration: number | null = null;
  private startedAt = 0;
  private firstByteObserved = false;

  constructor(options?: StallWatchdogOptions) {
    this.inactivityMs =
      options?.inactivityMs ?? TRANSFER_TIMEOUTS.transferStallInactivityMs;
    this.finalizationMs =
      options?.finalizationMs ?? DOWNLOAD_ENGINE.finalizationTimeoutMs;
    this.firstByteMs =
      options?.firstByteMs ?? TRANSFER_TIMEOUTS.firstByteTimeoutMs;
    this.shouldPause = options?.shouldPause ?? (() => false);
    this.onStall = options?.onStall;
    this.downloadId = options?.downloadId;
    if (options?.generation != null) {
      this.bindGeneration(options.generation);
    }
  }

  bindGeneration(generation: number): void {
    this.boundGeneration = generation;
  }

  isStale(generation?: number): boolean {
    if (this.boundGeneration == null) {
      return false;
    }
    if (generation == null) {
      return false;
    }
    return generation !== this.boundGeneration;
  }

  start(): void {
    this.startTransferPhase();
  }

  startFirstBytePhase(options?: {
    baselineBytes?: number;
    generation?: number;
    timeoutMs?: number;
  }): void {
    this.stop();
    if (options?.generation != null) {
      this.bindGeneration(options.generation);
    }
    this.phase = 'first_byte';
    this.firstByteObserved = false;
    this.baselineBytes = Math.max(0, Math.trunc(options?.baselineBytes ?? 0));
    this.lastBytes = this.baselineBytes;
    this.phaseTimeoutMs = options?.timeoutMs ?? this.firstByteMs;
    this.startedAt = monotonicNow();
    this.phaseStartedAt = this.startedAt;
    this.lastProgressAt = this.startedAt;
    logWatchdog({
      downloadId: this.downloadId,
      generation: this.boundGeneration,
      watchdogPhase: 'first_byte',
      startedAt: this.startedAt,
      timeoutMs: this.phaseTimeoutMs,
      lastProgressAt: this.lastProgressAt,
      triggered: false,
    });
    this.timer = setInterval(
      () => this.tick(),
      DOWNLOAD_ENGINE.stallCheckIntervalMs,
    );
  }

  startTransferPhase(options?: { generation?: number }): void {
    this.stop();
    if (options?.generation != null) {
      this.bindGeneration(options.generation);
    }
    this.phase = 'transfer';
    this.firstByteObserved = true;
    this.phaseTimeoutMs = this.inactivityMs;
    this.startedAt = monotonicNow();
    this.phaseStartedAt = this.startedAt;
    this.lastProgressAt = this.startedAt;
    logWatchdog({
      downloadId: this.downloadId,
      generation: this.boundGeneration,
      watchdogPhase: 'transfer',
      startedAt: this.startedAt,
      timeoutMs: this.phaseTimeoutMs,
      lastProgressAt: this.lastProgressAt,
      triggered: false,
    });
    this.timer = setInterval(
      () => this.tick(),
      DOWNLOAD_ENGINE.stallCheckIntervalMs,
    );
  }

  startHlsManifestPhase(options?: { generation?: number; timeoutMs?: number }): void {
    this.stop();
    if (options?.generation != null) {
      this.bindGeneration(options.generation);
    }
    this.phase = 'hls_manifest';
    this.firstByteObserved = false;
    this.phaseTimeoutMs =
      options?.timeoutMs ?? TRANSFER_TIMEOUTS.hlsManifestTimeoutMs;
    this.startedAt = monotonicNow();
    this.phaseStartedAt = this.startedAt;
    this.lastProgressAt = this.startedAt;
    logWatchdog({
      downloadId: this.downloadId,
      generation: this.boundGeneration,
      watchdogPhase: 'hls_manifest',
      startedAt: this.startedAt,
      timeoutMs: this.phaseTimeoutMs,
      lastProgressAt: this.lastProgressAt,
      triggered: false,
    });
    this.timer = setInterval(
      () => this.tick(),
      DOWNLOAD_ENGINE.stallCheckIntervalMs,
    );
  }

  startHlsSegmentPhase(options?: { generation?: number; timeoutMs?: number }): void {
    if (options?.generation != null) {
      this.bindGeneration(options.generation);
    }
    this.phase = 'hls_segment';
    this.phaseTimeoutMs =
      options?.timeoutMs ?? TRANSFER_TIMEOUTS.hlsSegmentTimeoutMs;
    this.phaseStartedAt = monotonicNow();
    this.lastProgressAt = this.phaseStartedAt;
    logWatchdog({
      downloadId: this.downloadId,
      generation: this.boundGeneration,
      watchdogPhase: 'hls_segment',
      startedAt: this.phaseStartedAt,
      timeoutMs: this.phaseTimeoutMs,
      lastProgressAt: this.lastProgressAt,
      triggered: false,
    });
    if (!this.timer) {
      this.timer = setInterval(
        () => this.tick(),
        DOWNLOAD_ENGINE.stallCheckIntervalMs,
      );
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.finalizingAt = null;
    this.phase = 'transfer';
    this.firstByteObserved = false;
  }

  markFirstByteReceived(bytesWritten: number): void {
    const next = Math.max(0, Math.trunc(bytesWritten));
    if (next <= this.baselineBytes) {
      return;
    }
    if (this.firstByteObserved && this.phase === 'transfer') {
      return;
    }
    this.firstByteObserved = true;
    this.lastBytes = next;
    this.lastProgressAt = monotonicNow();
    if (this.phase === 'first_byte' || this.phase === 'hls_segment') {
      this.phase = 'transfer';
      this.phaseTimeoutMs = this.inactivityMs;
      logWatchdog({
        downloadId: this.downloadId,
        generation: this.boundGeneration,
        watchdogPhase: 'transfer',
        startedAt: monotonicNow(),
        timeoutMs: this.phaseTimeoutMs,
        lastProgressAt: this.lastProgressAt,
        triggered: false,
        bytesWritten: next,
      });
    }
  }

  noteBytes(bytesWritten: number): void {
    const next = Math.max(0, Math.trunc(bytesWritten));
    if (next > this.baselineBytes && !this.firstByteObserved) {
      this.markFirstByteReceived(next);
    }
    if (next > this.lastBytes) {
      this.lastBytes = next;
      this.lastProgressAt = monotonicNow();
    }
  }

  enterFinalizing(): void {
    this.finalizingAt = monotonicNow();
    this.phase = 'finalizing';
    logWatchdog({
      downloadId: this.downloadId,
      generation: this.boundGeneration,
      watchdogPhase: 'finalizing',
      startedAt: this.finalizingAt,
      timeoutMs: this.finalizationMs,
      lastProgressAt: this.lastProgressAt,
      triggered: false,
    });
  }

  assertHealthy(generation?: number): void {
    if (!this.timer && this.finalizingAt == null) {
      return;
    }
    if (this.isStale(generation)) {
      return;
    }
    if (this.shouldPause()) {
      return;
    }
    const now = monotonicNow();

    if (this.finalizingAt != null || this.phase === 'finalizing') {
      if (now - this.finalizingAt! > this.finalizationMs) {
        this.fireStall('finalizing', now - this.finalizingAt!);
        logWatchdog({
          downloadId: this.downloadId,
          generation: this.boundGeneration,
          watchdogPhase: 'finalizing',
          startedAt: this.finalizingAt ?? undefined,
          timeoutMs: this.finalizationMs,
          lastProgressAt: this.lastProgressAt,
          triggered: true,
          errorProduced: 'TRANSFER_INTERRUPTED',
        });
        throw new DownloadEngineError(
          'TRANSFER_INTERRUPTED',
          'Download finalization timed out.',
        );
      }
      return;
    }

    const phaseElapsed = now - this.phaseStartedAt;
    const inactivityElapsed = now - this.lastProgressAt;

    if (
      this.phase === 'first_byte' ||
      this.phase === 'connect' ||
      this.phase === 'hls_manifest'
    ) {
      if (phaseElapsed > this.phaseTimeoutMs) {
        const code =
          this.phase === 'hls_manifest'
            ? 'HLS_MANIFEST_TIMEOUT'
            : 'FIRST_BYTE_TIMEOUT';
        this.fireStall(this.phase, phaseElapsed);
        logWatchdog({
          downloadId: this.downloadId,
          generation: this.boundGeneration,
          watchdogPhase: this.phase,
          startedAt: this.phaseStartedAt,
          timeoutMs: this.phaseTimeoutMs,
          lastProgressAt: this.lastProgressAt,
          triggered: true,
          bytesWritten: this.lastBytes,
          errorProduced: code,
        });
        throw new DownloadEngineError(
          code,
          code === 'HLS_MANIFEST_TIMEOUT'
            ? 'HLS playlist request timed out.'
            : 'Download could not start. Retrying…',
        );
      }
      return;
    }

    if (this.phase === 'hls_segment') {
      if (inactivityElapsed > this.phaseTimeoutMs) {
        this.fireStall('hls_segment', inactivityElapsed);
        logWatchdog({
          downloadId: this.downloadId,
          generation: this.boundGeneration,
          watchdogPhase: 'hls_segment',
          startedAt: this.phaseStartedAt,
          timeoutMs: this.phaseTimeoutMs,
          lastProgressAt: this.lastProgressAt,
          triggered: true,
          bytesWritten: this.lastBytes,
          errorProduced: 'HLS_SEGMENT_TIMEOUT',
        });
        throw new DownloadEngineError(
          'HLS_SEGMENT_TIMEOUT',
          'HLS segment download timed out.',
        );
      }
      return;
    }

    if (inactivityElapsed > this.phaseTimeoutMs) {
      this.fireStall('transfer', inactivityElapsed);
      logWatchdog({
        downloadId: this.downloadId,
        generation: this.boundGeneration,
        watchdogPhase: 'transfer',
        startedAt: this.startedAt,
        timeoutMs: this.phaseTimeoutMs,
        lastProgressAt: this.lastProgressAt,
        triggered: true,
        bytesWritten: this.lastBytes,
        errorProduced: 'TRANSFER_STALLED',
      });
      throw new DownloadEngineError(
        'TRANSFER_STALLED',
        'Download connection was interrupted. Retrying…',
      );
    }
  }

  private fireStall(phase: WatchdogPhase, elapsedMs: number): void {
    this.onStall?.({
      phase,
      elapsedMs,
      bytesWritten: this.lastBytes,
      lastByteAt: this.lastProgressAt,
    });
  }

  private tick(): void {
    try {
      this.assertHealthy();
    } catch {
      // Thrown on next read/write — caller polls via assertHealthy in loop.
    }
  }
}
