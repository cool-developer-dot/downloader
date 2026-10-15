/**
 * Download history (H13): what the Downloads list holds for v2 downloads, as data to export (JSON, CSV) and as an
 * error log. Pure. Rows carry the page URL only — never a media URL — and even that is exported without query
 * parameters that look like credentials or signatures, and without its fragment.
 */

import type { DownloadItem } from '@/api/types';

export const HISTORY_FORMAT = 'vidorax.downloadHistory';
export const HISTORY_VERSION = 1;

/** Query parameter names (or prefixes ending in `*`) that can carry a credential, a session or a signature. */
const SENSITIVE_PARAMS = [
  'token', 'access_token', 'refresh_token', 'id_token', 'auth', 'authorization', 'key', 'api_key', 'apikey',
  'sig', 'signature', 'expires', 'exp', 'oe', 'oh', 'session', 'sessionid', 'sid', 'cookie', 'policy', 'hmac',
  'hash', 'nonce', 'ticket', 'jwt', 'code', 'state', 'password', 'pass', 'secret', 'credential', 'x-amz-*',
  'x-goog-*', '_nc_*', 'efg', 'ccb', 'dl', 'fbclid', 'gclid',
];

function isSensitiveParam(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_PARAMS.some((entry) =>
    entry.endsWith('*') ? lower.startsWith(entry.slice(0, -1)) : lower === entry,
  );
}

/** A page URL safe to put in a file: http(s) only, no credentials, no sensitive query parameters, no fragment. */
export function sanitizePageUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url.trim());
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      return null;
    }
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    for (const name of [...parsed.searchParams.keys()]) {
      if (isSensitiveParam(name)) {
        parsed.searchParams.delete(name);
      }
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/** The host of a URL (no `www.`), or null. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || null;
  } catch {
    return null;
  }
}

/** Replaces every URL in free text with its host, so a log line never carries a path, query or token. */
export function redactUrls(text: string): string {
  return text.replace(/\b(?:blob:)?[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi, (match) => {
    if (/^blob:/i.test(match)) {
      return '[blob]';
    }
    const host = hostOf(match);
    return host ? `[${host}]` : '[url]';
  });
}

export type HistoryStatus = 'completed' | 'failed' | 'cancelled' | 'queued' | 'downloading' | 'paused';

export type HistoryRecord = {
  id: string;
  title: string;
  site: string | null;
  status: HistoryStatus;
  quality: string | null;
  sizeBytes: number | null;
  createdAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  error: string | null;
  pageUrl: string | null;
};

const STATUS: Record<string, HistoryStatus> = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  PAUSED: 'paused',
};

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null;
}

function sizeOrNull(value: string | null | undefined): number | null {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? Math.trunc(size) : null;
}

/** Pure: the Downloads list's rows as history records, newest first. */
export function toHistoryRecords(items: readonly DownloadItem[]): HistoryRecord[] {
  return items
    .map((item) => ({
      id: item.id,
      title: item.title?.trim() || item.fileName?.trim() || '',
      site: hostOf(item.sourceUrl) ?? (item.platform ? item.platform.toLowerCase() : null),
      status: STATUS[item.status] ?? 'queued',
      quality: item.quality?.trim() || null,
      sizeBytes: sizeOrNull(item.fileSize),
      createdAt: isoOrNull(item.createdAt),
      finishedAt:
        item.status === 'COMPLETED' ? isoOrNull(item.downloadedAt) : item.status === 'FAILED' || item.status === 'CANCELLED' ? isoOrNull(item.updatedAt) : null,
      errorCode: item.status === 'FAILED' ? item.errorCode ?? null : null,
      error: item.status === 'FAILED' ? item.errorMessage ?? null : null,
      pageUrl: sanitizePageUrl(item.sourceUrl),
    }))
    .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0));
}

export function historyToJson(records: readonly HistoryRecord[], exportedAt: Date): string {
  return JSON.stringify(
    { format: HISTORY_FORMAT, version: HISTORY_VERSION, exportedAt: exportedAt.toISOString(), items: records },
    null,
    2,
  );
}

const CSV_COLUMNS: (keyof HistoryRecord)[] = [
  'id', 'title', 'site', 'status', 'quality', 'sizeBytes', 'createdAt', 'finishedAt', 'errorCode', 'error', 'pageUrl',
];

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvCell(value: unknown): string {
  if (value == null) {
    return '';
  }
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a header row; CRLF line ends; a BOM so spreadsheet apps read Urdu titles as UTF-8. */
export function historyToCsv(records: readonly HistoryRecord[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const record of records) {
    lines.push(CSV_COLUMNS.map((column) => csvCell(record[column])).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export type ErrorLogEntry = { id: string; at: string | null; site: string | null; title: string; reason: string };

/** Pure: the failed downloads, newest first, with a readable reason. */
export function toErrorLog(items: readonly DownloadItem[], fallbackReason: string): ErrorLogEntry[] {
  return items
    .filter((item) => item.status === 'FAILED')
    .map((item) => ({
      id: item.id,
      at: isoOrNull(item.updatedAt) ?? isoOrNull(item.createdAt),
      site: hostOf(item.sourceUrl) ?? (item.platform ? item.platform.toLowerCase() : null),
      title: item.title?.trim() || '',
      reason: item.errorMessage?.trim() || fallbackReason,
    }))
    .sort((a, b) => (Date.parse(b.at ?? '') || 0) - (Date.parse(a.at ?? '') || 0));
}

/** The error log as plain text to share. No URLs: the site is a host name. */
export function errorLogToText(entries: readonly ErrorLogEntry[], header: string): string {
  const lines = [header, ''];
  for (const entry of entries) {
    lines.push(`${entry.at ?? '—'} · ${entry.site ?? '—'} · ${redactUrls(entry.title)}`);
    lines.push(`  ${redactUrls(entry.reason)}`);
  }
  return lines.join('\n');
}

/** Pure: which rows Clear History removes — finished, failed and cancelled ones. */
export function clearableHistoryIds(items: readonly Pick<DownloadItem, 'id' | 'status'>[]): string[] {
  return items
    .filter((item) => item.status === 'COMPLETED' || item.status === 'FAILED' || item.status === 'CANCELLED')
    .map((item) => item.id);
}

/**
 * Pure: the ids still clearable right now. The list was taken when the dialog opened; a row retried or resumed
 * since must not be removed (removing an unfinished download cancels it).
 */
export function stillClearableIds(
  ids: readonly string[],
  statusOf: (id: string) => DownloadItem['status'] | null | undefined,
): string[] {
  return ids.filter((id) => {
    const status = statusOf(id);
    return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
  });
}
