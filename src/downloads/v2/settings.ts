/**
 * The user's download preferences, as the native engine needs them. The engine persists what it is given, so a
 * download that resumes after a reboot — before any JavaScript runs — still obeys Wi-Fi-only.
 */

import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';

export type V2SettingsInput = {
  wifiOnly: boolean;
  maxConcurrentDownloads: number;
  /** Copy every completed download to the device gallery. Default true. */
  saveToGallery?: boolean;
  /** Settings → Download Settings → "Connections per file" (1–4). */
  connectionsPerFile?: number;
};

const MIN_CONCURRENT = 1;
const MAX_CONCURRENT = 4;

/** "Connections per file": how many connections one large file (or one stream's segments) may use at once. */
export const MIN_CONNECTIONS_PER_FILE = 1;
export const MAX_CONNECTIONS_PER_FILE = 4;
export const DEFAULT_CONNECTIONS_PER_FILE = 3;

/** A stored or typed value → a connection count the engine accepts (anything else is the default). */
export function normalizeConnectionsPerFile(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    return DEFAULT_CONNECTIONS_PER_FILE;
  }
  return Math.min(MAX_CONNECTIONS_PER_FILE, Math.max(MIN_CONNECTIONS_PER_FILE, Math.round(parsed)));
}

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
    preferredMaxHeight: null,
    connectionsPerFile: normalizeConnectionsPerFile(input.connectionsPerFile),
  };
}

export function sameV2Settings(a: DownloadSettings, b: DownloadSettings): boolean {
  return (
    a.maxConcurrent === b.maxConcurrent &&
    a.wifiOnly === b.wifiOnly &&
    a.autoSaveToGallery === b.autoSaveToGallery &&
    a.preferredMaxHeight === b.preferredMaxHeight &&
    a.connectionsPerFile === b.connectionsPerFile
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
