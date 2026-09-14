/**
 * Queue screen controller — observes scheduler snapshot; never starts workers.
 */

import { useCallback, useEffect, useState } from 'react';

import { downloadEngine } from '@/downloads/engine';
import {
  formatQueueWaitingReason,
  type QueueSnapshot,
} from '@/downloads/scheduler';
import { downloadDetailsPath, navigation } from '@/navigation';
import { useDownloadsStore } from '@/store/downloads';

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
    snapshot,
    mutatingIds,
    formatWaitingReason: formatQueueWaitingReason,
    openDetails,
    onCancel,
    onPause,
    onResume,
  };
}
