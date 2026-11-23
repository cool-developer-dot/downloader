/**
 * P11 #689 Block Screen Capture: the switch in Settings → Privacy, off by default, remembered (MMKV). With it on, the
 * Private Folder's screens — its PIN gate, its list and its own player of a private video — can't be captured
 * (`secure-window.ts` has the rule). The rest of the app is never affected by it.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvSetBoolean } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

export const DEFAULT_BLOCK_SCREEN_CAPTURE = false;

function readOn(): boolean {
  try {
    return mmkvGetBoolean(mmkvKeys.privacyBlockScreenCapture) === true;
  } catch {
    return DEFAULT_BLOCK_SCREEN_CAPTURE;
  }
}

const useBlockScreenCaptureStore = createStore<{ on: boolean }>()(() => ({ on: readOn() }));

export function useBlockScreenCapture(): boolean {
  return useBlockScreenCaptureStore((state) => state.on);
}

export function isBlockScreenCaptureOn(): boolean {
  return useBlockScreenCaptureStore.getState().on;
}

export function setBlockScreenCapture(on: boolean): void {
  try {
    mmkvSetBoolean(mmkvKeys.privacyBlockScreenCapture, on);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useBlockScreenCaptureStore.setState({ on });
}
