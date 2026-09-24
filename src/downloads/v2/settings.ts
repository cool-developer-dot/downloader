/**
 * The user's download preferences, as the native engine needs them. The engine persists what it is given, so a
 * download that resumes after a reboot — before any JavaScript runs — still obeys Wi-Fi-only.
 */

import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';

export type V2SettingsInput = {
  wifiOnly: boolean;
  maxConcurrentDownloads: number;
};

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
    // Saving to the gallery stays an explicit per-video action in this app; never automatic.
    autoSaveToGallery: false,
    preferredMaxHeight: null,
  };
}

export function sameV2Settings(a: DownloadSettings, b: DownloadSettings): boolean {
  return (
    a.maxConcurrent === b.maxConcurrent &&
    a.wifiOnly === b.wifiOnly &&
    a.autoSaveToGallery === b.autoSaveToGallery &&
    a.preferredMaxHeight === b.preferredMaxHeight
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
