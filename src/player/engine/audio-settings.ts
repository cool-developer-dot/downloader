/**
 * P17 Audio tracks & delay — its rules and state:
 *
 * - #553 Audio Track Switch: the video's own tracks (languages, commentary), named for the list.
 * - #554 Audio Delay: the sound later (+) or earlier (−) than the picture, in 50 ms steps within ±3 s, kept for each
 *   video (MMKV, the latest 300; 0 is not stored). Online streams are never remembered.
 * - #574 Audio Only Mode: no picture is decoded (the battery saving) and the sound keeps playing with the screen off.
 *   For this run only: the next time VidoraX opens, videos show their picture again.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

import { isStreamMediaId } from '../remote-stream';

// --- #553 ------------------------------------------------------------------------------------------------------

/** The part of expo-video's `AudioTrack` the list uses. */
export type AudioTrackInfo = { id?: string; label?: string | null; language?: string | null; name?: string | null };

/**
 * "English", "English · Commentary", or "Track 2" when the file names nothing. The label is expo-video's (in the
 * phone's language); a name that only repeats it is left out.
 */
export function audioTrackLabel(track: AudioTrackInfo, index: number, fallback: (n: number) => string): string {
  const label = track.label?.trim() || track.language?.trim() || '';
  const name = track.name?.trim() || '';
  if (label && name && name.toLowerCase() !== label.toLowerCase()) {
    return `${label} · ${name}`;
  }
  return label || name || fallback(index + 1);
}

/** The same track in two lists (expo-video gives new objects on each change). */
export function isSameAudioTrack(a: AudioTrackInfo | null | undefined, b: AudioTrackInfo | null | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  if (a.id && b.id) {
    return a.id === b.id;
  }
  return a.label === b.label && a.language === b.language && a.name === b.name;
}

/**
 * The track playing. expo-video reports none until a track is chosen; until then ExoPlayer plays the file's default
 * track (its first when none is marked), so that one is shown as playing.
 */
export function playingAudioTrack<T extends AudioTrackInfo & { isDefault?: boolean }>(
  tracks: readonly T[],
  reported: T | null | undefined,
): T | null {
  if (reported) {
    return reported;
  }
  return tracks.find((track) => track.isDefault) ?? tracks[0] ?? null;
}

// --- #554 ------------------------------------------------------------------------------------------------------

export const AUDIO_DELAY_STEP_MS = 50;
export const MAX_AUDIO_DELAY_MS = 3_000;
export const MAX_REMEMBERED_DELAYS = 300;

export function normalizeAudioDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  const stepped = Math.round(value / AUDIO_DELAY_STEP_MS) * AUDIO_DELAY_STEP_MS;
  return Math.max(-MAX_AUDIO_DELAY_MS, Math.min(MAX_AUDIO_DELAY_MS, stepped)) || 0;
}

export function stepAudioDelay(delayMs: number, direction: 1 | -1): number {
  return normalizeAudioDelay(normalizeAudioDelay(delayMs) + direction * AUDIO_DELAY_STEP_MS);
}

/** "+120 ms", "−50 ms", "0 ms" (a real minus sign). */
export function formatAudioDelay(delayMs: number): string {
  const value = normalizeAudioDelay(delayMs);
  if (value === 0) {
    return '0 ms';
  }
  return `${value > 0 ? '+' : '−'}${Math.abs(value)} ms`;
}

type RememberedDelay = { ms: number; at: number };
export type RememberedDelays = Record<string, RememberedDelay>;

export function canRememberDelay(mediaId: string | null | undefined): mediaId is string {
  return typeof mediaId === 'string' && mediaId.trim() !== '' && !isStreamMediaId(mediaId);
}

export function normalizeRememberedDelays(value: unknown): RememberedDelays {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const out: RememberedDelays = {};
  for (const [mediaId, entry] of Object.entries(value as Record<string, unknown>)) {
    const raw = entry as RememberedDelay | null;
    const ms = normalizeAudioDelay(raw?.ms);
    if (ms !== 0 && typeof raw?.at === 'number' && Number.isFinite(raw.at) && canRememberDelay(mediaId)) {
      out[mediaId] = { ms, at: raw.at };
    }
  }
  return out;
}

export function rememberDelay(
  delays: RememberedDelays,
  mediaId: string,
  delayMs: number,
  now: number,
  max = MAX_REMEMBERED_DELAYS,
): RememberedDelays {
  const next: RememberedDelays = { ...delays };
  const ms = normalizeAudioDelay(delayMs);
  if (ms === 0) {
    delete next[mediaId];
  } else {
    next[mediaId] = { ms, at: now };
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

let delays: RememberedDelays | null = null;

function loadDelays(): RememberedDelays {
  if (delays == null) {
    try {
      delays = normalizeRememberedDelays(mmkvGetObject(mmkvKeys.playerAudioDelayPerVideo));
    } catch {
      delays = {};
    }
  }
  return delays;
}

export function rememberedDelayFor(mediaId: string | null | undefined): number {
  return canRememberDelay(mediaId) ? (loadDelays()[mediaId]?.ms ?? 0) : 0;
}

export function saveDelayFor(mediaId: string | null | undefined, delayMs: number, now = Date.now()): void {
  if (!canRememberDelay(mediaId)) {
    return;
  }
  const current = loadDelays();
  if ((current[mediaId]?.ms ?? 0) === normalizeAudioDelay(delayMs)) {
    return;
  }
  delays = rememberDelay(current, mediaId, delayMs, now);
  try {
    mmkvSetObject(mmkvKeys.playerAudioDelayPerVideo, delays);
  } catch {
    // Kept for this run even when it can't be saved.
  }
}

// --- #574 ------------------------------------------------------------------------------------------------------

const useAudioOnlyStore = createStore<{ on: boolean }>()(() => ({ on: false }));

export function useAudioOnly(): boolean {
  return useAudioOnlyStore((state) => state.on);
}

export function getAudioOnly(): boolean {
  return useAudioOnlyStore.getState().on;
}

export function setAudioOnly(on: boolean): void {
  useAudioOnlyStore.setState({ on });
}
