/**
 * Phase 2 — verified standalone qualities for the same current media.
 * Presentation-only filter. Does not invent variants or bypass verification.
 */
import { isLikelyMediaSegment } from '@/media-detection/services/false-positive.filter';
import {
  sortQualityOptions,
  type DownloadQualityOption,
} from '@/downloads/quality';

import { isRejectedDownloadTarget } from './browser-download-presentation';

const MUX_OR_DRM_REASONS = new Set<string>([
  'DRM_PROTECTED',
  'ENCRYPTED_MEDIA',
  'UNSUPPORTED_STREAM',
  'UNSUPPORTED_FORMAT',
]);

function canonicalSourcePath(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return trimmed.split('?')[0]?.split('#')[0]?.toLowerCase() ?? trimmed.toLowerCase();
  }
}

function qualityDedupeKey(option: DownloadQualityOption): string {
  const height = option.height != null ? String(option.height) : 'unknown';
  const label = (option.label || 'original').trim().toLowerCase();
  return `${height}|${label}|${canonicalSourcePath(option.sourceUrl)}`;
}

/**
 * A quality row is only selectable when it is independently downloadable
 * and is not a fragment / mux-required / DRM / blob clue.
 */
export function isStandaloneDownloadableQuality(
  option: DownloadQualityOption,
): boolean {
  if (!option.downloadable) {
    return false;
  }
  const sourceUrl = option.sourceUrl?.trim() ?? '';
  if (!sourceUrl) {
    return false;
  }
  if (isRejectedDownloadTarget(sourceUrl)) {
    return false;
  }
  if (isLikelyMediaSegment(sourceUrl)) {
    return false;
  }
  if (String(option.container).toLowerCase() === 'dash') {
    return false;
  }
  if (option.unavailableReason && MUX_OR_DRM_REASONS.has(option.unavailableReason)) {
    return false;
  }
  return true;
}

/**
 * Verified, standalone, supported alternatives for the current media.
 * Deterministic order (existing quality sort). Equivalent URL/quality rows collapsed.
 */
export function selectVerifiedStandaloneQualities(
  options: readonly DownloadQualityOption[] | null | undefined,
): DownloadQualityOption[] {
  if (!options || options.length === 0) {
    return [];
  }
  const standalone = options.filter(isStandaloneDownloadableQuality);
  const sorted = sortQualityOptions(standalone);
  const seen = new Set<string>();
  const deduped: DownloadQualityOption[] = [];
  for (const option of sorted) {
    const key = qualityDedupeKey(option);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(option);
  }
  return deduped;
}

export function hasMultipleVerifiedQualities(
  options: readonly DownloadQualityOption[] | null | undefined,
): boolean {
  return selectVerifiedStandaloneQualities(options).length > 1;
}
