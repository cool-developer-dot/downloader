import type { BackgroundExecutionController } from './background-execution-controller';
import { EMPTY_BACKGROUND_SNAPSHOT } from './background-execution-controller';
import type { BackgroundExecutionSnapshot } from './types';

/**
 * Safe no-op for iOS / web / tests without native bridge.
 * JS transfer proceeds without FGS protection.
 */
export function createNoopBackgroundExecutionController(): BackgroundExecutionController {
  let last: BackgroundExecutionSnapshot = {
    ...EMPTY_BACKGROUND_SNAPSHOT,
    executionMode: 'UNAVAILABLE',
  };

  return {
    async ensureRunning() {
      return { ok: true };
    },

    async updateActiveJobs(downloadIds) {
      const ids = uniqueIds(downloadIds);
      // UNAVAILABLE platforms never run a real FGS — never report running.
      last = {
        running: false,
        activeDownloadIds: ids,
        serviceStartedAt: null,
        executionMode: 'UNAVAILABLE',
      };
      return { ...last, activeDownloadIds: [...last.activeDownloadIds] };
    },

    async stopIfIdle() {
      last = {
        running: false,
        activeDownloadIds: [],
        serviceStartedAt: null,
        executionMode: 'UNAVAILABLE',
      };
      return { ...last, activeDownloadIds: [...last.activeDownloadIds] };
    },

    async getSnapshot() {
      return { ...last, activeDownloadIds: [...last.activeDownloadIds] };
    },

    async updateNotificationSummary() {
      // no-op — no FGS on this platform
    },

    subscribe() {
      return () => undefined;
    },
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  const set = new Set<string>();
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0) {
      set.add(id);
    }
  }
  return [...set].sort();
}
