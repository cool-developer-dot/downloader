/**
 * Backup Queue (#462), Export Queue (#502), Import Queue (#503). Pure.
 *
 * Export: queued, running, paused and failed v2 downloads as a versioned JSON file — each one's source page, title
 * and the quality that was chosen. A running download is written as a pending (`queued`) item with the same fields. No media URL, cookie or token is ever written (rows carry no media URL; the page URL is
 * exported without credential/signature parameters).
 *
 * Import: the file is validated (format, version, size); each item is then refused (YouTube, private/local hosts —
 * the app's existing rules), skipped as a duplicate (a download or library item from the same page, or an earlier
 * item of the same file), invalid, or added. Added items are only remembered as pages to reopen: they go back in
 * through the normal add path (the page opens in the browser, detection offers the video, the engine's duplicate
 * check applies). Nothing is ever written into the download engine.
 */

import type { DownloadItem } from '@/api/types';
import { isYouTubeLink } from '@/browser/services/pasted-link';
import { isPrivateOrLocalHostname } from '@/media-detection/utils/url';

import { sanitizePageUrl } from './download-history';

export const QUEUE_FORMAT = 'vidorax.downloadQueue';
export const QUEUE_VERSION = 1;
export const MAX_QUEUE_ITEMS = 500;
const MAX_TITLE_CHARS = 200;
const MAX_QUALITY_CHARS = 40;

export type QueueBackupItem = {
  pageUrl: string;
  title: string;
  quality: string | null;
  status: 'queued' | 'paused' | 'failed';
};

const EXPORTED_STATUS: Partial<Record<string, QueueBackupItem['status']>> = {
  QUEUED: 'queued',
  // A running download is saved as pending: on import it is a page to reopen, like any other item.
  DOWNLOADING: 'queued',
  PAUSED: 'paused',
  FAILED: 'failed',
};

/** Pure: the rows a queue backup holds, and how many were left out because they have no source page. */
export function queueBackupItems(rows: readonly DownloadItem[]): { items: QueueBackupItem[]; withoutPage: number } {
  const items: QueueBackupItem[] = [];
  let withoutPage = 0;
  for (const row of rows) {
    const status = EXPORTED_STATUS[row.status];
    if (!status) {
      continue;
    }
    const pageUrl = sanitizePageUrl(row.sourceUrl);
    if (!pageUrl) {
      withoutPage += 1;
      continue;
    }
    items.push({
      pageUrl,
      title: (row.title?.trim() || '').slice(0, MAX_TITLE_CHARS),
      quality: row.quality?.trim().slice(0, MAX_QUALITY_CHARS) || null,
      status,
    });
  }
  return { items, withoutPage };
}

export function queueToJson(items: readonly QueueBackupItem[], exportedAt: Date): string {
  return JSON.stringify({ format: QUEUE_FORMAT, version: QUEUE_VERSION, exportedAt: exportedAt.toISOString(), items }, null, 2);
}

export type QueueParseResult =
  | { ok: true; items: unknown[] }
  | { ok: false; reason: 'not-json' | 'wrong-format' | 'unsupported-version' | 'too-many' };

/** Pure: the file's items, or why the file is not a queue backup this version reads. */
export function parseQueueBackup(text: string): QueueParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'wrong-format' };
  }
  const record = data as Record<string, unknown>;
  if (record.format !== QUEUE_FORMAT || !Array.isArray(record.items)) {
    return { ok: false, reason: 'wrong-format' };
  }
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1 || record.version > QUEUE_VERSION) {
    return { ok: false, reason: 'unsupported-version' };
  }
  if (record.items.length > MAX_QUEUE_ITEMS) {
    return { ok: false, reason: 'too-many' };
  }
  return { ok: true, items: record.items };
}

/** The key two page URLs are compared by: host without `www.` (lower case), path without trailing slash, query. */
export function pageKey(url: string | null | undefined): string | null {
  const sanitized = sanitizePageUrl(url);
  if (!sanitized) {
    return null;
  }
  const parsed = new URL(sanitized);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${host}${path}${parsed.search}`;
}

export type ImportedQueueItem = { key: string; pageUrl: string; title: string; quality: string | null };

export type QueueImportPlan = {
  added: ImportedQueueItem[];
  duplicates: number;
  refused: number;
  invalid: number;
};

type Refusal = 'refused' | 'invalid' | null;

function refusalFor(pageUrl: string): Refusal {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return 'invalid';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'refused';
  }
  // The app's own rules: YouTube is never downloaded; private and local addresses are never fetched (SSRF guard).
  if (isYouTubeLink(pageUrl) || !parsed.hostname || isPrivateOrLocalHostname(parsed.hostname)) {
    return 'refused';
  }
  return null;
}

/**
 * Pure: what importing `rawItems` does, given the page URLs the user already has (downloads and library items).
 */
export function planQueueImport(rawItems: readonly unknown[], existingPageUrls: readonly (string | null | undefined)[]): QueueImportPlan {
  const plan: QueueImportPlan = { added: [], duplicates: 0, refused: 0, invalid: 0 };
  const seen = new Set<string>();
  for (const url of existingPageUrls) {
    const key = pageKey(url);
    if (key) {
      seen.add(key);
    }
  }
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      plan.invalid += 1;
      continue;
    }
    const item = raw as Record<string, unknown>;
    const rawUrl = typeof item.pageUrl === 'string' ? item.pageUrl.trim() : '';
    if (!rawUrl || rawUrl.length > 4096) {
      plan.invalid += 1;
      continue;
    }
    // A scheme other than http(s) is refused before anything else looks at it.
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawUrl) && !/^https?:/i.test(rawUrl)) {
      plan.refused += 1;
      continue;
    }
    const refusal = refusalFor(rawUrl);
    if (refusal === 'invalid') {
      plan.invalid += 1;
      continue;
    }
    if (refusal === 'refused') {
      plan.refused += 1;
      continue;
    }
    const pageUrl = sanitizePageUrl(rawUrl);
    const key = pageKey(rawUrl);
    if (!pageUrl || !key) {
      plan.invalid += 1;
      continue;
    }
    if (seen.has(key)) {
      plan.duplicates += 1;
      continue;
    }
    seen.add(key);
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, MAX_TITLE_CHARS) : '';
    const quality = typeof item.quality === 'string' ? item.quality.trim().slice(0, MAX_QUALITY_CHARS) || null : null;
    plan.added.push({ key, pageUrl, title, quality });
  }
  return plan;
}
