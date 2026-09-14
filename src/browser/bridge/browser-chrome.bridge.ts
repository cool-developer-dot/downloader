import {
  BROWSER_CHROME_CHANNEL,
  type BrowserChromeEnvelope,
  type BrowserChromeMessageType,
} from './browser-chrome.channel';

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
      };
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
      type: 'ready';
      payload: Record<string, never>;
    };

const MESSAGE_TYPES = new Set<BrowserChromeMessageType>([
  'link_long_press',
  'scroll',
  'pull_to_refresh',
  'spa_navigation',
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
      return {
        type: 'scroll',
        payload: { scrollY: Math.round(scrollY), pageUrl },
      };
    }
    case 'link_long_press': {
      const href = optionalString(payload.href, 8_192);
      const pageUrl = optionalString(payload.pageUrl, 8_192) ?? href;
      if (!href || !pageUrl) {
        return null;
      }
      // Mirror inject + action-sheet scheme allowlist (defense in depth).
      const lower = href.toLowerCase();
      if (
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
        payload: { href, text, x, y, pageUrl },
      };
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
