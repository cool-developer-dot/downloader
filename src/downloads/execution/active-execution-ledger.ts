/**
 * Pure active-execution ledger for FGS lifecycle coordination.
 * Tracks provisional STARTING + ACTIVE ids so stop races cannot kill the service
 * during A-finish / B-start handoff.
 *
 * Not a scheduler. Not a transfer engine.
 */

export type LedgerSnapshot = {
  activeDownloadIds: string[];
  startingDownloadIds: string[];
  /** IDs that require foreground-service protection (active ∪ starting). */
  protectedDownloadIds: string[];
  /** Service should be running when this is > 0. */
  protectedCount: number;
};

export class ActiveExecutionLedger {
  private readonly active = new Set<string>();
  private readonly starting = new Set<string>();

  /** Begin provisional ownership before transfer/service sync. */
  beginStarting(downloadId: string): boolean {
    if (this.active.has(downloadId) || this.starting.has(downloadId)) {
      return false;
    }
    this.starting.add(downloadId);
    return true;
  }

  /** Promote STARTING → ACTIVE after successful admit / service sync. */
  promoteToActive(downloadId: string): void {
    this.starting.delete(downloadId);
    this.active.add(downloadId);
  }

  /** Release provisional STARTING without becoming active (failed start). */
  abortStarting(downloadId: string): void {
    this.starting.delete(downloadId);
  }

  /** Register already-active ownership (idempotent). */
  markActive(downloadId: string): void {
    this.starting.delete(downloadId);
    this.active.add(downloadId);
  }

  /** Settle / cancel — remove from both sets. */
  end(downloadId: string): void {
    this.active.delete(downloadId);
    this.starting.delete(downloadId);
  }

  has(downloadId: string): boolean {
    return this.active.has(downloadId) || this.starting.has(downloadId);
  }

  isActive(downloadId: string): boolean {
    return this.active.has(downloadId);
  }

  isStarting(downloadId: string): boolean {
    return this.starting.has(downloadId);
  }

  getProtectedCount(): number {
    return this.active.size + this.starting.size;
  }

  shouldServiceRun(): boolean {
    return this.getProtectedCount() > 0;
  }

  getSnapshot(): LedgerSnapshot {
    const activeDownloadIds = [...this.active].sort();
    const startingDownloadIds = [...this.starting].sort();
    const protectedSet = new Set<string>([
      ...activeDownloadIds,
      ...startingDownloadIds,
    ]);
    const protectedDownloadIds = [...protectedSet].sort();
    return {
      activeDownloadIds,
      startingDownloadIds,
      protectedDownloadIds,
      protectedCount: protectedDownloadIds.length,
    };
  }

  /** Replace active set from reconciliation (starting cleared). Idempotent. */
  replaceActive(ids: readonly string[]): void {
    this.active.clear();
    this.starting.clear();
    for (const id of ids) {
      if (id) {
        this.active.add(id);
      }
    }
  }

  clear(): void {
    this.active.clear();
    this.starting.clear();
  }
}
