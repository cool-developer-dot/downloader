import {
  BROWSER_HOMEPAGE,
  BROWSER_WEBVIEW_BLANK,
} from '@/browser/constants';
import { isBrowserHomeUrl } from '@/browser/utils';
import { historyService } from '@/storage/services';
import type { BrowserHistoryEntry } from '@/storage/types';

const RECORDABLE_PROTOCOLS = new Set(['http:', 'https:']);

/** In-memory guard against recording the same URL while a write is in flight. */
const pendingUrls = new Set<string>();

/** Last successfully recorded URL + timestamp for client-side refresh coalescing. */
let lastRecordedUrl: string | null = null;
let lastRecordedAt = 0;

const CLIENT_DEDUP_WINDOW_MS = 5 * 60 * 1000;

export type RecordableVisitInput = {
  url: string;
  title?: string | null;
  hasError?: boolean;
};

export function isRecordableHistoryUrl(url: string): boolean {
  const trimmed = url.trim();

  if (!trimmed) {
    return false;
  }

  if (
    trimmed === BROWSER_WEBVIEW_BLANK ||
    trimmed === 'about:blank' ||
    isBrowserHomeUrl(trimmed) ||
    trimmed.startsWith('vidorax://') ||
    trimmed.startsWith('about:')
  ) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return RECORDABLE_PROTOCOLS.has(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeTitle(title: string | null | undefined, url: string): string {
  const trimmed = title?.trim();
  if (trimmed) {
    return trimmed.slice(0, 255);
  }

  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/**
 * Records a successful browser navigation into the history module.
 * Safe to call from engine events — never throws to the UI layer.
 */
export async function recordSuccessfulVisit(
  input: RecordableVisitInput,
): Promise<BrowserHistoryEntry | null> {
  if (input.hasError) {
    return null;
  }

  if (!isRecordableHistoryUrl(input.url)) {
    return null;
  }

  const url = input.url.trim();
  const now = Date.now();

  if (
    lastRecordedUrl === url &&
    now - lastRecordedAt < CLIENT_DEDUP_WINDOW_MS
  ) {
    return null;
  }

  if (pendingUrls.has(url)) {
    return null;
  }

  pendingUrls.add(url);

  try {
    const entry = await historyService.recordVisit({
      url,
      title: normalizeTitle(input.title, url),
      visitedAt: new Date().toISOString(),
    });

    lastRecordedUrl = url;
    lastRecordedAt = now;

    return entry;
  } catch {
    return null;
  } finally {
    pendingUrls.delete(url);
  }
}

export function resetHistoryRecordingGuards(): void {
  pendingUrls.clear();
  lastRecordedUrl = null;
  lastRecordedAt = 0;
}

/** @internal Exported for tests / diagnostics. */
export const historyRecordingService = {
  isRecordableHistoryUrl,
  recordSuccessfulVisit,
  resetHistoryRecordingGuards,
  homepage: BROWSER_HOMEPAGE,
} as const;
