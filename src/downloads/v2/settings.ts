/**
 * The user's download preferences, as the native engine needs them. The engine persists what it is given, so a
 * download that resumes after a reboot — before any JavaScript runs — still obeys Wi-Fi-only.
 */

import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';
import { networkSettingsFields, sameNetworkFields, type NetworkOptionsInput } from './network-options';

export type V2SettingsInput = {
  wifiOnly: boolean;
  maxConcurrentDownloads: number;
  /** Download Settings → Advanced network; omitted or untouched = today's behaviour (nothing extra is sent). */
  network?: NetworkOptionsInput | null;
  /** Copy every completed download to the device gallery. Default true. */
  saveToGallery?: boolean;
  /** Finished/failed notification alerts; each is sent only when given (see `DownloadSettings`). */
  notificationSound?: boolean;
  notificationVibrate?: boolean;
  notificationSilent?: boolean;
};

/** The notification alert fields the input carries, and nothing else: a caller that gives none sends none. */
function notificationAlertFields(
  input: V2SettingsInput,
): Pick<DownloadSettings, 'notificationSound' | 'notificationVibrate' | 'notificationSilent'> {
  return {
    ...(typeof input.notificationSound === 'boolean' ? { notificationSound: input.notificationSound } : {}),
    ...(typeof input.notificationVibrate === 'boolean' ? { notificationVibrate: input.notificationVibrate } : {}),
    ...(typeof input.notificationSilent === 'boolean' ? { notificationSilent: input.notificationSilent } : {}),
  };
}

const MIN_CONCURRENT = 1;
const MAX_CONCURRENT = 4;

/** Pure: the app's settings shape → the engine's contract, clamped to what the engine accepts. */
export function v2DownloadSettings(input: V2SettingsInput): DownloadSettings {
  const concurrent = Number.isFinite(input.maxConcurrentDownloads)
    ? Math.round(input.maxConcurrentDownloads)
    : MIN_CONCURRENT;
  return {
    maxConcurrent: Math.min(MAX_CONCURRENT, Math.max(MIN_CONCURRENT, concurrent)),
    wifiOnly: input.wifiOnly === true,
    // A finished video also appears in the device gallery, unless the user turned that off.
    autoSaveToGallery: input.saveToGallery !== false,
    // Advanced network: only what the user changed; untouched options add nothing.
    ...networkSettingsFields(input.network),
    preferredMaxHeight: null,
    ...notificationAlertFields(input),
  };
}

export function sameV2Settings(a: DownloadSettings, b: DownloadSettings): boolean {
  return (
    sameNetworkFields(a, b) &&
    a.maxConcurrent === b.maxConcurrent &&
    a.wifiOnly === b.wifiOnly &&
    a.autoSaveToGallery === b.autoSaveToGallery &&
    a.preferredMaxHeight === b.preferredMaxHeight &&
    a.notificationSound === b.notificationSound &&
    a.notificationVibrate === b.notificationVibrate &&
    a.notificationSilent === b.notificationSilent
  );
}

let lastPushed: DownloadSettings | null = null;

export function resetV2SettingsForTests(): void {
  lastPushed = null;
}

/** Pushes the settings when they actually changed; a failure here never blocks the app. */
export async function pushV2DownloadSettings(
  engine: V2EnginePort | null,
  input: V2SettingsInput,
): Promise<DownloadSettings | null> {
  if (!engine) {
    return null;
  }
  const next = v2DownloadSettings(input);
  if (lastPushed && sameV2Settings(lastPushed, next)) {
    return lastPushed;
  }
  try {
    await engine.setDownloadSettings(next);
    lastPushed = next;
    return next;
  } catch {
    return null;
  }
}
