import { mmkvKeys } from '@/storage/constants';
import { mmkvGetString, mmkvSetString } from '@/storage/mmkv';

import { DEFAULT_DURATION_LABEL_MODE, isDurationLabelMode, type DurationLabelMode } from './duration-label';

export function readPersistedDurationLabelMode(): DurationLabelMode {
  try {
    const raw = mmkvGetString(mmkvKeys.playerDurationLabelMode);
    if (isDurationLabelMode(raw)) {
      return raw;
    }
  } catch {
    // Corrupted persistence must not crash the Player.
  }
  return DEFAULT_DURATION_LABEL_MODE;
}

export function writePersistedDurationLabelMode(mode: DurationLabelMode): void {
  try {
    mmkvSetString(mmkvKeys.playerDurationLabelMode, mode);
  } catch {
    // Non-fatal.
  }
}
