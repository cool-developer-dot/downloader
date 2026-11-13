/**
 * Page Link Grabber (#484): the video files the page in the active tab links or plays, to download several at once
 * through Batch Add (#292). The page only reports URLs (`<a href>`, `<video>`/`<source>`); here the media classifier
 * keeps those that name a video file or stream, and the app's rules (YouTube, private or local hosts) apply before
 * anything is fetched. Batch Add then checks each one exactly like a pasted link — nothing starts without the user.
 */

import { BROWSER_CHROME_CHANNEL } from '@/browser/bridge/browser-chrome.channel';
import { classifyMediaUrl, resolvePageUrl, resourceKey } from '@/media-detection/direct-analyzer/media-url';

import { classifyIntakeLink, MAX_BATCH_LINKS } from './link-intake';

/** What the page script sends at most: URLs, their length, and the whole message (the bridge reads ≤ 50,000). */
export const PAGE_LINKS_MAX_RAW = 400;
export const PAGE_LINK_MAX_LENGTH = 2048;
const PAGE_LINKS_MAX_CHARS = 40_000;

/**
 * The script that asks the page for its links. Fixed text: only `requestId` (made by the app) is interpolated. It
 * reads the main document (a cross-origin frame's links are not readable), pre-filters by file extension or a MIME
 * hint in the query so the message stays small, and answers once on the browser-chrome channel.
 */
export function buildPageLinkGrabberScript(requestId: string): string {
  return `(function(){
  try {
    var MAX = ${PAGE_LINKS_MAX_RAW};
    var MAX_LEN = ${PAGE_LINK_MAX_LENGTH};
    var MAX_CHARS = ${PAGE_LINKS_MAX_CHARS};
    var MEDIA = /\\.(?:mp4|m4v|f4v|mov|webm|mkv|3gp|3g2|avi|divx|wmv|flv|ogv|mpg|mpeg|vob|m3u8|mpd)$/i;
    var HINT = /[?&](?:mime_?type|mime|type|format|content_?type)=/i;
    var links = [];
    var seen = {};
    var chars = 0;
    function add(value, always) {
      if (links.length >= MAX || typeof value !== 'string') return;
      var url = value.trim();
      if (!url || url.length > MAX_LEN || seen[url]) return;
      var lower = url.toLowerCase();
      if (lower.indexOf('http://') !== 0 && lower.indexOf('https://') !== 0) return;
      if (!always) {
        var path = url.split('#')[0];
        var query = path.indexOf('?') >= 0 ? path.slice(path.indexOf('?')) : '';
        path = path.split('?')[0];
        if (!MEDIA.test(path) && !HINT.test(query)) return;
      }
      if (chars + url.length > MAX_CHARS) return;
      seen[url] = true;
      chars += url.length;
      links.push(url);
    }
    var media = document.querySelectorAll('video, audio, source');
    for (var i = 0; i < media.length; i++) {
      var node = media[i];
      add(node.currentSrc, true);
      add(node.src, true);
    }
    var anchors = document.querySelectorAll('a[href], area[href]');
    for (var j = 0; j < anchors.length && links.length < MAX; j++) {
      add(anchors[j].href, false);
    }
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        channel: ${JSON.stringify(BROWSER_CHROME_CHANNEL)},
        type: 'page_links',
        payload: { requestId: ${JSON.stringify(requestId)}, pageUrl: String(location.href), links: links },
        ts: Date.now()
      }));
    }
  } catch (e) {}
  return true;
})();`;
}

/**
 * Pure: the links Batch Add receives — absolute http(s) video files and streams (`classifyMediaUrl`), allowed by
 * the app's rules, one per resource (signature-only differences are the same file), in page order, at most `max`.
 */
export function selectGrabbedLinks(raw: readonly unknown[], pageUrl: string, max = MAX_BATCH_LINKS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (out.length >= max) {
      break;
    }
    if (typeof value !== 'string') {
      continue;
    }
    const url = resolvePageUrl(value, pageUrl);
    if (!url || url.length > PAGE_LINK_MAX_LENGTH) {
      continue;
    }
    if (classifyMediaUrl(url)?.strength !== 'strong' || classifyIntakeLink(url) !== 'ok') {
      continue;
    }
    const key = resourceKey(url);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(url);
  }
  return out;
}

type PendingGrab = { resolve: (links: string[] | null) => void; timer: ReturnType<typeof setTimeout> };

const pending = new Map<string, PendingGrab>();
let sequence = 0;

/** Called by the browser-chrome bridge with a page's answer; false when no grab is waiting for that id. */
export function receivePageLinks(requestId: string, pageUrl: string, links: readonly string[]): boolean {
  const waiting = pending.get(requestId);
  if (!waiting) {
    return false;
  }
  pending.delete(requestId);
  clearTimeout(waiting.timer);
  waiting.resolve(selectGrabbedLinks(links, pageUrl));
  return true;
}

export type PageScriptTarget = { injectJavaScript: (script: string) => void };

/**
 * Asks `target` (the active tab's WebView) for its video links. Resolves with the selected links ([] when the page
 * has none), or null when the page did not answer within `timeoutMs` (still loading, or no page script ran).
 */
export function grabPageLinks(target: PageScriptTarget | null | undefined, timeoutMs = 4_000): Promise<string[] | null> {
  if (!target) {
    return Promise.resolve(null);
  }
  sequence += 1;
  const requestId = `grab-${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve(null);
    }, timeoutMs);
    pending.set(requestId, { resolve, timer });
    try {
      target.injectJavaScript(buildPageLinkGrabberScript(requestId));
    } catch {
      pending.delete(requestId);
      clearTimeout(timer);
      resolve(null);
    }
  });
}
