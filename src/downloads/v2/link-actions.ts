/**
 * Re-download (#403) and Copy link (#404) for a finished v2 download: both work from the page the video came from.
 * Re-download opens that page in a browser tab, so detection, verification and duplicate protection run as for any
 * page; Copy link copies it. v2 rows never carry the media file's (signed) URL in JavaScript — see
 * `projectV2Download` — so a row without a page offers neither action.
 */

import type { DownloadStatus } from '@/api/types';
import { isYouTubeLink } from '@/browser/services/pasted-link';
import { isPrivateOrLocalHostname } from '@/media-detection/utils/url';

/** Statuses whose card and details show the link actions. Running, queued and paused downloads do not. */
export const LINK_ACTION_STATUSES: readonly DownloadStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export type DownloadLinkInput = {
  /** True only for rows the v2 engine owns (`isEngineOwned`); v1 rows are left as they are. */
  engineOwned: boolean;
  status: DownloadStatus;
  /** The row's `sourceUrl` — for a v2 row this is the page URL, or '' when the engine recorded none. */
  sourceUrl: string | null | undefined;
};

export type DownloadLinkTarget = {
  /**
   * The page to open in the browser for Re-download; null when the app's rules refuse to open it (YouTube, a
   * private or local address) — Copy link still works then.
   */
  pageUrl: string | null;
  /** What Copy link copies (the page URL). */
  copyUrl: string;
};

/** The http(s) URL in `value`, normalised by the URL parser, or null when it is anything else. */
export function toWebPageUrl(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** The page the link actions use, or null when the row shows neither action. Pure. */
export function resolveDownloadLinkTarget(input: DownloadLinkInput): DownloadLinkTarget | null {
  if (!input.engineOwned || !LINK_ACTION_STATUSES.includes(input.status)) {
    return null;
  }
  const pageUrl = toWebPageUrl(input.sourceUrl);
  if (!pageUrl) {
    return null;
  }
  return { pageUrl: isOpenableInBrowser(pageUrl) ? pageUrl : null, copyUrl: pageUrl };
}

/** The app's refusals for a page Re-download would open: never YouTube, never a private or local address. */
export function isOpenableInBrowser(pageUrl: string): boolean {
  if (isYouTubeLink(pageUrl)) {
    return false;
  }
  try {
    return !isPrivateOrLocalHostname(new URL(pageUrl).hostname);
  } catch {
    return false;
  }
}
