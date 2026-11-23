/**
 * P9 #687 Disable History: "don't keep a record of watched files". App-wide, remembered (MMKV), off by default.
 *
 * While on, nothing new is recorded: no Watch history entry, no Continue watching, no resume point and no play count
 * (`bind-playback-persistence.ts` drops the playback events before the coordinator stores anything, and the play
 * counter skips them). What is already recorded stays until the user clears it. Screens use
 * `useWatchHistoryPaused()`; the gates read `isWatchHistoryPaused()`.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvSetBoolean } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

function readPaused(): boolean {
  try {
    return mmkvGetBoolean(mmkvKeys.playerDisableHistory) === true;
  } catch {
    // Unavailable storage: history is kept, as before P9.
    return false;
  }
}

const useHistoryPauseStore = createStore<{ paused: boolean }>()(() => ({ paused: readPaused() }));

export function useWatchHistoryPaused(): boolean {
  return useHistoryPauseStore((state) => state.paused);
}

export function isWatchHistoryPaused(): boolean {
  return useHistoryPauseStore.getState().paused;
}

export function setWatchHistoryPaused(paused: boolean): void {
  try {
    mmkvSetBoolean(mmkvKeys.playerDisableHistory, paused);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useHistoryPauseStore.setState({ paused });
}
