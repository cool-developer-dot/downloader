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
