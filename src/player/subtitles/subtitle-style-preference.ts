/**
 * P4: the subtitle style, app-wide and remembered (MMKV). Screens use `useSubtitleStyle()`.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import { DEFAULT_SUBTITLE_STYLE, normalizeSubtitleStyle, type SubtitleStyle } from './subtitle-style';

function readStyle(): SubtitleStyle {
  try {
    return normalizeSubtitleStyle(mmkvGetObject<unknown>(mmkvKeys.playerSubtitleStyle));
  } catch {
    // Damaged or unavailable storage must not stop the Player.
    return DEFAULT_SUBTITLE_STYLE;
  }
}

const useSubtitleStyleStore = createStore<{ style: SubtitleStyle }>()(() => ({ style: readStyle() }));

export function useSubtitleStyle(): SubtitleStyle {
  return useSubtitleStyleStore((state) => state.style);
}

export function setSubtitleStyle(change: Partial<SubtitleStyle>): void {
  const style = normalizeSubtitleStyle({ ...useSubtitleStyleStore.getState().style, ...change });
  try {
    mmkvSetObject(mmkvKeys.playerSubtitleStyle, style);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useSubtitleStyleStore.setState({ style });
}

export function resetSubtitleStyle(): void {
  setSubtitleStyle(DEFAULT_SUBTITLE_STYLE);
}
