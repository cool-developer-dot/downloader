// Stand-in for Faran's F14 `src/files/cleanup/`: replaced by `export * from '@/files/cleanup';` once F14 merges.
/**
 * Files F9: the only door the Storage screen uses to F14's engines, with F14's exact signatures. Until F14 lands there
 * are no engines (`filesCapabilities.duplicates` is false): no duplicate groups, an empty one-tap clean plan that frees
 * nothing, and Low space alert settings kept only while the app runs, never alerting.
 *
 * Only these six functions are exported, so the swap is one line; the screens derive their types from them.
 */

import { useSyncExternalStore } from 'react';

import type { FileEntry } from '@/files/api';

export async function findDuplicates(opts?: {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<{ hash: string; items: FileEntry[] }[]> {
  opts?.onProgress?.(0, 0);
  return [];
}

export async function planOneTapClean(): Promise<{
  cacheBytes: number;
  leftoverBytes: number;
  tempBytes: number;
  binExpiredBytes: number;
  total: number;
}> {
  return { cacheBytes: 0, leftoverBytes: 0, tempBytes: 0, binExpiredBytes: 0, total: 0 };
}

export async function runClean(plan: Awaited<ReturnType<typeof planOneTapClean>>): Promise<{ freedBytes: number }> {
  void plan;
  return { freedBytes: 0 };
}

let lowSpace = { enabled: false, thresholdBytes: 1024 * 1024 * 1024 };
const listeners = new Set<() => void>();

// 500 MB | 1 GB | 2 GB
export function getLowSpaceSettings(): { enabled: boolean; thresholdBytes: number } {
  return lowSpace;
}

export function setLowSpaceSettings(patch: Partial<{ enabled: boolean; thresholdBytes: number }>): void {
  lowSpace = { ...lowSpace, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLowSpace(): { low: boolean; freeBytes: number; thresholdBytes: number } {
  const settings = useSyncExternalStore(subscribe, getLowSpaceSettings, getLowSpaceSettings);
  return { low: false, freeBytes: 0, thresholdBytes: settings.thresholdBytes };
}
