import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import { saveFetchedPageOffline } from '@/browser/capture/offline-pages.service';
import { isIncognitoInFront } from '@/browser/incognito/incognito-state';
import { isValidBrowserPageUrl } from '@/browser/utils';

import {
  ALLOW_ALL,
  MAX_SITE_PAGES,
  pageTitle,
  pageVideoLinks,
  parseRobots,
  robotsAllow,
  SITE_REQUEST_INTERVAL_MS,
  SiteCrawlQueue,
  sitePageLinks,
  type RobotsRules,
  type SiteVideo,
} from './site-grab-core';

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_BYTES = 3 * 1024 * 1024;

export type SiteGrabProgress = {
  /** Pages read so far (robots.txt not counted). */
  read: number;
  /** Pages still waiting (within the limit). */
  waiting: number;
  saved: number;
  /** Pages robots.txt does not allow, skipped. */
  blocked: number;
  failed: number;
  videos: SiteVideo[];
  current: string | null;
};

export type SiteGrabResult = SiteGrabProgress & { outcome: 'done' | 'stopped' | 'unavailable' | 'invalid' | 'incognito' };

type Fetched = { url: string; html: string } | null;

async function fetchText(url: string): Promise<Fetched> {
  const result = await getVidoraMedia()
    .fetchPage({ url, useSessionCookies: false, commitCookies: false, timeoutMs: FETCH_TIMEOUT_MS, maxBytes: FETCH_MAX_BYTES })
    .catch(() => null);
  if (!result || result.kind !== 'document' || result.status < 200 || result.status >= 300) return null;
  return { url: result.finalUrl, html: result.body };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * #486 Site grabber: reads the pages of one site from [startUrl] — breadth first, two links deep, at most 50 pages,
 * one request a second, what robots.txt allows — without cookies (public pages only, like every page VidoraX reads
 * itself). Each page is saved to Saved pages when [saveOffline] is on, and the videos the pages name are collected
 * for the user to pick. Stops when [signal] aborts.
 */
export async function grabSite(
  startUrl: string,
  options: { saveOffline: boolean; signal: AbortSignal; onProgress?: (progress: SiteGrabProgress) => void },
): Promise<SiteGrabResult> {
  const progress: SiteGrabProgress = { read: 0, waiting: 0, saved: 0, blocked: 0, failed: 0, videos: [], current: null };
  if (!isVidoraMediaAvailable()) return { ...progress, outcome: 'unavailable' };
  if (!isValidBrowserPageUrl(startUrl)) return { ...progress, outcome: 'invalid' };
  if (options.saveOffline && isIncognitoInFront()) return { ...progress, outcome: 'incognito' };
  const { signal } = options;
  const report = () => options.onProgress?.({ ...progress, videos: [...progress.videos] });
  let lastRequest = 0;
  const politely = async (url: string): Promise<Fetched> => {
    await wait(lastRequest + SITE_REQUEST_INTERVAL_MS - Date.now(), signal);
    if (signal.aborted) return null;
    lastRequest = Date.now();
    return fetchText(url);
  };

  let robots: RobotsRules = ALLOW_ALL;
  const robotsFile = await politely(new URL('/robots.txt', startUrl).toString());
  if (robotsFile && !/<html[\s>]/i.test(robotsFile.html.slice(0, 1024))) robots = parseRobots(robotsFile.html);

  const queue = new SiteCrawlQueue(startUrl, MAX_SITE_PAGES);
  const seenVideos = new Set<string>();
  const blocked = new Set<string>();
  // A link robots.txt disallows is never read, and does not use up the page limit.
  const offer = (url: string, depth: number) => {
    if (robotsAllow(robots, url)) queue.offer(url, depth);
    else if (!blocked.has(url)) {
      blocked.add(url);
      progress.blocked += 1;
    }
  };
  if (!robotsAllow(robots, startUrl)) {
    progress.blocked = 1;
    report();
    return { ...progress, outcome: 'done' };
  }
  for (let entry = queue.next(); entry && !signal.aborted; entry = queue.next()) {
    progress.current = entry.url;
    progress.waiting = queue.remaining;
    report();
    const page = await politely(entry.url);
    if (signal.aborted) break;
    progress.read += 1;
    if (!page || !/<(?:html|body|a)\b/i.test(page.html)) {
      progress.failed += 1;
      continue;
    }
    for (const video of pageVideoLinks(page.html, page.url)) {
      if (seenVideos.has(video.url)) continue;
      seenVideos.add(video.url);
      progress.videos.push(video);
    }
    for (const link of sitePageLinks(page.html, page.url)) offer(link, entry.depth + 1);
    if (options.saveOffline && (await saveFetchedPageOffline(page.url, page.html, pageTitle(page.html)))) progress.saved += 1;
    progress.waiting = queue.remaining;
    report();
  }
  progress.current = null;
  progress.waiting = 0;
  report();
  return { ...progress, outcome: signal.aborted ? 'stopped' : 'done' };
}
