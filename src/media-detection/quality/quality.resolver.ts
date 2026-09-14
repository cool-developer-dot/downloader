import type { DetectedMedia, MediaQualityVariant } from '../types';
import { QUALITY_LADDER, type QualityLabel } from './quality.constants';

export type ResolvedQuality = {
  id: string;
  label: QualityLabel;
  resolution: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  bandwidth: number | null;
  codecs: string | null;
  container: string | null;
  estimatedSize: number | null;
  url: string;
  available: boolean;
  source: 'variant' | 'progressive';
};

/**
 * Map a verified height to a standard quality label.
 * Returns null when height is missing — never guess.
 */
export function labelFromHeight(height: number | null | undefined): QualityLabel | null {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    return null;
  }

  for (const tier of QUALITY_LADDER) {
    if (height >= tier.minHeight) {
      return tier.label;
    }
  }

  return '144p';
}

/**
 * Resolve display qualities from verified Progressive media + HLS variants only.
 */
export function resolveQualities(input: {
  media: DetectedMedia;
  variants: MediaQualityVariant[];
}): ResolvedQuality[] {
  const { media, variants } = input;
  const forMedia = variants.filter((v) => v.mediaId === media.id);

  if (forMedia.length > 0) {
    const resolved: ResolvedQuality[] = [];

    for (const variant of forMedia) {
      const label =
        labelFromHeight(variant.height) ??
        (variant.resolution ? ('Original' as QualityLabel) : null);
      if (!label) {
        continue;
      }
      resolved.push({
        id: variant.id,
        label,
        resolution: variant.resolution,
        width: variant.width,
        height: variant.height,
        bitrate: variant.bandwidth,
        bandwidth: variant.bandwidth,
        codecs: variant.codecs,
        container:
          media.container === 'hls'
            ? 'HLS'
            : media.container === 'dash'
              ? 'DASH'
              : media.container.toUpperCase(),
        estimatedSize: null,
        url: variant.url,
        available: !media.isDrm,
        source: 'variant',
      });
    }

    return sortQualities(resolved);
  }

  // Progressive: single verified stream — only if we have dimensions or container.
  if (media.category === 'video' || media.category === 'audio') {
    const label =
      labelFromHeight(media.height) ??
      (media.resolution || media.container !== 'unknown'
        ? ('Original' as QualityLabel)
        : null);

    if (!label) {
      return [];
    }

    return [
      {
        id: `${media.id}_progressive`,
        label,
        resolution: media.resolution,
        width: media.width,
        height: media.height,
        bitrate: media.bitrate,
        bandwidth: media.bitrate,
        codecs: media.codec,
        container: media.container.toUpperCase(),
        estimatedSize: media.estimatedFileSize,
        url: media.url,
        available: !media.isDrm,
        source: 'progressive',
      },
    ];
  }

  // Stream without parsed variants yet — no fabricated qualities.
  return [];
}

function sortQualities(items: ResolvedQuality[]): ResolvedQuality[] {
  const rank = (label: QualityLabel): number => {
    const idx = QUALITY_LADDER.findIndex((t) => t.label === label);
    return idx >= 0 ? idx : QUALITY_LADDER.length;
  };

  return items.slice().sort((a, b) => {
    const byLabel = rank(a.label) - rank(b.label);
    if (byLabel !== 0) {
      return byLabel;
    }
    return (b.height ?? 0) - (a.height ?? 0);
  });
}

/**
 * Future Audio Extraction interface — display preparation only.
 * Does not convert or download.
 */
export type AudioExtractionOption = {
  id: string;
  label: string;
  container: string;
  available: boolean;
  sourceMediaId: string;
};

export function resolveAudioOptions(mediaList: DetectedMedia[]): AudioExtractionOption[] {
  const byContainer = new Map<string, AudioExtractionOption>();

  for (const media of mediaList) {
    if (media.category !== 'audio') {
      continue;
    }
    if (media.isDrm) {
      continue;
    }

    const key = media.container === 'unknown' ? 'original' : media.container;
    if (byContainer.has(key)) {
      continue;
    }

    const labelMap: Record<string, string> = {
      mp3: 'MP3',
      aac: 'AAC',
      m4a: 'M4A',
      ogg: 'OGG',
      original: 'Original Audio',
    };

    byContainer.set(key, {
      id: `audio_${key}`,
      label: labelMap[key] ?? 'Original Audio',
      container: key === 'original' ? 'AUDIO' : key.toUpperCase(),
      available: true,
      sourceMediaId: media.id,
    });
  }

  return Array.from(byContainer.values());
}
