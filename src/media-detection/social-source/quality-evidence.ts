/**
 * Quality / size evidence — omit when unknown; never fabricate.
 */

import { labelFromHeight } from '../quality/quality.resolver';
import type { DetectedMedia } from '../types';

export function resolveQualityLabelFromEvidence(input: {
  width?: number | null;
  height?: number | null;
  resolution?: string | null;
}): string | null {
  const w = input.width;
  const h = input.height;
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
    // Spec: 1920x1080 → 1080p; portrait 1080x1920 → 1080p. Use short side.
    const shortSide = Math.min(w, h);
    return labelFromHeight(shortSide);
  }
  if (typeof h === 'number' && h > 0) {
    return labelFromHeight(h);
  }
  // Do not parse "hd" from URLs/filenames.
  return null;
}

export function resolveCredibleSizeBytes(
  contentLength: number | null | undefined,
  mediaEstimated?: number | null,
): number | null {
  if (
    typeof contentLength === 'number' &&
    Number.isFinite(contentLength) &&
    contentLength > 0
  ) {
    // Range bytes=0-0 / tiny probe slice lengths are not full-media size.
    if (contentLength <= 4096) {
      return null;
    }
    return Math.floor(contentLength);
  }
  if (
    typeof mediaEstimated === 'number' &&
    Number.isFinite(mediaEstimated) &&
    mediaEstimated > 0 &&
    mediaEstimated > 4096
  ) {
    return Math.floor(mediaEstimated);
  }
  return null;
}

export function qualityFromDetectedMedia(media: DetectedMedia): string | null {
  return resolveQualityLabelFromEvidence({
    width: media.width,
    height: media.height,
    resolution: media.resolution,
  });
}
