/**
 * Design 25 "Default orientation": the orientation every video opens in (Auto, as before, unless changed). The
 * Player's own Orientation choice still changes it for the video playing. App-wide, remembered (MMKV).
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetString, mmkvSetString } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import { DEFAULT_ORIENTATION_MODE, isValidOrientationMode, type OrientationMode } from './orientation-mode';

function readDefault(): OrientationMode {
  try {
    const value = mmkvGetString(mmkvKeys.playerDefaultOrientation);
    return isValidOrientationMode(value) ? value : DEFAULT_ORIENTATION_MODE;
  } catch {
    return DEFAULT_ORIENTATION_MODE;
  }
}

const useDefaultOrientationStore = createStore<{ mode: OrientationMode }>()(() => ({ mode: readDefault() }));

export function useDefaultOrientation(): OrientationMode {
  return useDefaultOrientationStore((state) => state.mode);
}

export function getDefaultOrientation(): OrientationMode {
  return useDefaultOrientationStore.getState().mode;
}

export function setDefaultOrientation(mode: OrientationMode): void {
  try {
    mmkvSetString(mmkvKeys.playerDefaultOrientation, mode);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useDefaultOrientationStore.setState({ mode });
}
