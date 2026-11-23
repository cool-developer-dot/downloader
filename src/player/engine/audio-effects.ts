/**
 * P19 Audio effects & EQ — settings and rules (app-wide, MMKV):
 *
 * - #549 Equalizer: five bands as in the design (60 Hz, 230 Hz, 910 Hz, 3.6 kHz, 14 kHz), −12…+12 dB each, mapped onto
 *   the phone's own equalizer bands. #550 EQ Presets: Flat, Bass, Vocal, Rock, Pop, Classical, Jazz. #729 Save EQ: the
 *   user's own presets (a name and the five gains), up to 20.
 * - #551 Bass Boost and #552 Virtualizer: 0–100 %. #548 Volume Boost: 100–200 % (up to +6 dB, limited, never clips).
 * - #555 Mono, #556 Balance (−100 left … +100 right), #557 Night mode audio (compressor), #558 Volume normalization.
 *
 * Effects shape VidoraX's sound only (its own audio session); nothing changes for other apps.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

/** The design's five bands (screen 22). */
export const EQ_BANDS_HZ = [60, 230, 910, 3600, 14000] as const;
export const EQ_MAX_DB = 12;

export const BUILT_IN_PRESETS = ['flat', 'bass', 'vocal', 'rock', 'pop', 'classical', 'jazz'] as const;
export type BuiltInPreset = (typeof BUILT_IN_PRESETS)[number];

export const PRESET_GAINS: Readonly<Record<BuiltInPreset, readonly number[]>> = {
  flat: [0, 0, 0, 0, 0],
  bass: [6, 4, 0, -1, -2],
  vocal: [-2, -1, 3, 4, 1],
  rock: [5, 2, -2, 2, 5],
  pop: [-1, 2, 4, 2, -1],
  classical: [4, 2, -1, 2, 4],
  jazz: [3, 1, -1, 1, 3],
};

export type UserPreset = { id: string; name: string; gains: number[] };

export const MAX_USER_PRESETS = 20;
export const PRESET_NAME_MAX = 30;

export type AudioEffectsSettings = {
  eqEnabled: boolean;
  /** A built-in preset, `user:<id>`, or `custom` (the gains were moved by hand). */
  preset: string;
  /** dB at EQ_BANDS_HZ. */
  gains: number[];
  bassBoost: number;
  virtualizer: number;
  volumeBoost: number;
  mono: boolean;
  balance: number;
  nightMode: boolean;
  normalize: boolean;
  userPresets: UserPreset[];
};

export const DEFAULT_AUDIO_EFFECTS: AudioEffectsSettings = {
  eqEnabled: false,
  preset: 'flat',
  gains: [0, 0, 0, 0, 0],
  bassBoost: 0,
  virtualizer: 0,
  volumeBoost: 100,
  mono: false,
  balance: 0,
  nightMode: false,
  normalize: false,
  userPresets: [],
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export function normalizeGains(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [];
  return EQ_BANDS_HZ.map((_, i) => clamp(list[i], -EQ_MAX_DB, EQ_MAX_DB, 0));
}

function normalizeUserPresets(value: unknown): UserPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: UserPreset[] = [];
  for (const raw of value) {
    const preset = raw as Partial<UserPreset> | null;
    const name = typeof preset?.name === 'string' ? preset.name.trim().slice(0, PRESET_NAME_MAX) : '';
    if (!preset || typeof preset.id !== 'string' || !preset.id || !name) {
      continue;
    }
    out.push({ id: preset.id, name, gains: normalizeGains(preset.gains) });
    if (out.length >= MAX_USER_PRESETS) {
      break;
    }
  }
  return out;
}

export function normalizeAudioEffects(value: unknown): AudioEffectsSettings {
  const saved = value && typeof value === 'object' ? (value as Partial<Record<keyof AudioEffectsSettings, unknown>>) : {};
  const userPresets = normalizeUserPresets(saved.userPresets);
  const preset =
    typeof saved.preset === 'string' &&
    ((BUILT_IN_PRESETS as readonly string[]).includes(saved.preset) ||
      saved.preset === 'custom' ||
      userPresets.some((p) => `user:${p.id}` === saved.preset))
      ? saved.preset
      : DEFAULT_AUDIO_EFFECTS.preset;
  return {
    eqEnabled: saved.eqEnabled === true,
    preset,
    gains: normalizeGains(saved.gains),
    bassBoost: clamp(saved.bassBoost, 0, 100, 0),
    virtualizer: clamp(saved.virtualizer, 0, 100, 0),
    volumeBoost: clamp(saved.volumeBoost, 100, 200, 100),
    mono: saved.mono === true,
    balance: clamp(saved.balance, -100, 100, 0),
    nightMode: saved.nightMode === true,
    normalize: saved.normalize === true,
    userPresets,
  };
}

/** The gains a preset stands for; null for `custom` or a preset that no longer exists. */
export function presetGains(preset: string, userPresets: readonly UserPreset[]): number[] | null {
  if ((BUILT_IN_PRESETS as readonly string[]).includes(preset)) {
    return [...PRESET_GAINS[preset as BuiltInPreset]];
  }
  if (preset.startsWith('user:')) {
    const found = userPresets.find((p) => `user:${p.id}` === preset);
    return found ? [...found.gains] : null;
  }
  return null;
}

/**
 * The design's five gains on the phone's own bands: the gain at each band's centre, read off the five design bands on a
 * log-frequency scale (straight between neighbours, flat beyond the ends), in millibels within the phone's range.
 */
export function mapGainsToDevice(
  gainsDb: readonly number[],
  bands: readonly { centerHz: number; minMb: number; maxMb: number }[],
): number[] {
  const xs = EQ_BANDS_HZ.map((hz) => Math.log10(hz));
  return bands.map((band) => {
    const x = Math.log10(Math.max(1, band.centerHz));
    let db: number;
    if (x <= xs[0]) {
      db = gainsDb[0] ?? 0;
    } else if (x >= xs[xs.length - 1]) {
      db = gainsDb[xs.length - 1] ?? 0;
    } else {
      const i = xs.findIndex((value, index) => index < xs.length - 1 && x >= value && x <= xs[index + 1]);
      const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
      db = (gainsDb[i] ?? 0) * (1 - t) + (gainsDb[i + 1] ?? 0) * t;
    }
    return Math.round(Math.min(band.maxMb, Math.max(band.minMb, db * 100)));
  });
}

/** A new user preset (#729); null when the name is empty. The newest first; past the cap the oldest goes. */
export function addUserPreset(
  presets: readonly UserPreset[],
  name: string,
  gains: readonly number[],
  id: string,
): UserPreset[] | null {
  const clean = name.trim().slice(0, PRESET_NAME_MAX);
  if (!clean) {
    return null;
  }
  return [{ id, name: clean, gains: normalizeGains(gains) }, ...presets].slice(0, MAX_USER_PRESETS);
}

// --- Store ------------------------------------------------------------------------------------------------------

function read(): AudioEffectsSettings {
  try {
    return normalizeAudioEffects(mmkvGetObject(mmkvKeys.playerAudioEffects));
  } catch {
    return DEFAULT_AUDIO_EFFECTS;
  }
}

const useAudioEffectsStore = createStore<AudioEffectsSettings>()(() => read());

export function useAudioEffects(): AudioEffectsSettings {
  return useAudioEffectsStore((state) => state);
}

export function getAudioEffects(): AudioEffectsSettings {
  return useAudioEffectsStore.getState();
}

export function setAudioEffects(patch: Partial<AudioEffectsSettings>): void {
  const next = normalizeAudioEffects({ ...useAudioEffectsStore.getState(), ...patch });
  try {
    mmkvSetObject(mmkvKeys.playerAudioEffects, next);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useAudioEffectsStore.setState(next, true);
}

/** Picks a preset: its gains, the equalizer on. */
export function choosePreset(preset: string): void {
  const state = getAudioEffects();
  const gains = presetGains(preset, state.userPresets);
  if (gains) {
    setAudioEffects({ preset, gains, eqEnabled: true });
  }
}

/** One band moved by hand: the preset becomes Custom. */
export function setBandGain(index: number, db: number): void {
  const gains = [...getAudioEffects().gains];
  gains[index] = db;
  setAudioEffects({ gains, preset: 'custom', eqEnabled: true });
}

export function saveUserPreset(name: string, now = Date.now()): boolean {
  const state = getAudioEffects();
  const id = now.toString(36);
  const presets = addUserPreset(state.userPresets, name, state.gains, id);
  if (!presets) {
    return false;
  }
  setAudioEffects({ userPresets: presets, preset: `user:${id}` });
  return true;
}

export function deleteUserPreset(id: string): void {
  const state = getAudioEffects();
  setAudioEffects({
    userPresets: state.userPresets.filter((p) => p.id !== id),
    preset: state.preset === `user:${id}` ? 'custom' : state.preset,
  });
}

/** Everything back to off / flat (the user's own presets stay). */
export function resetAudioEffects(): void {
  setAudioEffects({ ...DEFAULT_AUDIO_EFFECTS, userPresets: getAudioEffects().userPresets });
}
