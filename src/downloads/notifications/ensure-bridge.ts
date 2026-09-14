/**
 * One-time wiring: engine events → optional notifications + FGS summary.
 * Attaches once for app lifetime. Never starts workers.
 * Notifications observe engine state — never control the downloader.
 */

import { downloadEngine } from '@/downloads/engine';
import { useDownloadsStore } from '@/store/downloads';
import {
  sanitizeNotificationTitle,
} from './aggregate-progress';
import {
  setNotificationExistsProbe,
} from './deep-link';
import { createFgsSummaryPublisher, type FgsSummaryPublisher } from './fgs-summary';
import { getDownloadNotificationService } from './service';
import { getBackgroundExecutionController } from '../execution/platform-controller';
import { getDownloadExecutionCoordinator } from '../execution/coordinator';
import type { FgsNotificationSummary } from './types';

let attached = false;
let publisher: FgsSummaryPublisher | null = null;
let unsubEngine: (() => void) | null = null;
let unsubProgress: (() => void) | null = null;
let unsubQueue: (() => void) | null = null;

function resolveTitle(downloadId: string): string {
  const item = useDownloadsStore.getState().itemsById[downloadId];
  return sanitizeNotificationTitle(item?.title, item?.fileName);
}

function presentFromStore(downloadId: string, force = false): void {
  const store = useDownloadsStore.getState();
  const item = store.itemsById[downloadId];
  const transfer = store.transferById[downloadId];
  if (!item) {
    return;
  }
  const notifications = getDownloadNotificationService();
  // Prefer execution-layer state for active transfers (STARTING / WAITING_FOR_WIFI /
  // FINALIZING / RETRYING). Terminal catalog statuses remain authoritative.
  const executionState =
    typeof transfer?.executionState === 'string' ? transfer.executionState : null;
  const statusForNotification =
    item.status === 'COMPLETED' ||
    item.status === 'FAILED' ||
    item.status === 'CANCELLED' ||
    item.status === 'PAUSED'
      ? item.status
      : executionState ?? item.status;

  void notifications.presentLifecycle({
    downloadId,
    status: statusForNotification,
    title: sanitizeNotificationTitle(item.title, item.fileName),
    progressPercent: transfer?.progress ?? item.progress ?? null,
    totalBytes:
      transfer?.totalBytes != null && transfer.totalBytes > 0
        ? transfer.totalBytes
        : Number(item.fileSize) > 0
          ? Number(item.fileSize)
          : null,
    force,
  });
}

export function ensureDownloadNotificationBridge(): void {
  if (attached) {
    return;
  }
  attached = true;

  const notifications = getDownloadNotificationService();
  void notifications.initialize();

  setNotificationExistsProbe((downloadId) => {
    const local = useDownloadsStore.getState().itemsById[downloadId];
    return Boolean(local);
  });

  const controller = getBackgroundExecutionController();

  publisher = createFgsSummaryPublisher({
    updateSummary: async (summary: FgsNotificationSummary) => {
      const extended = controller as {
        updateNotificationSummary?: (
          s: FgsNotificationSummary,
        ) => Promise<void>;
      };
      if (typeof extended.updateNotificationSummary === 'function') {
        await extended.updateNotificationSummary(summary);
      }
    },
    getActiveJobs: () => {
      const ledger = getDownloadExecutionCoordinator().getLedgerSnapshot();
      const store = useDownloadsStore.getState();
      return ledger.protectedDownloadIds.map((id) => {
        const item = store.itemsById[id];
        const transfer = store.transferById[id];
        return {
          downloadId: id,
          title: item?.title ?? null,
          fileName: item?.fileName ?? null,
          bytesDownloaded: transfer?.bytesWritten ?? 0,
          totalBytes:
            transfer?.totalBytes != null && transfer.totalBytes > 0
              ? transfer.totalBytes
              : null,
          progressPercent: transfer?.progress ?? null,
        };
      });
    },
    getWaitingCount: () => {
      try {
        return downloadEngine.getQueueSnapshot().pending.length;
      } catch {
        return 0;
      }
    },
  });

  unsubEngine = downloadEngine.subscribe((event) => {
    if (event.type === 'completed') {
      const title = resolveTitle(event.downloadId);
      void notifications.notifyCompleted({
        downloadId: event.downloadId,
        title,
      });
      publisher?.onStructureChange();
      return;
    }
    if (event.type === 'failed') {
      const downloadId = event.downloadId;
      const title = resolveTitle(downloadId);
      const item = useDownloadsStore.getState().itemsById[downloadId];
      const errorCode = event.code ?? item?.errorCode ?? null;
      // Defer so afterWorkerSettled can register auto-retry before we decide.
      setTimeout(() => {
        const evidence = downloadEngine.getJobEvidence(downloadId);
        if (evidence.isRetryScheduled || evidence.isQueued) {
          presentFromStore(downloadId, true);
          return;
        }
        const current = useDownloadsStore.getState().itemsById[downloadId];
        const status = current?.status;
        // Auto-retry / still-active catalog states must not emit FAILED terminal.
        if (
          status === 'CANCELLED' ||
          status === 'COMPLETED' ||
          status === 'QUEUED' ||
          status === 'DOWNLOADING' ||
          status === 'PAUSED'
        ) {
          if (
            status === 'QUEUED' ||
            status === 'DOWNLOADING' ||
            status === 'PAUSED'
          ) {
            presentFromStore(downloadId, true);
          }
          return;
        }
        void notifications.notifyFailed({ downloadId, title, errorCode });
      }, 80);
      publisher?.onStructureChange();
      return;
    }
    if (event.type === 'cancelled' || event.type === 'removed') {
      void notifications.dismissActive(event.downloadId);
      publisher?.onStructureChange();
      return;
    }
    if (event.type === 'status') {
      presentFromStore(event.downloadId, true);
      publisher?.onStructureChange();
    }
  });

  unsubProgress = downloadEngine.subscribeProgress((snapshot) => {
    const downloadId = snapshot.downloadId;
    if (!downloadId) {
      publisher?.onProgress();
      return;
    }
    presentFromStore(downloadId, false);
    publisher?.onProgress();
  });

  unsubQueue = downloadEngine.subscribeQueue(() => {
    publisher?.onStructureChange();
  });
}

/** Test helper. */
export function resetDownloadNotificationBridgeForTests(): void {
  unsubEngine?.();
  unsubProgress?.();
  unsubQueue?.();
  unsubEngine = null;
  unsubProgress = null;
  unsubQueue = null;
  publisher?.cancel();
  publisher = null;
  attached = false;
}
