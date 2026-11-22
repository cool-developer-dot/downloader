/**
 * P8 #586 / #587: the gesture settings, app-wide and remembered (MMKV). Screens use `useGestureSettings()`; the `set…`
 * functions save and update every screen at once.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import {
  DEFAULT_GESTURE_SETTINGS,
  normalizeGestureSettings,
  type GestureSensitivity,
  type GestureSettings,
  type SwitchableGesture,
} from './gesture-settings';

function readSettings(): GestureSettings {
  try {
    return normalizeGestureSettings(mmkvGetObject<unknown>(mmkvKeys.playerGestures));
  } catch {
    // Damaged or unavailable storage must not stop the Player.
    return DEFAULT_GESTURE_SETTINGS;
  }
}

const useGestureSettingsStore = createStore<{ settings: GestureSettings }>()(() => ({ settings: readSettings() }));

export function useGestureSettings(): GestureSettings {
  return useGestureSettingsStore((state) => state.settings);
}

export function getGestureSettings(): GestureSettings {
  return useGestureSettingsStore.getState().settings;
}

function saveGestureSettings(change: Partial<GestureSettings>): void {
  const settings = normalizeGestureSettings({ ...useGestureSettingsStore.getState().settings, ...change });
  try {
    mmkvSetObject(mmkvKeys.playerGestures, settings);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useGestureSettingsStore.setState({ settings });
}

/** #587: the master switch ("Gesture controls"). Each gesture's own switch is kept. */
export function setGesturesEnabled(on: boolean): void {
  saveGestureSettings({ enabled: on });
}

/** #587: one gesture on or off. */
export function setGestureOn(gesture: SwitchableGesture, on: boolean): void {
  saveGestureSettings({ [gesture]: on });
}

/** #586: Low, Normal or High. */
export function setGestureSensitivity(sensitivity: GestureSensitivity): void {
  saveGestureSettings({ sensitivity });
}

/** Everything back on, Normal. */
export function resetGestureSettings(): void {
  saveGestureSettings(DEFAULT_GESTURE_SETTINGS);
}
