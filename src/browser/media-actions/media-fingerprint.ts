import { isSameDocumentUrl, normalizeMediaUrl } from '@/media-detection/utils';
import { stableResourcePath } from '@/media-detection/social-source/resource-identity';

/**
 * Stable identity for duplicate download prevention across signed URL refreshes.
 */
export function buildBrowserMediaFingerprint(input: {
  pageUrl: string | null;
  mediaUrl: string;
  platform?: string | null;
}): string {
  const page = input.pageUrl?.trim() ?? '';
  const normalized = normalizeMediaUrl(input.mediaUrl.trim());
  const media = normalized ?? input.mediaUrl.trim();
  const platform = input.platform?.trim().toLowerCase() ?? '';

  let pageKey = page;
  try {
    if (page) {
      const parsed = new URL(page);
      pageKey = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    }
  } catch {
    pageKey = page.toLowerCase();
  }

  let mediaKey = media;
  try {
    const parsed = new URL(media);
    mediaKey = stableResourcePath(parsed.href) ?? media;
  } catch {
    mediaKey = media ?? '';
  }

  return `${platform}|${pageKey}|${mediaKey}`;
}

export function fingerprintsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return Boolean(a && b && a === b);
}

export function pageUrlsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  return isSameDocumentUrl(a, b);
}
