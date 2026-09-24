import { stableResourcePath } from '@/media-detection/social-source/resource-identity';
import { useMediaDetectionStore } from '@/media-detection/stores';
import { isSameDocumentUrl, normalizeMediaUrl } from '@/media-detection/utils';

function mediaIdentityKey(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) {
    return null;
  }
  return stableResourcePath(normalizeMediaUrl(trimmed) ?? trimmed);
}

/**
 * The name the live page gives this same media now. An SPA can name its route after the offer was built (the title
 * it showed while pushState ran was the previous route's); detection renames the media when the page does.
 */
export function lookupLiveMediaTitle(input: { pageUrl: string | null; sourceUrl: string }): string | null {
  const targetKey = mediaIdentityKey(input.sourceUrl);
  if (!targetKey) {
    return null;
  }
  for (const media of useMediaDetectionStore.getState().detectedMedia) {
    const candidate = media.finalUrl || media.url;
    if (!candidate || mediaIdentityKey(candidate) !== targetKey) {
      continue;
    }
    if (input.pageUrl && media.pageUrl && !isSameDocumentUrl(media.pageUrl, input.pageUrl)) {
      continue;
    }
    const title = media.title?.trim();
    if (title) {
      return title;
    }
  }
  return null;
}
