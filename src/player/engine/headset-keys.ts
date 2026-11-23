/**
 * P15 Headset, keys & remotes — its settings, app-wide (MMKV):
 *
 * - #560 Headphone Detection: pause when headphones are unplugged or a Bluetooth headset disconnects (on).
 * - #661 Headset Button Control: a headset's ⏭ / ⏮ and a double press go to the next / previous video (on).
 * - #562 Hardware Key Control: what Volume Up / Down do while the Player is in front — the Player's volume with its
 *   on-screen level (default), skip back / forward by the seek interval, or Android's own volume panel.
 * - #701 External Remote: a keyboard's, TV remote's or game pad's keys control the Player (on).
 * - #703 Show on Lock Screen: the Player stays over the lock screen when the phone locks while it is open (off).
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

export const VOLUME_KEY_MODES = ['player', 'seek', 'system'] as const;

export type VolumeKeysMode = (typeof VOLUME_KEY_MODES)[number];

export type HeadsetKeySettings = {
  pauseOnUnplug: boolean;
  headsetButtons: boolean;
  volumeKeys: VolumeKeysMode;
  remoteKeys: boolean;
  showOnLockScreen: boolean;
};

export const DEFAULT_HEADSET_KEY_SETTINGS: HeadsetKeySettings = {
  pauseOnUnplug: true,
  headsetButtons: true,
  volumeKeys: 'player',
  remoteKeys: true,
  showOnLockScreen: false,
};

/** Saved settings, each field checked on its own (a damaged or older value keeps its default). */
export function normalizeHeadsetKeySettings(value: unknown): HeadsetKeySettings {
  const saved = value && typeof value === 'object' ? (value as Partial<Record<keyof HeadsetKeySettings, unknown>>) : {};
  const flag = (key: Exclude<keyof HeadsetKeySettings, 'volumeKeys'>) =>
    typeof saved[key] === 'boolean' ? (saved[key] as boolean) : DEFAULT_HEADSET_KEY_SETTINGS[key];
  return {
    pauseOnUnplug: flag('pauseOnUnplug'),
    headsetButtons: flag('headsetButtons'),
    volumeKeys: (VOLUME_KEY_MODES as readonly unknown[]).includes(saved.volumeKeys)
      ? (saved.volumeKeys as VolumeKeysMode)
      : DEFAULT_HEADSET_KEY_SETTINGS.volumeKeys,
    remoteKeys: flag('remoteKeys'),
    showOnLockScreen: flag('showOnLockScreen'),
  };
}

function read(): HeadsetKeySettings {
  try {
    return normalizeHeadsetKeySettings(mmkvGetObject(mmkvKeys.playerHeadsetKeys));
  } catch {
    return DEFAULT_HEADSET_KEY_SETTINGS;
  }
}

const useHeadsetKeysStore = createStore<HeadsetKeySettings>()(() => read());

export function useHeadsetKeySettings(): HeadsetKeySettings {
  return useHeadsetKeysStore((state) => state);
}

export function getHeadsetKeySettings(): HeadsetKeySettings {
  return useHeadsetKeysStore.getState();
}

export function setHeadsetKeySettings(patch: Partial<HeadsetKeySettings>): void {
  const next = normalizeHeadsetKeySettings({ ...useHeadsetKeysStore.getState(), ...patch });
  try {
    mmkvSetObject(mmkvKeys.playerHeadsetKeys, next);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useHeadsetKeysStore.setState(next, true);
}
