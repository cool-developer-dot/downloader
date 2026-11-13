/**
 * B20 #209 Backup and restore — the browser's data as one JSON file the user keeps (no cloud). Pure.
 *
 * In it: the app settings, and for every profile (guest mode never) its name and colour, its browser settings,
 * bookmarks, history and recent searches. Not in it: open tabs, downloads and the library, App Lock, cookies and
 * site logins (WebView doesn't hand them out, and a file that holds logins would be a risk).
 *
 * The file is untrusted when it comes back: it is parsed, never evaluated, and everything is checked — the format and
 * version, profile ids and names (the profile list's rules), web addresses only (http/https, bounded length), dates,
 * text lengths, and counts ({@link BACKUP_LIMITS}). Settings are only collected here; the settings store's own
 * validation decides them on restore.
 */
import {
  DEFAULT_PROFILE,
  MAX_PROFILES,
  parseProfiles,
  type BrowserProfile,
  type ProfileColor,
} from '@/browser/profiles/profile-registry';

export const BACKUP_FORMAT = 'vidorax.backup';
export const BACKUP_VERSION = 1;

export const BACKUP_LIMITS = {
  bookmarksPerProfile: 10_000,
  historyPerProfile: 20_000,
  searchesPerProfile: 50,
  urlLength: 4096,
  titleLength: 300,
  queryLength: 500,
  settingString: 16_000,
} as const;

/** A backup bigger than this is refused unread (20,000 history entries per profile fit well within it). */
export const MAX_BACKUP_BYTES = 30 * 1024 * 1024;

type Primitive = string | number | boolean;

export type BackupBookmark = { url: string; title: string; createdAt: string };
export type BackupVisit = { url: string; title: string; visitedAt: string };
export type BackupSearch = { query: string; searchedAt: string };

export type BackupProfile = {
  id: string;
  name: string;
  color: ProfileColor;
  browserSettings: Record<string, Primitive>;
  bookmarks: BackupBookmark[];
  history: BackupVisit[];
  searches: BackupSearch[];
};

export type BrowserBackup = {
  exportedAt: string;
  settings: Record<string, Primitive>;
  profiles: BackupProfile[];
};

export type BackupCounts = { profiles: number; bookmarks: number; history: number; searches: number };

export type BackupParse =
  | { ok: true; backup: BrowserBackup; counts: BackupCounts }
  | { ok: false; reason: 'not-json' | 'wrong-format' | 'unsupported-version' };

export function backupJson(backup: BrowserBackup): string {
  return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, ...backup });
}

function isPrimitive(value: unknown): value is Primitive {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function settingsRecord(raw: unknown): Record<string, Primitive> {
  const result: Record<string, Primitive> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length > 64 || !isPrimitive(value)) continue;
    if (typeof value === 'string' && value.length > BACKUP_LIMITS.settingString) continue;
    result[key] = value;
  }
  return result;
}

function webUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (url.length === 0 || url.length > BACKUP_LIMITS.urlLength || !/^https?:\/\/[^\s]+$/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// Control and bidirectional-override characters never belong in a title or search shown back to the user.
const UNPRINTABLE = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

function text(raw: unknown, limit: number): string {
  return typeof raw === 'string' ? raw.replace(UNPRINTABLE, ' ').trim().slice(0, limit) : '';
}

function isoDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const ms = Date.parse(raw);
  // From 1995 to one day ahead: a date outside that is damage, not a visit.
  if (!Number.isFinite(ms) || ms < Date.UTC(1995, 0, 1) || ms > Date.now() + 86_400_000) return null;
  return new Date(ms).toISOString();
}

function list<T>(raw: unknown, limit: number, item: (value: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const result: T[] = [];
  for (const value of raw) {
    if (result.length >= limit) break;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const parsed = item(value as Record<string, unknown>);
    if (parsed) result.push(parsed);
  }
  return result;
}

function parseProfile(raw: Record<string, unknown>, identity: BrowserProfile): BackupProfile {
  return {
    id: identity.id,
    name: identity.name,
    color: identity.color,
    browserSettings: settingsRecord(raw.browserSettings),
    bookmarks: list(raw.bookmarks, BACKUP_LIMITS.bookmarksPerProfile, (b) => {
      const url = webUrl(b.url);
      return url ? { url, title: text(b.title, BACKUP_LIMITS.titleLength), createdAt: isoDate(b.createdAt) ?? new Date(0).toISOString() } : null;
    }),
    history: list(raw.history, BACKUP_LIMITS.historyPerProfile, (v) => {
      const url = webUrl(v.url);
      const visitedAt = isoDate(v.visitedAt);
      return url && visitedAt ? { url, title: text(v.title, BACKUP_LIMITS.titleLength), visitedAt } : null;
    }),
    searches: list(raw.searches, BACKUP_LIMITS.searchesPerProfile, (s) => {
      const query = text(s.query, BACKUP_LIMITS.queryLength);
      const searchedAt = isoDate(s.searchedAt);
      return query && searchedAt ? { query, searchedAt } : null;
    }),
  };
}

export function parseBackup(raw: string): BackupParse {
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'wrong-format' };
  const record = data as Record<string, unknown>;
  if (record.format !== BACKUP_FORMAT || !Array.isArray(record.profiles)) return { ok: false, reason: 'wrong-format' };
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) {
    return { ok: false, reason: 'wrong-format' };
  }
  if (record.version > BACKUP_VERSION) return { ok: false, reason: 'unsupported-version' };

  const rawProfiles = (record.profiles as unknown[]).filter(
    (p): p is Record<string, unknown> => !!p && typeof p === 'object' && !Array.isArray(p),
  );
  // The profile list's own rules decide which identities are valid (default first, no guest, unique names, ≤ 5).
  const identities = parseProfiles(rawProfiles.map((p) => ({ id: p.id, name: p.name, color: p.color, createdAt: 0 })));
  const hasDefault = rawProfiles.some((p) => p.id === DEFAULT_PROFILE);
  const profiles: BackupProfile[] = [];
  for (const identity of identities.slice(0, MAX_PROFILES)) {
    const source = rawProfiles.find((p) => p.id === identity.id);
    if (!source && !(identity.id === DEFAULT_PROFILE && hasDefault)) continue;
    profiles.push(parseProfile(source ?? {}, identity));
  }
  const counts: BackupCounts = {
    profiles: profiles.length,
    bookmarks: profiles.reduce((n, p) => n + p.bookmarks.length, 0),
    history: profiles.reduce((n, p) => n + p.history.length, 0),
    searches: profiles.reduce((n, p) => n + p.searches.length, 0),
  };
  return {
    ok: true,
    backup: {
      exportedAt: isoDate(record.exportedAt) ?? new Date(0).toISOString(),
      settings: settingsRecord(record.settings),
      profiles,
    },
    counts,
  };
}
