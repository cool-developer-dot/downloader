import { BROWSER_HOMEPAGE, BROWSER_WEBVIEW_BLANK } from '@/browser/constants';
import { isBrowserHomeUrl } from '@/browser/utils';
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvRemove, mmkvSetObject } from '@/storage/mmkv';
import { getPersistStorageAdapter } from '@/store/shared/persist-storage';

import type {
  BrowserSessionSnapshotInput,
  PersistedBrowserSession,
} from './session.types';
import { stripSensitiveAuthQueryParams } from './session-url-sanitizer';

const SESSION_STORAGE_KEY = mmkvKeys.browserSession;
const MAX_SCROLL_ENTRIES = 24;

const EMPTY_SESSION: PersistedBrowserSession = {
  url: BROWSER_HOMEPAGE,
  title: '',
  lastSuccessfulUrl: null,
  lastSuccessfulTitle: '',
  scrollY: 0,
  scrollPositions: {},
  updatedAt: 0,
};

let memoryCache: PersistedBrowserSession | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWrite: PersistedBrowserSession | null = null;
/** When true, the pending write must also hit the async persist adapter. */
let pendingDurable = false;

const WRITE_DEBOUNCE_MS = 250;
/** Scroll-only path can wait longer — in-memory map stays hot for restore. */
const SCROLL_WRITE_DEBOUNCE_MS = 750;

type PersistWriteMode = 'full' | 'mmkv';

function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** True when a URL is safe to restore into the WebView. */
export function isRestorableBrowserUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }

  if (
    trimmed === BROWSER_WEBVIEW_BLANK ||
    trimmed === 'about:blank' ||
    trimmed.startsWith('about:') ||
    isBrowserHomeUrl(trimmed)
  ) {
    return false;
  }

  return isHttpUrl(trimmed);
}

function sanitizeScrollPositions(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const safeKey = stripSensitiveAuthQueryParams(key);
    if (!isRestorableBrowserUrl(safeKey)) {
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      continue;
    }
    result[safeKey] = Math.round(value);
    if (Object.keys(result).length >= MAX_SCROLL_ENTRIES) {
      break;
    }
  }
  return result;
}

function upsertScrollPosition(
  positions: Record<string, number>,
  url: string,
  scrollY: number,
): Record<string, number> {
  const safeUrl = stripSensitiveAuthQueryParams(url);
  const next = { ...positions, [safeUrl]: Math.max(0, Math.round(scrollY)) };
  const keys = Object.keys(next);
  if (keys.length <= MAX_SCROLL_ENTRIES) {
    return next;
  }

  // Drop oldest insertion-order keys (LRU-ish for plain objects).
  const trimmed: Record<string, number> = {};
  for (const key of keys.slice(keys.length - MAX_SCROLL_ENTRIES)) {
    trimmed[key] = next[key]!;
  }
  return trimmed;
}

function sanitizeSession(raw: unknown): PersistedBrowserSession | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Partial<PersistedBrowserSession>;
  const rawUrl = typeof obj.url === 'string' ? obj.url.trim() : '';
  const url = isBrowserHomeUrl(rawUrl)
    ? rawUrl
    : stripSensitiveAuthQueryParams(rawUrl);
  const title = typeof obj.title === 'string' ? obj.title.slice(0, 255) : '';
  const lastSuccessfulRaw =
    typeof obj.lastSuccessfulUrl === 'string' && obj.lastSuccessfulUrl.trim()
      ? obj.lastSuccessfulUrl.trim()
      : null;
  const lastSuccessfulUrl = lastSuccessfulRaw
    ? stripSensitiveAuthQueryParams(lastSuccessfulRaw)
    : null;
  const lastSuccessfulTitle =
    typeof obj.lastSuccessfulTitle === 'string'
      ? obj.lastSuccessfulTitle.slice(0, 255)
      : '';
  const scrollY =
    typeof obj.scrollY === 'number' && Number.isFinite(obj.scrollY) && obj.scrollY >= 0
      ? Math.round(obj.scrollY)
      : 0;
  const scrollPositions = sanitizeScrollPositions(obj.scrollPositions);
  const updatedAt =
    typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
      ? obj.updatedAt
      : Date.now();

  if (!url) {
    return null;
  }

  if (!isBrowserHomeUrl(url) && !isRestorableBrowserUrl(url)) {
    if (!isRestorableBrowserUrl(lastSuccessfulUrl)) {
      return null;
    }
    return {
      url: lastSuccessfulUrl!,
      title: lastSuccessfulTitle,
      lastSuccessfulUrl,
      lastSuccessfulTitle,
      scrollY,
      scrollPositions,
      updatedAt,
    };
  }

  return {
    url: isBrowserHomeUrl(url) ? BROWSER_HOMEPAGE : url,
    title,
    lastSuccessfulUrl: isRestorableBrowserUrl(lastSuccessfulUrl)
      ? lastSuccessfulUrl
      : null,
    lastSuccessfulTitle: isRestorableBrowserUrl(lastSuccessfulUrl)
      ? lastSuccessfulTitle
      : '',
    scrollY: isRestorableBrowserUrl(lastSuccessfulUrl) ? scrollY : 0,
    scrollPositions,
    updatedAt,
  };
}

function readSyncFromMmkv(): PersistedBrowserSession | null {
  const raw = mmkvGetObject<PersistedBrowserSession>(SESSION_STORAGE_KEY);
  return sanitizeSession(raw);
}

function clearWriteTimer(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
}

async function writeToStorage(session: PersistedBrowserSession): Promise<void> {
  mmkvSetObject(SESSION_STORAGE_KEY, session);

  try {
    const storage = getPersistStorageAdapter();
    await Promise.resolve(storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session)));
  } catch {
    // Persistence is best-effort — browsing must never throw.
  }
}

function writeMmkvOnly(session: PersistedBrowserSession): void {
  mmkvSetObject(SESSION_STORAGE_KEY, session);
}

/**
 * Debounced session write.
 * - `full`: MMKV + async adapter (navigate / success / flush)
 * - `mmkv`: MMKV only (scroll hot path); durable adapter catches up on flush
 */
function scheduleWrite(session: PersistedBrowserSession, mode: PersistWriteMode = 'full'): void {
  memoryCache = session;
  pendingWrite = session;
  if (mode === 'full') {
    pendingDurable = true;
  }

  clearWriteTimer();

  const delay = mode === 'mmkv' && !pendingDurable ? SCROLL_WRITE_DEBOUNCE_MS : WRITE_DEBOUNCE_MS;

  writeTimer = setTimeout(() => {
    writeTimer = null;
    const next = pendingWrite;
    const durable = pendingDurable;
    pendingWrite = null;
    pendingDurable = false;
    if (!next) {
      return;
    }
    if (durable) {
      void writeToStorage(next);
    } else {
      writeMmkvOnly(next);
    }
  }, delay);
}

/**
 * Synchronous hydrate for cold start (MMKV path).
 * Returns null when MMKV is unavailable — caller may async-hydrate.
 */
export function readBrowserSessionSync(): PersistedBrowserSession | null {
  if (memoryCache) {
    return memoryCache;
  }
  const session = readSyncFromMmkv();
  memoryCache = session;
  return session;
}

export async function readBrowserSession(): Promise<PersistedBrowserSession | null> {
  const sync = readBrowserSessionSync();
  if (sync) {
    return sync;
  }

  try {
    const storage = getPersistStorageAdapter();
    const raw = await Promise.resolve(storage.getItem(SESSION_STORAGE_KEY));
    if (!raw) {
      return null;
    }
    const parsed = sanitizeSession(JSON.parse(raw) as unknown);
    memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function getCachedBrowserSession(): PersistedBrowserSession | null {
  return memoryCache ?? readBrowserSessionSync();
}

export function getPersistedScrollForUrl(url: string): number {
  const safeUrl = stripSensitiveAuthQueryParams(url);
  if (!isRestorableBrowserUrl(safeUrl)) {
    return 0;
  }
  const session = getCachedBrowserSession();
  if (!session) {
    return 0;
  }
  if (typeof session.scrollPositions[safeUrl] === 'number') {
    return session.scrollPositions[safeUrl]!;
  }
  if (session.lastSuccessfulUrl === safeUrl) {
    return session.scrollY;
  }
  return 0;
}

/**
 * Persists a browsing snapshot. Only `successful: true` updates lastSuccessful*.
 */
export function persistBrowserSession(input: BrowserSessionSnapshotInput): void {
  const previous = getCachedBrowserSession() ?? EMPTY_SESSION;
  const rawUrl = input.url.trim();
  const url = isBrowserHomeUrl(rawUrl)
    ? rawUrl
    : stripSensitiveAuthQueryParams(rawUrl);
  const isHome = isBrowserHomeUrl(url);
  const successful = Boolean(input.successful) && isRestorableBrowserUrl(url);
  const scrollY = Math.max(0, Math.round(input.scrollY ?? 0));

  let scrollPositions = previous.scrollPositions;
  if (successful) {
    scrollPositions = upsertScrollPosition(scrollPositions, url, scrollY);
  }

  const next: PersistedBrowserSession = {
    url: isHome ? BROWSER_HOMEPAGE : isRestorableBrowserUrl(url) ? url : previous.url,
    title: (input.title ?? previous.title).slice(0, 255),
    lastSuccessfulUrl: successful ? url : previous.lastSuccessfulUrl,
    lastSuccessfulTitle: successful
      ? (input.title ?? '').slice(0, 255)
      : previous.lastSuccessfulTitle,
    scrollY: successful
      ? scrollY
      : isRestorableBrowserUrl(url) && url === previous.lastSuccessfulUrl
        ? Math.max(0, Math.round(input.scrollY ?? previous.scrollY))
        : previous.scrollY,
    scrollPositions,
    updatedAt: Date.now(),
  };

  scheduleWrite(next, 'full');
}

export function updatePersistedScrollPosition(url: string, scrollY: number): void {
  const safeUrl = stripSensitiveAuthQueryParams(url);
  if (!isRestorableBrowserUrl(safeUrl)) {
    return;
  }

  const previous = getCachedBrowserSession();
  if (!previous) {
    return;
  }

  const y = Math.max(0, Math.round(scrollY));
  const prior = previous.scrollPositions[safeUrl] ?? previous.scrollY;
  if (
    Math.abs(y - prior) < 2 &&
    previous.url !== safeUrl &&
    previous.lastSuccessfulUrl !== safeUrl
  ) {
    return;
  }

  scheduleWrite(
    {
      ...previous,
      scrollY:
        previous.lastSuccessfulUrl === safeUrl || previous.url === safeUrl
          ? y
          : previous.scrollY,
      scrollPositions: upsertScrollPosition(previous.scrollPositions, safeUrl, y),
      updatedAt: Date.now(),
    },
    'mmkv',
  );
}

export function clearPersistedBrowserSession(): void {
  memoryCache = null;
  pendingWrite = null;
  pendingDurable = false;
  clearWriteTimer();
  mmkvRemove(SESSION_STORAGE_KEY);
  try {
    const storage = getPersistStorageAdapter();
    void Promise.resolve(storage.removeItem(SESSION_STORAGE_KEY));
  } catch {
    // no-op
  }
}

/** Flush pending debounced writes (call on background). */
export function flushBrowserSessionPersistence(): void {
  clearWriteTimer();
  pendingDurable = false;
  if (pendingWrite) {
    const next = pendingWrite;
    pendingWrite = null;
    void writeToStorage(next);
    return;
  }
  // Ensure latest in-memory session is durable even if debounce already fired as MMKV-only.
  if (memoryCache) {
    void writeToStorage(memoryCache);
  }
}

/**
 * Resolves the URL that should be restored into the engine.
 * Prefers current restorable URL, then lastSuccessfulUrl. Never restores home as a page.
 */
export function resolveRestorableSessionUrl(
  session: PersistedBrowserSession | null,
): { url: string; title: string; scrollY: number } | null {
  if (!session) {
    return null;
  }

  if (isRestorableBrowserUrl(session.url)) {
    return {
      url: session.url,
      title: session.title,
      scrollY:
        session.scrollPositions[session.url] ??
        (session.url === session.lastSuccessfulUrl ? session.scrollY : 0),
    };
  }

  if (isRestorableBrowserUrl(session.lastSuccessfulUrl)) {
    const url = session.lastSuccessfulUrl!;
    return {
      url,
      title: session.lastSuccessfulTitle,
      scrollY: session.scrollPositions[url] ?? session.scrollY,
    };
  }

  return null;
}
