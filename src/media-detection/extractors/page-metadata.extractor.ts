import type { BridgePageMetaPayload, PageMediaMetadata } from '../types';
import { derivePlatformHint, isSafeMediaUrl, normalizeMediaUrl } from '../utils';

export function extractPageMetadata(
  payload: BridgePageMetaPayload,
): PageMediaMetadata | null {
  const pageUrl = normalizeMediaUrl(payload.pageUrl);
  if (!pageUrl) {
    return null;
  }

  return {
    pageUrl,
    title: sanitizeText(payload.title),
    description: sanitizeText(payload.description),
    ogImage: safeOptionalUrl(payload.ogImage, pageUrl),
    ogVideo: safeOptionalUrl(payload.ogVideo, pageUrl),
    canonicalUrl: safeOptionalUrl(payload.canonicalUrl, pageUrl),
    websiteSource: derivePlatformHint(pageUrl),
    updatedAt: Date.now(),
  };
}

function sanitizeText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().slice(0, 500);
  return trimmed || null;
}

function safeOptionalUrl(
  value: string | null | undefined,
  pageUrl: string,
): string | null {
  if (!value) {
    return null;
  }
  try {
    const absolute = new URL(value, pageUrl).toString();
    return isSafeMediaUrl(absolute) ? normalizeMediaUrl(absolute) : null;
  } catch {
    return null;
  }
}
