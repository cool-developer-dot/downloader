/**
 * P6 #619: the play queue survives an app restart. The queue itself (`play-queue.ts`) has no storage, so it loads in
 * unit tests; this saves it in the key-value store (MMKV) on every change and reads it back once.
 *
 * Device videos (`device:` ids) play from a list kept in memory (`device-media.ts`): after a restart a saved queue
 * that has them lists the device videos again, quietly, so they can play. Nothing is asked: without the permission the
 * list is just empty.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';

import { isDeviceMediaId, listDeviceVideos } from './device-media';
import { readStoredPlayQueue, toStoredPlayQueue, usePlayQueueStore } from './play-queue';

let started = false;

/** Reads the saved queue (when nothing has set one yet) and keeps saving it. Safe to call often. */
export function ensurePlayQueuePersistence(): void {
  if (started) {
    return;
  }
  started = true;
  try {
    const stored = readStoredPlayQueue(mmkvGetObject<unknown>(mmkvKeys.playerQueue));
    if (stored && usePlayQueueStore.getState().ids.length === 0) {
      usePlayQueueStore.setState(stored);
      if (stored.ids.some((id) => isDeviceMediaId(id))) {
        void listDeviceVideos(1000).catch(() => undefined);
      }
    }
  } catch {
    // Damaged or unavailable storage: start with no queue, as before P6.
  }
  usePlayQueueStore.subscribe((state, previous) => {
    if (
      state.ids === previous.ids &&
      state.original === previous.original &&
      state.shuffled === previous.shuffled &&
      state.currentId === previous.currentId
    ) {
      return;
    }
    try {
      mmkvSetObject(mmkvKeys.playerQueue, toStoredPlayQueue(state));
    } catch {
      // Kept for this run even when it can't be saved.
    }
  });
}
