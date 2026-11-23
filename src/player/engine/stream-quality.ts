/**
 * P14 #670 Adaptive bitrate. HLS and DASH streams already adapt to the connection (the player switches between the
 * stream's variants as the network allows); this lets the user cap how high it may go, to save data. App-wide, MMKV.
 * Files on the phone have one quality, so the cap only matters for online streams. Pure apart from the store.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetString, mmkvSetString } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

export const STREAM_QUALITIES = ['auto', 'saver', '720', '1080'] as const;

export type StreamQuality = (typeof STREAM_QUALITIES)[number];

export const DEFAULT_STREAM_QUALITY: StreamQuality = 'auto';

/**
 * The longest video side the player may pick: a box, so a portrait stream gets the same cap as a landscape one
 * (720p = 1280 × 720 or 720 × 1280). Null = no cap.
 */
export function streamQualityLongSide(quality: StreamQuality): number | null {
  switch (quality) {
    case 'saver':
      return 854;
    case '720':
      return 1280;
    case '1080':
      return 1920;
    default:
      return null;
  }
}

export function normalizeStreamQuality(value: unknown): StreamQuality {
  return typeof value === 'string' && (STREAM_QUALITIES as readonly string[]).includes(value)
    ? (value as StreamQuality)
    : DEFAULT_STREAM_QUALITY;
}

/** "720p" for the playing video's size (its shorter side, the way qualities are named); null when unknown. */
export function playingQualityLabel(size: { width: number; height: number } | null | undefined): string | null {
  if (!size || !(size.width > 0) || !(size.height > 0)) {
    return null;
  }
  return `${Math.min(size.width, size.height)}p`;
}

type StreamQualityState = { quality: StreamQuality };

function read(): StreamQuality {
  try {
    return normalizeStreamQuality(mmkvGetString(mmkvKeys.playerStreamQuality));
  } catch {
    return DEFAULT_STREAM_QUALITY;
  }
}

const useStreamQualityStore = createStore<StreamQualityState>()(() => ({ quality: read() }));

export function useStreamQuality(): StreamQuality {
  return useStreamQualityStore((state) => state.quality);
}

export function getStreamQuality(): StreamQuality {
  return useStreamQualityStore.getState().quality;
}

export function setStreamQuality(quality: StreamQuality): void {
  try {
    mmkvSetString(mmkvKeys.playerStreamQuality, quality);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useStreamQualityStore.setState({ quality });
}
