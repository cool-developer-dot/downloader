import { DOWNLOAD_ENGINE } from './constants';
import type { EnqueueInput } from './types';

type QueueItem = EnqueueInput & { enqueuedAt: number };

/**
 * FIFO download queue with a policy-backed concurrency ceiling.
 * maxConcurrent is refreshed from download settings policy — not a hard-coded 2.
 */
export class DownloadQueue {
  private readonly pending: QueueItem[] = [];
  private readonly activeIds = new Set<string>();
  private maxConcurrent: number;

  constructor(maxConcurrent: number = DOWNLOAD_ENGINE.maxConcurrentDownloads) {
    this.maxConcurrent = maxConcurrent;
  }

  get size(): number {
    return this.pending.length;
  }

  get activeCount(): number {
    return this.activeIds.size;
  }

  get concurrencyLimit(): number {
    return this.maxConcurrent;
  }

  /** Day 2 scheduler foundation — live policy updates without reconstructing the queue. */
  setMaxConcurrent(value: number): void {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
      this.maxConcurrent = value;
    }
  }

  has(downloadId: string): boolean {
    return (
      this.activeIds.has(downloadId) ||
      this.pending.some((item) => item.id === downloadId)
    );
  }

  enqueue(input: EnqueueInput): boolean {
    if (this.has(input.id)) {
      return false;
    }
    this.pending.push({ ...input, enqueuedAt: Date.now() });
    return true;
  }

  /** Promote next items up to concurrency limit. */
  takeNext(): QueueItem[] {
    const available = Math.max(0, this.maxConcurrent - this.activeIds.size);
    if (available === 0 || this.pending.length === 0) {
      return [];
    }

    const taken: QueueItem[] = [];
    while (taken.length < available && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) {
        break;
      }
      if (this.activeIds.has(next.id)) {
        continue;
      }
      this.activeIds.add(next.id);
      taken.push(next);
    }
    return taken;
  }

  markActive(downloadId: string): void {
    this.activeIds.add(downloadId);
  }

  markInactive(downloadId: string): void {
    this.activeIds.delete(downloadId);
  }

  remove(downloadId: string): void {
    const index = this.pending.findIndex((item) => item.id === downloadId);
    if (index >= 0) {
      this.pending.splice(index, 1);
    }
    this.activeIds.delete(downloadId);
  }

  snapshot(): { pending: string[]; active: string[]; maxConcurrent: number } {
    return {
      pending: this.pending.map((item) => item.id),
      active: [...this.activeIds],
      maxConcurrent: this.maxConcurrent,
    };
  }
}
