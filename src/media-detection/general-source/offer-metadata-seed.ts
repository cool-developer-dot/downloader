import { pageUrlNamesContentId } from '../general-media/general-content-identity';
import type { DetectedMedia } from '../types';

/**
 * The candidate a verified offer takes its title, thumbnail and length from.
 *
 * First the source the ownership pass chose (not whatever the page reported first: on Vimeo a range request with no
 * metadata comes before the player config). When the page's own player data named this page's item (an explicit
 * content id found in the page URL — Vimeo's config `video.id` on `vimeo.com/<id>`), that item's title, thumbnail and
 * length win: the chosen source may be the same stream the player fetched itself, which carries none of them.
 */
export function offerMetadataSeed(
  candidates: readonly DetectedMedia[],
  ownedResourceUrl: string | null | undefined,
  pageUrl: string | null | undefined,
): DetectedMedia {
  const owned = ownedResourceUrl
    ? candidates.find((c) => c.finalUrl === ownedResourceUrl || c.url === ownedResourceUrl)
    : undefined;
  const seed = owned ?? candidates[0]!;
  const named = candidates.find((c) => !c.isDrm && c.contentId && pageUrlNamesContentId(pageUrl, c.contentId));
  if (!named || named === seed) {
    return seed;
  }
  return {
    ...seed,
    title: named.title?.trim() ? named.title : seed.title,
    thumbnailUrl: named.thumbnailUrl ?? seed.thumbnailUrl,
    duration: named.duration ?? seed.duration,
  };
}
