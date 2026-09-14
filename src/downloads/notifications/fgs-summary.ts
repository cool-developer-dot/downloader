/**
 * Publishes throttled FGS notification summaries from JS execution state.
 * Bridge only — native builds the actual ongoing notification.
 */

import {
  computeAggregateProgress,
  sanitizeNotificationTitle,
} from './aggregate-progress';
import { createThrottleController } from './throttle-controller';
import {
  FGS_SUMMARY_THROTTLE_MS,
  type FgsNotificationSummary,
} from './types';

export type FgsSummaryJobInput = {
  downloadId: string;
  title?: string | null;
  fileName?: string | null;
  bytesDownloaded: number;
  totalBytes: number | null;
  progressPercent: number | null;
};

export type FgsSummaryPublisherDeps = {
  updateSummary: (summary: FgsNotificationSummary) => void | Promise<void>;
  getActiveJobs: () => FgsSummaryJobInput[];
  getWaitingCount: () => number;
  throttleMs?: number;
};

export class FgsSummaryPublisher {
  private readonly throttle;
  private lastForcedKey = '';

  constructor(private readonly deps: FgsSummaryPublisherDeps) {
    this.throttle = createThrottleController<FgsNotificationSummary>({
      intervalMs: deps.throttleMs ?? FGS_SUMMARY_THROTTLE_MS,
      onEmit: (summary) => {
        void Promise.resolve(deps.updateSummary(summary));
      },
    });
  }

  /** Call on progress ticks — throttled. */
  onProgress(): void {
    this.throttle.schedule(this.buildSummary());
  }

  /** Call on active/waiting count or ownership changes — flush immediately. */
  onStructureChange(): void {
    const summary = this.buildSummary();
    const key = `${summary.activeCount}:${summary.waitingCount}:${summary.title ?? ''}`;
    if (key !== this.lastForcedKey || summary.activeCount === 0) {
      this.lastForcedKey = key;
      this.throttle.flush(summary);
    } else {
      this.throttle.schedule(summary);
    }
  }

  getEmitCount(): number {
    return this.throttle.getEmitCount();
  }

  cancel(): void {
    this.throttle.cancel();
  }

  buildSummary(): FgsNotificationSummary {
    const jobs = this.deps.getActiveJobs();
    const waitingCount = Math.max(0, this.deps.getWaitingCount());
    const aggregate = computeAggregateProgress(
      jobs.map((job) => ({
        bytesDownloaded: job.bytesDownloaded,
        totalBytes: job.totalBytes,
        progressPercent: job.progressPercent,
      })),
    );

    let title: string | null = null;
    if (jobs.length === 1) {
      title = sanitizeNotificationTitle(jobs[0]!.title, jobs[0]!.fileName);
    }

    return {
      activeCount: jobs.length,
      waitingCount,
      title,
      progressPercent: aggregate.progressPercent,
      bytesDownloaded: aggregate.bytesDownloaded,
      totalBytes: aggregate.totalBytes,
      indeterminate: aggregate.indeterminate || jobs.length === 0,
    };
  }
}

export function createFgsSummaryPublisher(
  deps: FgsSummaryPublisherDeps,
): FgsSummaryPublisher {
  return new FgsSummaryPublisher(deps);
}
