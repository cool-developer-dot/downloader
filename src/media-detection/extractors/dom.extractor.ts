import type { BridgeMediaCandidatePayload, MediaCandidate } from '../types';
import { isSafeMediaUrl, normalizeMediaUrl, resolveAbsoluteUrl } from '../utils';
import { parseProgressiveMediaUrl } from '../parsers';

/**
 * Map a DOM <video> / <source> bridge payload into a MediaCandidate.
 */
export function extractFromDomCandidate(
  payload: BridgeMediaCandidatePayload,
): MediaCandidate | null {
  const absolute = resolveAbsoluteUrl(payload.url, payload.pageUrl);
  if (!absolute) {
    return null;
  }

  const base = parseProgressiveMediaUrl({
    url: absolute,
    pageUrl: payload.pageUrl,
    mimeType: payload.mimeType,
    detectionSource: payload.detectionSource,
    title: payload.title,
    estimatedFileSize: payload.estimatedFileSize,
  });

  if (!base) {
    return null;
  }

  const thumbnailUrl = sanitizeThumbnail(payload.thumbnailUrl, payload.pageUrl);

  return {
    ...base,
    thumbnailUrl,
    duration: payload.duration,
    width: payload.width,
    height: payload.height,
    isLive: payload.isLive,
    isDrm: payload.isDrm,
    playlistType: payload.playlistType ?? base.playlistType,
  };
}

function sanitizeThumbnail(
  value: string | null | undefined,
  pageUrl: string,
): string | null {
  if (!value) {
    return null;
  }
  try {
    const absolute = new URL(value, pageUrl).toString();
    if (!isSafeMediaUrl(absolute)) {
      return null;
    }
    return normalizeMediaUrl(absolute);
  } catch {
    return null;
  }
}
