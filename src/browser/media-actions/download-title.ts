import { classifyMediaUrl } from '@/media-detection/direct-analyzer/media-url';

/** The generic title `resolveDownloadTitle` falls back to when detection knew no name for the video. */
export const GENERIC_DOWNLOAD_TITLE = 'Download';

function withoutHash(url: string): string {
  const hash = url.indexOf('#');
  return (hash >= 0 ? url.slice(0, hash) : url).trim();
}

function looksLikeUrl(value: string, pageUrl: string | null): boolean {
  const text = value.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) {
    return true;
  }
  if (!pageUrl) {
    return false;
  }
  const page = withoutHash(pageUrl).toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  return text === page || text === page.replace(/\/$/, '') || text === page.split('/')[0];
}

/**
 * The title a download keeps. Detection names the video when the page has told it a name; when the offer was built
 * before the page's title arrived (a CTA can appear within a second of a reload), the row would be called
 * "Download" for good. The browser tab showing that same page already knows the page's title, so it names the
 * download instead — never a URL (the WebView shows the address as the title while loading), never another page's.
 */
export function pickDownloadTitle(input: {
  resolved: string;
  pageUrl: string | null;
  tabs: readonly { url: string; title: string }[];
}): string {
  if (input.resolved.trim() && input.resolved.trim() !== GENERIC_DOWNLOAD_TITLE) {
    return input.resolved;
  }
  if (!input.pageUrl) {
    return input.resolved;
  }
  const page = withoutHash(input.pageUrl);
  for (const tab of input.tabs) {
    const title = tab.title?.trim();
    if (!title || withoutHash(tab.url) !== page || looksLikeUrl(title, input.pageUrl)) {
      continue;
    }
    return title.slice(0, 255);
  }
  return input.resolved;
}

/** Manifest and file names that say nothing about the video: the folder holding them names it instead. */
const GENERIC_FILE_STEMS = new Set(['', 'master', 'index', 'playlist', 'manifest', 'prog_index', 'stream', 'video', 'media', 'main']);

function stemOf(segment: string): string {
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // keep the raw segment
  }
  return name.replace(/\.[a-z0-9]{1,5}$/i, '').trim();
}

/**
 * A page that is itself a video file or stream (a link typed, pasted or opened directly — Chromium's own media view):
 * its file name, or its folder's for a generic manifest name (`…/bbb_30fps/master.mpd` → "bbb_30fps"). Null for any
 * other page. Such a page has no title of its own, and the tab can still carry the previous page's title (or "Home"
 * after leaving it), so the file name wins over both.
 */
export function directMediaFileTitle(pageUrl: string | null | undefined): string | null {
  if (!pageUrl || classifyMediaUrl(pageUrl)?.strength !== 'strong') {
    return null;
  }
  let segments: string[];
  try {
    segments = new URL(pageUrl).pathname.split('/').filter(Boolean);
  } catch {
    return null;
  }
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const stem = stemOf(segments[index]!);
    if (!GENERIC_FILE_STEMS.has(stem.toLowerCase())) {
      return stem.slice(0, 255);
    }
  }
  return null;
}
