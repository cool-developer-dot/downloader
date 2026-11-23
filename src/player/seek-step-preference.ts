/**
 * P1 #527: the chosen seek interval, remembered across launches. `getSeekStepSeconds()` is for code outside React
 * (headset or media-session skips can read it); screens use `useSeekStepSeconds()`.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetNumber, mmkvSetNumber } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import { DEFAULT_SEEK_STEP_SECONDS, normalizeSeekStepSeconds, type SeekStepSeconds } from './seek-step';

export function readPersistedSeekStepSeconds(): SeekStepSeconds {
  try {
    return normalizeSeekStepSeconds(mmkvGetNumber(mmkvKeys.playerSeekStepSeconds));
  } catch {
    // Damaged or unavailable storage must not stop the Player.
    return DEFAULT_SEEK_STEP_SECONDS;
  }
}

const useSeekStepStore = createStore<{ seconds: SeekStepSeconds }>()(() => ({
  seconds: readPersistedSeekStepSeconds(),
}));

export function useSeekStepSeconds(): SeekStepSeconds {
  return useSeekStepStore((state) => state.seconds);
}

export function getSeekStepSeconds(): SeekStepSeconds {
  return useSeekStepStore.getState().seconds;
}

export function setSeekStepSeconds(value: number): void {
  const seconds = normalizeSeekStepSeconds(value);
  try {
    mmkvSetNumber(mmkvKeys.playerSeekStepSeconds, seconds);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useSeekStepStore.setState({ seconds });
}
