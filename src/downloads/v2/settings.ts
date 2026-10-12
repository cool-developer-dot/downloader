/**
 * The user's download preferences, as the native engine needs them. The engine persists what it is given, so a
 * download that resumes after a reboot — before any JavaScript runs — still obeys Wi-Fi-only.
 */

import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

import { downloadWindowForEngine, sameDownloadWindow, type DownloadHours } from './conditions';
import type { V2EnginePort } from './engine-port';
import { speedLimitForEngine } from './speed-limit';

export type V2SettingsInput = {
  wifiOnly: boolean;
  maxConcurrentDownloads: number;
  /** Copy every completed download to the device gallery. Default true. */
  saveToGallery?: boolean;
  /** Settings → Download Settings → "Connections per file" (1–4). */
  connectionsPerFile?: number;
  /** Settings → Download Settings → "Speed limit", bytes per second (0 = off). */
  speedLimitBytesPerSecond?: number;
  /** F3: "Download hours" (null or off = any time). */
  downloadHours?: DownloadHours | null;
  /** F3: "Not on roaming". */
  notOnRoaming?: boolean;
  /** F3: "Pause when battery is low". */
  pauseOnLowBattery?: boolean;
  /** F3: "Only while charging". */
  onlyWhileCharging?: boolean;
  /** F6: "Live recording (beta)". */
  liveRecording?: boolean;
  /** F6: the longest recording, in minutes. */
  liveRecordingMaxMinutes?: number;
  /** The app's language, for the engine's own notification texts. */
  language?: string;
};

const MIN_CONCURRENT = 1;
const MAX_CONCURRENT = 4;

/** "Connections per file": how many connections one large file (or one stream's segments) may use at once. */
export const MIN_CONNECTIONS_PER_FILE = 1;
export const MAX_CONNECTIONS_PER_FILE = 4;
export const DEFAULT_CONNECTIONS_PER_FILE = 3;

/** F6: "Maximum length" of a live recording, in minutes — the choices offered, and the engine's bounds. */
export const LIVE_RECORDING_MAX_MINUTES_CHOICES = [30, 60, 120, 240, 480] as const;
export const MIN_LIVE_RECORDING_MAX_MINUTES = 15;
export const MAX_LIVE_RECORDING_MAX_MINUTES = 720;
export const DEFAULT_LIVE_RECORDING_MAX_MINUTES = 120;

/** A stored value → minutes the engine accepts (anything unreadable is the default). */
export function normalizeLiveRecordingMaxMinutes(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    return DEFAULT_LIVE_RECORDING_MAX_MINUTES;
  }
  return Math.min(MAX_LIVE_RECORDING_MAX_MINUTES, Math.max(MIN_LIVE_RECORDING_MAX_MINUTES, Math.round(parsed)));
}

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
    speedLimitBytesPerSecond: speedLimitForEngine(input.speedLimitBytesPerSecond),
    downloadWindow: downloadWindowForEngine(input.downloadHours),
    notOnRoaming: input.notOnRoaming === true,
    pauseOnLowBattery: input.pauseOnLowBattery === true,
    onlyWhileCharging: input.onlyWhileCharging === true,
    liveRecording: input.liveRecording === true,
    liveRecordingMaxMinutes: normalizeLiveRecordingMaxMinutes(input.liveRecordingMaxMinutes),
    language: input.language === 'ur' ? 'ur' : 'en',
  };
}

export function sameV2Settings(a: DownloadSettings, b: DownloadSettings): boolean {
  return (
    a.maxConcurrent === b.maxConcurrent &&
    a.wifiOnly === b.wifiOnly &&
    a.autoSaveToGallery === b.autoSaveToGallery &&
    a.preferredMaxHeight === b.preferredMaxHeight &&
    a.connectionsPerFile === b.connectionsPerFile &&
    (a.speedLimitBytesPerSecond ?? null) === (b.speedLimitBytesPerSecond ?? null) &&
    sameDownloadWindow(a.downloadWindow, b.downloadWindow) &&
    (a.notOnRoaming ?? false) === (b.notOnRoaming ?? false) &&
    (a.pauseOnLowBattery ?? false) === (b.pauseOnLowBattery ?? false) &&
    (a.onlyWhileCharging ?? false) === (b.onlyWhileCharging ?? false) &&
    (a.liveRecording ?? false) === (b.liveRecording ?? false) &&
    (a.liveRecordingMaxMinutes ?? DEFAULT_LIVE_RECORDING_MAX_MINUTES) ===
      (b.liveRecordingMaxMinutes ?? DEFAULT_LIVE_RECORDING_MAX_MINUTES) &&
    (a.language ?? 'en') === (b.language ?? 'en')
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
