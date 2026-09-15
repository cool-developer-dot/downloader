import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

export const MAX_CONCURRENT_CHOICES = [1, 2, 3, 4] as const;

/** `null` downloads the best available quality. */
export const PREFERRED_HEIGHT_CHOICES = [null, 1080, 720, 480] as const;

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  maxConcurrent: 2,
  wifiOnly: false,
  autoSaveToGallery: false,
  preferredMaxHeight: null,
};

export function normalizeDownloadSettings(raw: unknown): DownloadSettings {
  const value = isRecord(raw) ? raw : {};
  return {
    maxConcurrent:
      MAX_CONCURRENT_CHOICES.find((choice) => choice === value.maxConcurrent) ??
      DEFAULT_DOWNLOAD_SETTINGS.maxConcurrent,
    wifiOnly: typeof value.wifiOnly === 'boolean' ? value.wifiOnly : DEFAULT_DOWNLOAD_SETTINGS.wifiOnly,
    autoSaveToGallery:
      typeof value.autoSaveToGallery === 'boolean'
        ? value.autoSaveToGallery
        : DEFAULT_DOWNLOAD_SETTINGS.autoSaveToGallery,
    preferredMaxHeight: PREFERRED_HEIGHT_CHOICES.find((choice) => choice === value.preferredMaxHeight) ?? null,
  };
}

/** v1 stored `{ version, settings: { maxConcurrentDownloads, wifiOnly, ... } }`; carry over what still applies. */
export function settingsFromLegacy(raw: unknown): DownloadSettings {
  const legacy = isRecord(raw) && isRecord(raw.settings) ? raw.settings : isRecord(raw) ? raw : {};
  return normalizeDownloadSettings({ maxConcurrent: legacy.maxConcurrentDownloads, wifiOnly: legacy.wifiOnly });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
