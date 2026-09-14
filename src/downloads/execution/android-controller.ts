import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

import type { BackgroundExecutionController } from './background-execution-controller';
import { EMPTY_BACKGROUND_SNAPSHOT } from './background-execution-controller';
import { createNoopBackgroundExecutionController } from './noop-controller';
import type {
  BackgroundExecutionError,
  BackgroundExecutionSnapshot,
} from './types';

type NativeSnapshot = {
  running?: boolean;
  activeDownloadIds?: string[];
  serviceStartedAt?: number | null;
};

type NativeModuleShape = {
  ensureRunning: () => Promise<boolean>;
  syncActiveJobs: (ids: string[]) => Promise<NativeSnapshot>;
  stopIfIdle: () => Promise<NativeSnapshot>;
  getServiceState: () => Promise<NativeSnapshot>;
  updateNotificationSummary?: (summary: {
    activeCount: number;
    waitingCount: number;
    title: string | null;
    progressPercent: number | null;
    bytesDownloaded: number | null;
    totalBytes: number | null;
    indeterminate: boolean;
  }) => Promise<boolean>;
};

const MODULE_NAME = 'VidoraXDownloadForeground';

function getNative(): NativeModuleShape | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const mod = NativeModules[MODULE_NAME] as NativeModuleShape | undefined;
  if (
    !mod ||
    typeof mod.ensureRunning !== 'function' ||
    typeof mod.syncActiveJobs !== 'function' ||
    typeof mod.stopIfIdle !== 'function' ||
    typeof mod.getServiceState !== 'function'
  ) {
    return null;
  }
  return mod;
}

function sanitizeSnapshot(raw: NativeSnapshot | null | undefined): BackgroundExecutionSnapshot {
  const ids = Array.isArray(raw?.activeDownloadIds)
    ? [
        ...new Set(
          raw.activeDownloadIds.filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
        ),
      ].sort()
    : [];
  const started =
    typeof raw?.serviceStartedAt === 'number' && Number.isFinite(raw.serviceStartedAt)
      ? raw.serviceStartedAt
      : null;
  return {
    running: Boolean(raw?.running),
    activeDownloadIds: ids,
    serviceStartedAt: started,
    executionMode: 'JS_TRANSFER_FGS',
  };
}

/**
 * Android controller — talks to VidoraXDownloadForeground native module.
 * Falls back to no-op if the module is missing (e.g. stale binary).
 */
export function createAndroidBackgroundExecutionController(): BackgroundExecutionController {
  const native = getNative();
  if (!native) {
    return createNoopBackgroundExecutionController();
  }

  const nativeModule = NativeModules[MODULE_NAME];
  const emitter = new NativeEventEmitter(nativeModule);

  return {
    async ensureRunning() {
      try {
        const ok = await native.ensureRunning();
        if (!ok) {
          return {
            ok: false,
            error: {
              code: 'FOREGROUND_SERVICE_START_FAILED',
              message: 'Foreground service could not start.',
            } satisfies BackgroundExecutionError,
          };
        }
        return { ok: true };
      } catch {
        return {
          ok: false,
          error: {
            code: 'FOREGROUND_SERVICE_START_FAILED',
            message: 'Foreground service could not start.',
          },
        };
      }
    },

    async updateActiveJobs(downloadIds) {
      try {
        const ids = [
          ...new Set(
            downloadIds.filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            ),
          ),
        ];
        const snap = await native.syncActiveJobs(ids);
        return sanitizeSnapshot(snap);
      } catch {
        return {
          ...EMPTY_BACKGROUND_SNAPSHOT,
          executionMode: 'JS_TRANSFER_FGS',
        };
      }
    },

    async stopIfIdle() {
      try {
        const snap = await native.stopIfIdle();
        return sanitizeSnapshot(snap);
      } catch {
        return {
          ...EMPTY_BACKGROUND_SNAPSHOT,
          executionMode: 'JS_TRANSFER_FGS',
        };
      }
    },

    async getSnapshot() {
      try {
        const snap = await native.getServiceState();
        return sanitizeSnapshot(snap);
      } catch {
        return {
          ...EMPTY_BACKGROUND_SNAPSHOT,
          executionMode: 'JS_TRANSFER_FGS',
        };
      }
    },

    async updateNotificationSummary(summary) {
      try {
        if (typeof native.updateNotificationSummary !== 'function') {
          return;
        }
        await native.updateNotificationSummary({
          activeCount: Math.max(0, Math.floor(summary.activeCount)),
          waitingCount: Math.max(0, Math.floor(summary.waitingCount)),
          title: summary.title,
          progressPercent: summary.progressPercent,
          bytesDownloaded: summary.bytesDownloaded,
          totalBytes: summary.totalBytes,
          indeterminate: summary.indeterminate,
        });
      } catch {
        // never crash JS on notification update
      }
    },

    subscribe(listener) {
      const subs = [
        emitter.addListener('SERVICE_STARTED', (payload: NativeSnapshot) => {
          listener({
            type: 'SERVICE_STARTED',
            snapshot: sanitizeSnapshot(payload),
          });
        }),
        emitter.addListener('SERVICE_STOPPED', (payload: NativeSnapshot) => {
          listener({
            type: 'SERVICE_STOPPED',
            snapshot: sanitizeSnapshot(payload),
          });
        }),
        emitter.addListener('ACTIVE_JOBS_CHANGED', (payload: NativeSnapshot) => {
          listener({
            type: 'ACTIVE_JOBS_CHANGED',
            snapshot: sanitizeSnapshot(payload),
          });
        }),
        emitter.addListener(
          'SERVICE_ERROR',
          (payload: NativeSnapshot & { code?: string }) => {
            listener({
              type: 'SERVICE_ERROR',
              snapshot: sanitizeSnapshot(payload),
              error: {
                code:
                  payload?.code === 'NATIVE_EXECUTION_UNAVAILABLE'
                    ? 'NATIVE_EXECUTION_UNAVAILABLE'
                    : 'BACKGROUND_EXECUTION_UNAVAILABLE',
                message: 'Background execution unavailable.',
              },
            });
          },
        ),
      ];
      return () => {
        for (const sub of subs) {
          sub.remove();
        }
      };
    },
  };
}
