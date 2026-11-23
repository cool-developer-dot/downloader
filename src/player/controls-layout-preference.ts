/**
 * P8 #692: the customized controls, app-wide and remembered (MMKV). Screens use `useControlsLayout()`.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvRemove, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import { DEFAULT_CONTROLS_LAYOUT, normalizeControlsLayout, type ControlsLayout } from './controls-layout';

function readLayout(): ControlsLayout {
  try {
    return normalizeControlsLayout(mmkvGetObject<unknown>(mmkvKeys.playerControlsLayout));
  } catch {
    // Damaged or unavailable storage must not stop the Player.
    return DEFAULT_CONTROLS_LAYOUT;
  }
}

const useControlsLayoutStore = createStore<{ layout: ControlsLayout }>()(() => ({ layout: readLayout() }));

export function useControlsLayout(): ControlsLayout {
  return useControlsLayoutStore((state) => state.layout);
}

export function getControlsLayout(): ControlsLayout {
  return useControlsLayoutStore.getState().layout;
}

export function setControlsLayout(layout: ControlsLayout): void {
  const next = normalizeControlsLayout(layout);
  try {
    mmkvSetObject(mmkvKeys.playerControlsLayout, next);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useControlsLayoutStore.setState({ layout: next });
}

/** Reset to default: every control back in its place and shown. */
export function resetControlsLayout(): void {
  try {
    mmkvRemove(mmkvKeys.playerControlsLayout);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useControlsLayoutStore.setState({ layout: DEFAULT_CONTROLS_LAYOUT });
}
