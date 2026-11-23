/**
 * P16 Speed & pitch — its settings and rules (app-wide, MMKV):
 *
 * - #537 Fine Speed Control: any speed from 0.25× to 4× (`playback-rates.ts`); the sheet's − / + move 0.1.
 * - #538 Pitch Correction: voices keep their natural pitch at any speed (on).
 * - #544 Speed Shortcut: the speed button either opens the speed sheet (default) or switches at one tap between 1.0×
 *   and a chosen speed (1.5×); the sheet stays a long press away, and in ⋮ → Playback → Playback speed.
 * - #736 Per-book Speed: each video, audiobook or podcast keeps its own speed (on); a new one starts at 1.0×. Only for
 *   media with a lasting id — never online streams (their ids last one run, and their links are never kept).
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import {
  DEFAULT_PLAYBACK_RATE,
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  normalizePlaybackRate,
  roundPlaybackRate,
} from '../playback-rates';
import { isStreamMediaId } from '../remote-stream';

export type SpeedButtonMode = 'sheet' | 'switch';

export const SPEED_SHORTCUT_RATES = [1.25, 1.5, 1.75, 2] as const;

export type SpeedSettings = {
  pitchCorrection: boolean;
  rememberPerVideo: boolean;
  speedButton: SpeedButtonMode;
  /** The speed the one-tap button switches to from 1.0×. */
  shortcutRate: number;
};

export const DEFAULT_SPEED_SETTINGS: SpeedSettings = {
  pitchCorrection: true,
  rememberPerVideo: true,
  speedButton: 'sheet',
  shortcutRate: 1.5,
};

export function normalizeSpeedSettings(value: unknown): SpeedSettings {
  const saved = value && typeof value === 'object' ? (value as Partial<Record<keyof SpeedSettings, unknown>>) : {};
  const shortcut = normalizePlaybackRate(saved.shortcutRate);
  return {
    pitchCorrection:
      typeof saved.pitchCorrection === 'boolean' ? saved.pitchCorrection : DEFAULT_SPEED_SETTINGS.pitchCorrection,
    rememberPerVideo:
      typeof saved.rememberPerVideo === 'boolean' ? saved.rememberPerVideo : DEFAULT_SPEED_SETTINGS.rememberPerVideo,
    speedButton: saved.speedButton === 'switch' ? 'switch' : 'sheet',
    shortcutRate: shortcut != null && shortcut !== 1 ? shortcut : DEFAULT_SPEED_SETTINGS.shortcutRate,
  };
}

// --- #537: − / + ------------------------------------------------------------------------------------------------

/** The sheet's − / + step. */
export const FINE_SPEED_STEP = 0.1;

/** One step slower (−1) or faster (+1), on the grid, kept within 0.25×–4×. */
export function stepPlaybackRate(rate: number, direction: 1 | -1): number {
  const current = normalizePlaybackRate(rate) ?? DEFAULT_PLAYBACK_RATE;
  const next = roundPlaybackRate(current + direction * FINE_SPEED_STEP);
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, next));
}

// --- #544: the speed button ----------------------------------------------------------------------------------

/** What a tap on the speed button does: a speed to switch to, or null to open the speed sheet. */
export function speedButtonTarget(currentRate: number, settings: Pick<SpeedSettings, 'speedButton' | 'shortcutRate'>): number | null {
  if (settings.speedButton !== 'switch') {
    return null;
  }
  return Math.abs(currentRate - DEFAULT_PLAYBACK_RATE) < 1e-6 ? settings.shortcutRate : DEFAULT_PLAYBACK_RATE;
}

// --- #736: each video's own speed ----------------------------------------------------------------------------

/** How many videos' speeds are kept (the least recently played go first). */
export const MAX_REMEMBERED_SPEEDS = 300;

type RememberedSpeed = { rate: number; at: number };
export type RememberedSpeeds = Record<string, RememberedSpeed>;

/** Media whose speed can be remembered: anything with a lasting id (not an online stream). */
export function canRememberSpeed(mediaId: string | null | undefined): mediaId is string {
  return typeof mediaId === 'string' && mediaId.trim() !== '' && !isStreamMediaId(mediaId);
}

export function normalizeRememberedSpeeds(value: unknown): RememberedSpeeds {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const out: RememberedSpeeds = {};
  for (const [mediaId, entry] of Object.entries(value as Record<string, unknown>)) {
    const rate = normalizePlaybackRate((entry as RememberedSpeed | null)?.rate);
    const at = (entry as RememberedSpeed | null)?.at;
    if (rate != null && typeof at === 'number' && Number.isFinite(at) && canRememberSpeed(mediaId)) {
      out[mediaId] = { rate, at };
    }
  }
  return out;
}

/**
 * The map after this video's speed changed. 1.0× is not stored (it is every video's start), so a video set back to
 * normal speed is forgotten; past the cap the oldest entries go.
 */
export function rememberSpeed(
  speeds: RememberedSpeeds,
  mediaId: string,
  rate: number,
  now: number,
  max = MAX_REMEMBERED_SPEEDS,
): RememberedSpeeds {
  const next: RememberedSpeeds = { ...speeds };
  const normalized = normalizePlaybackRate(rate);
  if (normalized == null || normalized === DEFAULT_PLAYBACK_RATE) {
    delete next[mediaId];
  } else {
    next[mediaId] = { rate: normalized, at: now };
  }
  const ids = Object.keys(next);
  if (ids.length > max) {
    ids
      .sort((a, b) => next[a].at - next[b].at)
      .slice(0, ids.length - max)
      .forEach((id) => delete next[id]);
  }
  return next;
}

// --- Stores --------------------------------------------------------------------------------------------------

function readObject<T>(key: string, normalize: (value: unknown) => T, fallback: T): T {
  try {
    return normalize(mmkvGetObject(key));
  } catch {
    return fallback;
  }
}

function writeObject(key: string, value: unknown): void {
  try {
    mmkvSetObject(key, value);
  } catch {
    // Kept for this run even when it can't be saved.
  }
}

const useSpeedSettingsStore = createStore<SpeedSettings>()(() =>
  readObject(mmkvKeys.playerSpeedSettings, normalizeSpeedSettings, DEFAULT_SPEED_SETTINGS),
);

export function useSpeedSettings(): SpeedSettings {
  return useSpeedSettingsStore((state) => state);
}

export function getSpeedSettings(): SpeedSettings {
  return useSpeedSettingsStore.getState();
}

export function setSpeedSettings(patch: Partial<SpeedSettings>): void {
  const next = normalizeSpeedSettings({ ...useSpeedSettingsStore.getState(), ...patch });
  writeObject(mmkvKeys.playerSpeedSettings, next);
  useSpeedSettingsStore.setState(next, true);
}

let speeds: RememberedSpeeds | null = null;

function loadSpeeds(): RememberedSpeeds {
  if (speeds == null) {
    speeds = readObject(mmkvKeys.playerSpeedPerVideo, normalizeRememberedSpeeds, {});
  }
  return speeds;
}

/** This video's own speed, or null when it has none (it starts at 1.0×). */
export function rememberedSpeedFor(mediaId: string | null | undefined): number | null {
  if (!canRememberSpeed(mediaId)) {
    return null;
  }
  return loadSpeeds()[mediaId]?.rate ?? null;
}

export function saveSpeedFor(mediaId: string | null | undefined, rate: number, now = Date.now()): void {
  if (!canRememberSpeed(mediaId)) {
    return;
  }
  const current = loadSpeeds();
  if ((current[mediaId]?.rate ?? DEFAULT_PLAYBACK_RATE) === (normalizePlaybackRate(rate) ?? DEFAULT_PLAYBACK_RATE)) {
    return;
  }
  speeds = rememberSpeed(current, mediaId, rate, now);
  writeObject(mmkvKeys.playerSpeedPerVideo, speeds);
}

/** "Forget every video's speed" (the sheet). */
export function forgetRememberedSpeeds(): void {
  speeds = {};
  writeObject(mmkvKeys.playerSpeedPerVideo, speeds);
}
