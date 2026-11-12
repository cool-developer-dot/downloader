/**
 * A download's own speed limit and the Priority mark (F2), as the engine stores them. The Download details screen reads
 * and changes them through here; the engine persists them, so they survive restarts.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import type { DownloadBandwidth } from '@modules/vidorax-media/src/VidoraMedia.types';

import { getV2Engine } from './engine-port';
import { normalizeSpeedLimit, speedLimitForEngine, type SpeedLimitChoice } from './speed-limit';

let entries: readonly DownloadBandwidth[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly DownloadBandwidth[]): void {
  entries = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getEntries = () => entries;

export type DownloadBandwidthView = {
  /** False on a build without the engine API: the controls are not shown. */
  available: boolean;
  speedLimit: SpeedLimitChoice;
  priority: boolean;
  setSpeedLimit: (value: number) => Promise<boolean>;
  setPriority: (priority: boolean) => Promise<boolean>;
};

/** Pure: the entry for one download (none means no limit, no priority). */
export function bandwidthFor(all: readonly DownloadBandwidth[], id: string): { speedLimit: SpeedLimitChoice; priority: boolean } {
  const entry = all.find((e) => e.id === id);
  return { speedLimit: normalizeSpeedLimit(entry?.speedLimitBytesPerSecond ?? 0), priority: entry?.priority === true };
}

async function change(
  id: string,
  options: { speedLimitBytesPerSecond?: number | null; priority?: boolean },
): Promise<boolean> {
  const engine = getV2Engine();
  if (!engine?.setDownloadBandwidth) {
    return false;
  }
  try {
    publish(await engine.setDownloadBandwidth(id, options));
    return true;
  } catch {
    return false;
  }
}

export function useDownloadBandwidth(id: string): DownloadBandwidthView {
  const all = useSyncExternalStore(subscribe, getEntries, getEntries);
  const engine = getV2Engine();
  const available = typeof engine?.setDownloadBandwidth === 'function';

  useEffect(() => {
    if (!engine?.listDownloadBandwidth) {
      return;
    }
    let cancelled = false;
    engine
      .listDownloadBandwidth()
      .then((list) => {
        if (!cancelled) {
          publish(list);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [engine, id]);

  const current = bandwidthFor(all, id);
  // The engine applies both fields every time (a missing one means off), so the other is always sent as it is.
  const setSpeedLimit = useCallback(
    (value: number) => change(id, { speedLimitBytesPerSecond: speedLimitForEngine(value), priority: current.priority }),
    [current.priority, id],
  );
  const setPriority = useCallback(
    (priority: boolean) => change(id, { speedLimitBytesPerSecond: speedLimitForEngine(current.speedLimit), priority }),
    [current.speedLimit, id],
  );

  return { available, ...current, setSpeedLimit, setPriority };
}
