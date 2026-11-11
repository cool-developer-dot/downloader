/**
 * Queue screen controller — observes the v1 scheduler snapshot and the v2 engine's own queued and running downloads
 * (fix/queue-v2); never starts workers.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { downloadEngine } from '@/downloads/engine';
import {
  formatQueueWaitingReason,
  type QueueSnapshot,
} from '@/downloads/scheduler';
import { ensureV2QueueRecords, useV2QueueRecords } from '@/downloads/v2/queue-records-store';
import { combineQueueSnapshots, v2QueueView } from '@/downloads/v2/queue-view';
import { downloadDetailsPath, navigation } from '@/navigation';
import { useDownloadsStore } from '@/store/downloads';
import { selectWifiOnly, useSettingsStore } from '@/store/settings';

const EMPTY_SNAPSHOT: QueueSnapshot = {
  active: [],
  pending: [],
  policy: { maxConcurrentDownloads: 2, wifiOnly: false },
  network: { connected: true, internetReachable: null, type: 'unknown' },
};

export function useQueueScreen() {
  const [snapshot, setSnapshot] = useState<QueueSnapshot>(() => {
    try {
      return downloadEngine.getQueueSnapshot();
    } catch {
      return EMPTY_SNAPSHOT;
    }
  });

  const cancel = useDownloadsStore((s) => s.cancel);
  const pause = useDownloadsStore((s) => s.pause);
  const resume = useDownloadsStore((s) => s.resume);
  const mutatingIds = useDownloadsStore((s) => s.mutatingIds);

  useEffect(() => {
    return downloadEngine.subscribeQueue((next) => {
      setSnapshot(next);
    });
  }, []);

  // The v2 engine's downloads: their state changes move them between the lists; their rows show live progress.
  useEffect(() => {
    ensureV2QueueRecords();
  }, []);
  const v2Records = useV2QueueRecords((s) => s.byId);
  const wifiOnly = useSettingsStore(selectWifiOnly);
  const combined = useMemo(
    () => combineQueueSnapshots(snapshot, v2QueueView(Object.values(v2Records), { wifiOnly })),
    [snapshot, v2Records, wifiOnly],
  );

  const openDetails = useCallback((id: string) => {
    navigation.push(downloadDetailsPath(id));
  }, []);

  const onCancel = useCallback(
    async (id: string) => {
      await cancel(id);
    },
    [cancel],
  );

  const onPause = useCallback(
    async (id: string) => {
      await pause(id);
    },
    [pause],
  );

  const onResume = useCallback(
    async (id: string) => {
      await resume(id);
    },
    [resume],
  );

  return {
    snapshot: combined,
    mutatingIds,
    formatWaitingReason: formatQueueWaitingReason,
    openDetails,
    onCancel,
    onPause,
    onResume,
  };
}
