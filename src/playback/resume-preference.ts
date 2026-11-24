/**
 * Design 25 "Resume playback": a video opens where it was left (the automatic resume of `use-resume-prompt.ts`). On by
 * default, as before; off, every video starts from the beginning. App-wide, remembered (MMKV).
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvSetBoolean } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

function readResume(): boolean {
  try {
    return mmkvGetBoolean(mmkvKeys.playerResumePlayback) !== false;
  } catch {
    return true;
  }
}

const useResumePreferenceStore = createStore<{ on: boolean }>()(() => ({ on: readResume() }));

export function useResumePlayback(): boolean {
  return useResumePreferenceStore((state) => state.on);
}

export function isResumePlaybackOn(): boolean {
  return useResumePreferenceStore.getState().on;
}

export function setResumePlayback(on: boolean): void {
  try {
    mmkvSetBoolean(mmkvKeys.playerResumePlayback, on);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useResumePreferenceStore.setState({ on });
}
