/**
 * Global network worker budget for multi-range HTTP requests.
 * Separate from queue concurrency (active downloads).
 */

import { MULTI_RANGE } from './constants';

type Lease = {
  downloadId: string;
  count: number;
};

/**
 * Fair, deterministic allocator for simultaneous Range requests.
 */
export class GlobalNetworkBudget {
  private readonly leases = new Map<string, number>();
  private readonly waiters: Array<{
    downloadId: string;
    resolve: (granted: number) => void;
    reject: (error: Error) => void;
    wanted: number;
  }> = [];
  private readonly maxWorkers: number;

  constructor(maxWorkers = MULTI_RANGE.maxGlobalNetworkWorkers) {
    this.maxWorkers = Math.max(1, Math.trunc(maxWorkers));
  }

  get activeCount(): number {
    let total = 0;
    for (const n of this.leases.values()) {
      total += n;
    }
    return total;
  }

  getAvailable(): number {
    return Math.max(0, this.maxWorkers - this.activeCount);
  }

  getLease(downloadId: string): number {
    return this.leases.get(downloadId) ?? 0;
  }

  /**
   * Fair share: floor(max / activeJobs) with leftovers for earlier ids.
   * Never grants more than `wanted` or available slots.
   */
  recommendFairShare(downloadId: string, wanted: number, activeJobIds: string[]): number {
    const jobs = activeJobIds.length > 0 ? activeJobIds : [downloadId];
    const unique = [...new Set(jobs)];
    if (!unique.includes(downloadId)) {
      unique.push(downloadId);
    }
    unique.sort();
    const perJob = Math.max(1, Math.floor(this.maxWorkers / unique.length));
    const leftover = this.maxWorkers - perJob * unique.length;
    const index = unique.indexOf(downloadId);
    const fair = perJob + (index >= 0 && index < leftover ? 1 : 0);
    return Math.max(0, Math.min(wanted, fair, this.getAvailable() + this.getLease(downloadId)));
  }

  /**
   * Acquire up to `wanted` slots. Returns granted count (may be 0 if none free).
   * Non-blocking — coordinator retries when slots free.
   */
  tryAcquire(downloadId: string, wanted: number): number {
    const need = Math.max(0, Math.trunc(wanted));
    if (need <= 0) {
      return 0;
    }
    const available = this.getAvailable();
    const grant = Math.min(need, available);
    if (grant <= 0) {
      return 0;
    }
    this.leases.set(downloadId, this.getLease(downloadId) + grant);
    return grant;
  }

  release(downloadId: string, count = 1): void {
    const n = Math.max(0, Math.trunc(count));
    if (n <= 0) {
      return;
    }
    const current = this.getLease(downloadId);
    const next = current - n;
    if (next <= 0) {
      this.leases.delete(downloadId);
    } else {
      this.leases.set(downloadId, next);
    }
    this.drainWaiters();
  }

  releaseAll(downloadId: string): void {
    const current = this.getLease(downloadId);
    if (current > 0) {
      this.leases.delete(downloadId);
      this.drainWaiters();
    }
  }

  /**
   * Wait until at least one slot can be granted (or abort).
   */
  async acquireAtLeastOne(
    downloadId: string,
    wanted: number,
    signal: AbortSignal,
  ): Promise<number> {
    const immediate = this.tryAcquire(downloadId, Math.max(1, wanted));
    if (immediate > 0) {
      return immediate;
    }

    return new Promise<number>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      const entry = {
        downloadId,
        wanted: Math.max(1, Math.trunc(wanted)),
        resolve,
        reject,
      };
      this.waiters.push(entry);
      const onAbort = () => {
        const idx = this.waiters.indexOf(entry);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
        }
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private drainWaiters(): void {
    while (this.waiters.length > 0 && this.getAvailable() > 0) {
      const next = this.waiters.shift();
      if (!next) {
        break;
      }
      const granted = this.tryAcquire(next.downloadId, next.wanted);
      if (granted > 0) {
        next.resolve(granted);
      } else {
        this.waiters.unshift(next);
        break;
      }
    }
  }

  /** Test / reset hook. */
  resetForTests(): void {
    this.leases.clear();
    while (this.waiters.length > 0) {
      const w = this.waiters.shift();
      w?.reject(new Error('reset'));
    }
  }

  snapshot(): { active: number; max: number; leases: Lease[] } {
    return {
      active: this.activeCount,
      max: this.maxWorkers,
      leases: [...this.leases.entries()].map(([downloadId, count]) => ({
        downloadId,
        count,
      })),
    };
  }
}

let sharedBudget: GlobalNetworkBudget | null = null;

export function getGlobalNetworkBudget(): GlobalNetworkBudget {
  if (!sharedBudget) {
    sharedBudget = new GlobalNetworkBudget();
  }
  return sharedBudget;
}

export function setGlobalNetworkBudgetForTests(
  budget: GlobalNetworkBudget | null,
): void {
  sharedBudget = budget;
}
