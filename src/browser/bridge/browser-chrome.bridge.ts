import {
  BROWSER_CHROME_CHANNEL,
  type BrowserChromeEnvelope,
  type BrowserChromeMessageType,
} from './browser-chrome.channel';
import { downloadableImageSrc } from '@/browser/capture/capture-core';

/** The page script's own caps (page-link-grabber.ts); repeated here so the bridge never imports app services. */
const PAGE_LINKS_MAX_RAW = 400;
const PAGE_LINK_MAX_LENGTH = 2048;

export type ParsedBrowserChromeMessage =
  | {
      type: 'link_long_press';
      payload: {
        href: string;
        text: string;
        x: number;
        y: number;
        pageUrl: string;
      };
    }
  | {
      type: 'scroll';
      payload: {
        scrollY: number;
        pageUrl: string;
        /** B6: page and window heights (0 when the page did not send them). */
        height: number;
        viewHeight: number;
      };
    }
  | {
      type: 'auto_scroll';
      payload: { event: 'bottom' | 'touched' };
    }
  | {
      type: 'media_state';
      payload: { playing: boolean };
    }
  | {
      /** B13: the kind of request the page made (it was refused in the page). */
      type: 'site_permission';
      payload: { kind: 'location' | 'camera' | 'microphone' | 'notifications' };
    }
  | {
      /** B13: a window the page tried to open without a tap; `url` is null when it had no web address. */
      type: 'popup_blocked';
      payload: { url: string | null };
    }
  | {
      /** B7: where the find is (1-based `current`, 0 when nothing matched) for request `requestId`. */
      type: 'find_result';
      payload: { requestId: number; current: number; total: number; capped: boolean };
    }
  | {
      type: 'pull_to_refresh';
      payload: Record<string, never>;
    }
  | {
      type: 'spa_navigation';
      payload: {
        url: string;
        title: string;
      };
    }
  | {
      /** The page entered or left fullscreen; width/height are the fullscreen video's, when known. */
      type: 'fullscreen';
      payload: {
        active: boolean;
        width: number | null;
        height: number | null;
      };
    }
  | {
      /** Page Link Grabber (#484): the page's answer to one request (`requestId`); links are not yet filtered. */
      type: 'page_links';
      payload: {
        requestId: string;
        pageUrl: string;
        links: string[];
      };
    }
  | {
      type: 'ready';
      payload: Record<string, never>;
    };

const MESSAGE_TYPES = new Set<BrowserChromeMessageType>([
  'link_long_press',
  'scroll',
  'pull_to_refresh',
  'spa_navigation',
  'fullscreen',
  'page_links',
  'auto_scroll',
  'media_state',
  'find_result',
  'site_permission',
  'popup_blocked',
  'ready',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, max = 8_192): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, max);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

/**
 * Parses browser-chrome channel messages.
 * Returns null for media (or other) channels — callers must demux.
 */
export function parseBrowserChromeMessage(
  raw: string | undefined | null,
): ParsedBrowserChromeMessage | null {
  if (!raw || typeof raw !== 'string' || raw.length > 50_000) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const envelope = asRecord(parsed) as Partial<BrowserChromeEnvelope> | null;
  if (!envelope || envelope.channel !== BROWSER_CHROME_CHANNEL) {
    return null;
  }

  const type = envelope.type;
  if (!type || !MESSAGE_TYPES.has(type) || envelope.payload == null) {
    return null;
  }

  const payload = asRecord(envelope.payload);
  if (!payload) {
    return null;
  }

  switch (type) {
    case 'ready':
      return { type: 'ready', payload: {} };
    case 'pull_to_refresh':
      return { type: 'pull_to_refresh', payload: {} };
    case 'scroll': {
      const scrollY = finiteNumber(payload.scrollY);
      if (scrollY == null || scrollY < 0) {
        return null;
      }
      // pageUrl is optional — RN handler prefers browserStore.currentUrl.
      const pageUrl = optionalString(payload.pageUrl, 8_192) ?? '';
      const height = finiteNumber(payload.height);
      const viewHeight = finiteNumber(payload.viewHeight);
      return {
        type: 'scroll',
        payload: {
          scrollY: Math.round(scrollY),
          pageUrl,
          height: height != null && height > 0 ? Math.round(height) : 0,
          viewHeight: viewHeight != null && viewHeight > 0 ? Math.round(viewHeight) : 0,
        },
      };
    }
    case 'auto_scroll': {
      const event = payload.event;
      if (event !== 'bottom' && event !== 'touched') {
        return null;
      }
      return { type: 'auto_scroll', payload: { event } };
    }
    case 'media_state': {
      if (typeof payload.playing !== 'boolean') {
        return null;
      }
      return { type: 'media_state', payload: { playing: payload.playing } };
    }
    case 'site_permission': {
      const kind = payload.kind;
      if (kind !== 'location' && kind !== 'camera' && kind !== 'microphone' && kind !== 'notifications') {
        return null;
      }
      return { type: 'site_permission', payload: { kind } };
    }
    case 'popup_blocked': {
      const raw = optionalString(payload.url, 8_192);
      const lower = raw?.toLowerCase() ?? '';
      const url = raw && (lower.startsWith('https://') || lower.startsWith('http://')) ? raw : null;
      return { type: 'popup_blocked', payload: { url } };
    }
    case 'find_result': {
      // B7: any page can post this — only bounded whole numbers are taken.
      const requestId = finiteNumber(payload.requestId);
      const current = finiteNumber(payload.current);
      const total = finiteNumber(payload.total);
      if (
        requestId == null ||
        current == null ||
        total == null ||
        !Number.isInteger(requestId) ||
        !Number.isInteger(current) ||
        !Number.isInteger(total) ||
        requestId < 0 ||
        total < 0 ||
        total > 100_000 ||
        current < 0 ||
        current > total ||
        (total > 0 && current === 0)
      ) {
        return null;
      }
      return { type: 'find_result', payload: { requestId, current, total, capped: payload.capped === true } };
    }
    case 'link_long_press': {
      const href = optionalString(payload.href, 8_192) || null;
      // B17 #280: an image long-pressed (with or without a link): its http(s) address for "Download image".
      const imageSrc = downloadableImageSrc(payload.imageSrc);
      const pageUrl = optionalString(payload.pageUrl, 8_192) ?? href ?? imageSrc;
      if ((!href && !imageSrc) || !pageUrl) {
        return null;
      }
      // Mirror inject + action-sheet scheme allowlist (defense in depth).
      const lower = (href ?? '').toLowerCase();
      if (
        href &&
        !lower.startsWith('http://') &&
        !lower.startsWith('https://') &&
        !lower.startsWith('mailto:') &&
        !lower.startsWith('tel:')
      ) {
        return null;
      }
      const text = optionalString(payload.text, 500) ?? '';
      const x = finiteNumber(payload.x) ?? 0;
      const y = finiteNumber(payload.y) ?? 0;
      return {
        type: 'link_long_press',
        payload: { href: href ?? '', text, x, y, pageUrl, ...(imageSrc ? { imageSrc } : {}) },
      };
    }
    case 'fullscreen': {
      if (typeof payload.active !== 'boolean') {
        return null;
      }
      const width = finiteNumber(payload.width);
      const height = finiteNumber(payload.height);
      const sized = payload.active && width != null && height != null && width > 0 && height > 0;
      return {
        type: 'fullscreen',
        payload: {
          active: payload.active,
          width: sized ? width : null,
          height: sized ? height : null,
        },
      };
    }
    case 'page_links': {
      const requestId = optionalString(payload.requestId, 64);
      const pageUrl = optionalString(payload.pageUrl, 8_192);
      if (!requestId || !pageUrl || !Array.isArray(payload.links)) {
        return null;
      }
      const links: string[] = [];
      for (const value of payload.links.slice(0, PAGE_LINKS_MAX_RAW)) {
        const link = optionalString(value, PAGE_LINK_MAX_LENGTH);
        if (link) {
          links.push(link);
        }
      }
      return { type: 'page_links', payload: { requestId, pageUrl, links } };
    }
    case 'spa_navigation': {
      const url = optionalString(payload.url, 8_192);
      if (!url) {
        return null;
      }
      const lower = url.toLowerCase();
      if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
        return null;
      }
      const title = optionalString(payload.title, 500) ?? '';
      return { type: 'spa_navigation', payload: { url, title } };
    }
    default:
      return null;
  }
}
