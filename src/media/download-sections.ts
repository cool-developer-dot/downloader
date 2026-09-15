import type { DownloadRecord, DownloadState } from '@modules/vidorax-media/src/VidoraMedia.types';

export type DownloadSectionKey = 'active' | 'queued' | 'failed' | 'completed';

export interface DownloadOverview {
  /** Record ids per section, in display order. Cancelled records are not shown. */
  sections: Record<DownloadSectionKey, string[]>;
  /** Downloads that still have work to do (not completed, failed or cancelled). */
  unfinishedCount: number;
  canPauseAll: boolean;
  canResumeAll: boolean;
}

const SECTION_OF: Record<DownloadState, DownloadSectionKey | null> = {
  probing: 'active',
  downloading: 'active',
  processing: 'active',
  paused: 'active',
  waiting_network: 'active',
  waiting_retry: 'active',
  queued: 'queued',
  failed: 'failed',
  completed: 'completed',
  cancelled: null,
};

// Processing (mux, thumbnail, gallery export) runs to completion and cannot be paused.
const PAUSABLE_STATES: ReadonlySet<DownloadState> = new Set([
  'queued',
  'probing',
  'downloading',
  'waiting_network',
  'waiting_retry',
]);

export function canPause(state: DownloadState): boolean {
  return PAUSABLE_STATES.has(state);
}

export function canResume(state: DownloadState): boolean {
  return state === 'paused';
}

export function isUnfinished(state: DownloadState): boolean {
  return state !== 'completed' && state !== 'failed' && state !== 'cancelled';
}

const oldestCreatedFirst = (a: DownloadRecord, b: DownloadRecord) => a.createdAt - b.createdAt;
const latestUpdatedFirst = (a: DownloadRecord, b: DownloadRecord) => b.updatedAt - a.updatedAt;

export function summarizeDownloads(records: readonly DownloadRecord[]): DownloadOverview {
  const buckets: Record<DownloadSectionKey, DownloadRecord[]> = {
    active: [],
    queued: [],
    failed: [],
    completed: [],
  };
  let unfinishedCount = 0;
  let canPauseAll = false;
  let canResumeAll = false;

  for (const record of records) {
    const section = SECTION_OF[record.state];
    if (section) {
      buckets[section].push(record);
    }
    unfinishedCount += isUnfinished(record.state) ? 1 : 0;
    canPauseAll ||= canPause(record.state);
    canResumeAll ||= canResume(record.state);
  }

  const ids = (list: DownloadRecord[]) => list.map((record) => record.id);
  return {
    sections: {
      // In-progress and queued work keeps queue order; finished work shows the latest first.
      active: ids(buckets.active.sort(oldestCreatedFirst)),
      queued: ids(buckets.queued.sort(oldestCreatedFirst)),
      failed: ids(buckets.failed.sort(latestUpdatedFirst)),
      completed: ids(buckets.completed.sort(latestUpdatedFirst)),
    },
    unfinishedCount,
    canPauseAll,
    canResumeAll,
  };
}
