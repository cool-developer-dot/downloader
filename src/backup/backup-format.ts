/**
 * P11 #700 Backup / Restore ("to keep settings safe") — VidoraX's own data as one versioned JSON file the user keeps
 * (saved where they pick, or shared; no cloud). Pure: nothing here reads the phone, so the format, the checks and the
 * version rules are tested.
 *
 * In it (`sections`):
 * - `settings`: the app's settings, exactly what Settings Backup (#471, `src/store/settings/backup.ts`) carries, checked
 *   the same way.
 * - `preferences`: the Player's and the Library's choices kept in the key-value store, an explicit allow-list
 *   (`backup-preferences.ts`): seek step, fit per video, notch area, info overlay, subtitle style and per-video
 *   subtitle choices, End of Playback, saved A-B loops, Auto Play Next, Next Episode Prompt, gestures, custom
 *   controls, Disable History, hidden folders, list / grid, Block screenshots in Private.
 * - `playlists` (P7) with their videos, `videoBookmarks` and `playStats` (P9): the app database's rows.
 *
 * Never in it: videos or any other media file, anything of Private (its videos, their names, where they are), App Lock
 * (PIN, recovery code, fingerprint unlock), the play queue, the downloads and the library themselves, the browser's
 * data (B20 has its own backup, `vidorax.backup`).
 *
 * - `files` (F17, version 2): the File Manager's folders, item tags and notes, bin and low space settings
 *   (files-section.ts).
 *
 * Versions: this is version 2 of `vidorax.appBackup` (v2 added `files`; a v1 file is read as before). A file from a
 * newer VidoraX is refused, never half-read. A Settings Backup file (`vidorax.settings` v1, the older format) is read
 * as a backup holding settings only.
 */

import { normalizePlaylistName } from '@/playlists/playlist-names';
import { MAX_BOOKMARKS_PER_VIDEO, normalizeBookmarkName } from '@/player/video-bookmarks';
import { parseSettingsBackup, SETTINGS_BACKUP_FORMAT, SETTINGS_BACKUP_VERSION } from '@/store/settings/backup';

import { preferenceCounts, readBackupPreferences } from './backup-preferences';
import { filesBackupCounts, readBackupFiles, type BackupFiles } from './files-section';

export const APP_BACKUP_FORMAT = 'vidorax.appBackup';
export const APP_BACKUP_VERSION = 2;
/** B20's browser backup: told apart, so the user is sent to the right place. */
export const BROWSER_BACKUP_FORMAT = 'vidorax.backup';

/** A file bigger than this is refused unread. */
export const MAX_APP_BACKUP_BYTES = 20 * 1024 * 1024;

export const APP_BACKUP_LIMITS = {
  playlists: 1000,
  itemsPerPlaylist: 10_000,
  videoBookmarks: 50_000,
  playStats: 100_000,
  mediaIdLength: 512,
  titleLength: 300,
} as const;

type Primitive = string | number | boolean;

export type BackupPlaylistItem = {
  mediaId: string;
  position: number;
  title: string;
  fileName: string;
  durationSeconds: number | null;
  addedAt: string;
};

export type BackupPlaylist = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  items: BackupPlaylistItem[];
};

export type BackupVideoBookmark = {
  id: string;
  mediaId: string;
  positionMs: number;
  name: string | null;
  createdAt: string;
};

export type BackupPlayStat = { mediaId: string; playCount: number; lastPlayedAt: string | null };

export type AppBackupSections = {
  settings?: Record<string, Primitive>;
  preferences?: Record<string, unknown>;
  playlists?: BackupPlaylist[];
  videoBookmarks?: BackupVideoBookmark[];
  playStats?: BackupPlayStat[];
  /** F17 (v2): the File Manager's data. */
  files?: BackupFiles;
};

export type AppBackup = {
  /** `app`: a `vidorax.appBackup` file; `settings`: an older Settings Backup file (settings only). */
  source: 'app' | 'settings';
  /** The version the file was written in. */
  fileVersion: number;
  exportedAt: string | null;
  sections: AppBackupSections;
};

export type SectionName = keyof AppBackupSections;
export const SECTION_NAMES: readonly SectionName[] = ['settings', 'preferences', 'playlists', 'videoBookmarks', 'playStats', 'files'];

/** Pure: the file's text. Sections that are missing are left out (an empty list is written as one). */
export function appBackupJson(sections: AppBackupSections, exportedAt: Date): string {
  const out: Record<string, unknown> = {};
  for (const name of SECTION_NAMES) {
    if (sections[name] !== undefined) {
      out[name] = sections[name];
    }
  }
  return JSON.stringify(
    { format: APP_BACKUP_FORMAT, version: APP_BACKUP_VERSION, exportedAt: exportedAt.toISOString(), sections: out },
    null,
    2,
  );
}

export type AppBackupParse =
  | { ok: true; backup: AppBackup; ignored: string[] }
  | { ok: false; reason: 'not-json' | 'wrong-format' | 'newer-version' | 'browser-backup' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null;
}

function mediaIdOf(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const id = value.trim();
  return id.length > 0 && id.length <= APP_BACKUP_LIMITS.mediaIdLength ? id : null;
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 ? value.trim() : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, APP_BACKUP_LIMITS.titleLength) : '';
}

function readPlaylistItems(raw: unknown): BackupPlaylistItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const items: BackupPlaylistItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || items.length >= APP_BACKUP_LIMITS.itemsPerPlaylist) {
      continue;
    }
    const mediaId = mediaIdOf(entry.mediaId);
    const addedAt = isoOrNull(entry.addedAt);
    if (!mediaId || !addedAt || seen.has(mediaId)) {
      continue;
    }
    seen.add(mediaId);
    const duration = entry.durationSeconds;
    items.push({
      mediaId,
      position: typeof entry.position === 'number' && Number.isFinite(entry.position) ? entry.position : items.length,
      title: text(entry.title),
      fileName: text(entry.fileName),
      durationSeconds: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null,
      addedAt,
    });
  }
  // Positions 0, 1, 2… in the file's order of position.
  return items
    .sort((a, b) => a.position - b.position)
    .map((item, index) => ({ ...item, position: index }));
}

/** A file's playlists, checked: an id, a name (the playlist rules), dates; at most one entry per video. */
export function readBackupPlaylists(raw: unknown): BackupPlaylist[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: BackupPlaylist[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || out.length >= APP_BACKUP_LIMITS.playlists) {
      continue;
    }
    const id = idOf(entry.id);
    const name = typeof entry.name === 'string' ? normalizePlaylistName(entry.name) : '';
    const createdAt = isoOrNull(entry.createdAt);
    if (!id || !name || !createdAt || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      name,
      createdAt,
      updatedAt: isoOrNull(entry.updatedAt) ?? createdAt,
      items: readPlaylistItems(entry.items),
    });
  }
  return out;
}

/** A file's video bookmarks, checked; at most `MAX_BOOKMARKS_PER_VIDEO` per video, one per id. */
export function readBackupVideoBookmarks(raw: unknown): BackupVideoBookmark[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const ids = new Set<string>();
  const perVideo = new Map<string, number>();
  const out: BackupVideoBookmark[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || out.length >= APP_BACKUP_LIMITS.videoBookmarks) {
      continue;
    }
    const id = idOf(entry.id);
    const mediaId = mediaIdOf(entry.mediaId);
    const createdAt = isoOrNull(entry.createdAt);
    const position = entry.positionMs;
    if (!id || !mediaId || !createdAt || ids.has(id) || typeof position !== 'number' || !Number.isFinite(position)) {
      continue;
    }
    const count = perVideo.get(mediaId) ?? 0;
    if (count >= MAX_BOOKMARKS_PER_VIDEO) {
      continue;
    }
    ids.add(id);
    perVideo.set(mediaId, count + 1);
    out.push({
      id,
      mediaId,
      positionMs: Math.max(0, Math.round(position)),
      name: normalizeBookmarkName(typeof entry.name === 'string' ? entry.name : null),
      createdAt,
    });
  }
  return out;
}

/** A file's play counts, checked: one per video, a whole count above 0. */
export function readBackupPlayStats(raw: unknown): BackupPlayStat[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: BackupPlayStat[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || out.length >= APP_BACKUP_LIMITS.playStats) {
      continue;
    }
    const mediaId = mediaIdOf(entry.mediaId);
    const count = entry.playCount;
    if (!mediaId || seen.has(mediaId) || typeof count !== 'number' || !Number.isFinite(count) || count < 1) {
      continue;
    }
    seen.add(mediaId);
    out.push({ mediaId, playCount: Math.min(1_000_000, Math.floor(count)), lastPlayedAt: isoOrNull(entry.lastPlayedAt) });
  }
  return out;
}

function settingsFrom(raw: unknown, defaults: Readonly<Record<string, unknown>>) {
  // Checked exactly as a Settings Backup file is (only known keys, of the right type, allowed choices, clamped).
  const parsed = parseSettingsBackup(
    JSON.stringify({ format: SETTINGS_BACKUP_FORMAT, version: SETTINGS_BACKUP_VERSION, settings: raw }),
    defaults,
  );
  return parsed.ok ? parsed : { values: {}, ignored: [] as string[] };
}

/**
 * Pure: a backup file read back. `settingsDefaults` are the app's setting defaults (the settings store's), which say
 * which settings exist. Unknown sections and values are listed as ignored, never applied.
 */
export function parseAppBackup(text: string, settingsDefaults: Readonly<Record<string, unknown>>): AppBackupParse {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!isRecord(data)) {
    return { ok: false, reason: 'wrong-format' };
  }
  if (data.format === BROWSER_BACKUP_FORMAT) {
    return { ok: false, reason: 'browser-backup' };
  }
  if (data.format === SETTINGS_BACKUP_FORMAT) {
    // The older format: settings only.
    const parsed = parseSettingsBackup(text, settingsDefaults);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason === 'unsupported-version' ? 'newer-version' : 'wrong-format' };
    }
    return {
      ok: true,
      backup: {
        source: 'settings',
        fileVersion: typeof data.version === 'number' ? data.version : SETTINGS_BACKUP_VERSION,
        exportedAt: isoOrNull(data.exportedAt),
        sections: { settings: parsed.values },
      },
      ignored: parsed.ignored.map((key) => `settings.${key}`),
    };
  }
  if (data.format !== APP_BACKUP_FORMAT) {
    return { ok: false, reason: 'wrong-format' };
  }
  const version = data.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'wrong-format' };
  }
  if (version > APP_BACKUP_VERSION) {
    return { ok: false, reason: 'newer-version' };
  }
  if (!isRecord(data.sections)) {
    return { ok: false, reason: 'wrong-format' };
  }
  const raw = data.sections;
  const sections: AppBackupSections = {};
  const ignored: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!(SECTION_NAMES as readonly string[]).includes(key)) {
      ignored.push(key);
    }
  }
  if (raw.settings !== undefined) {
    const settings = settingsFrom(raw.settings, settingsDefaults);
    sections.settings = settings.values;
    ignored.push(...settings.ignored.map((key) => `settings.${key}`));
  }
  if (raw.preferences !== undefined) {
    const preferences = readBackupPreferences(raw.preferences);
    sections.preferences = preferences.values;
    ignored.push(...preferences.ignored.map((key) => `preferences.${key}`));
  }
  if (raw.playlists !== undefined) {
    sections.playlists = readBackupPlaylists(raw.playlists);
  }
  if (raw.videoBookmarks !== undefined) {
    sections.videoBookmarks = readBackupVideoBookmarks(raw.videoBookmarks);
  }
  if (raw.playStats !== undefined) {
    sections.playStats = readBackupPlayStats(raw.playStats);
  }
  if (raw.files !== undefined) {
    sections.files = readBackupFiles(raw.files);
  }
  return {
    ok: true,
    backup: { source: 'app', fileVersion: version, exportedAt: isoOrNull(data.exportedAt), sections },
    ignored,
  };
}

export type BackupPreviewRow =
  | { section: 'settings'; count: number }
  | { section: 'preferences'; count: number }
  | { section: 'loops'; count: number }
  | { section: 'hiddenFolders'; count: number }
  | { section: 'playlists'; count: number; videos: number }
  | { section: 'videoBookmarks'; count: number }
  | { section: 'playStats'; count: number }
  | { section: 'files'; count: number; items: number };

export type BackupPreview = {
  rows: BackupPreviewRow[];
  exportedAt: string | null;
  /** An older Settings Backup file: settings only. */
  settingsOnly: boolean;
  /** Nothing to restore at all. */
  empty: boolean;
};

/** Pure: what the restore preview lists — every section the file has, with its counts. */
export function backupPreview(backup: AppBackup): BackupPreview {
  const { sections } = backup;
  const rows: BackupPreviewRow[] = [];
  if (sections.settings) {
    rows.push({ section: 'settings', count: Object.keys(sections.settings).length });
  }
  if (sections.preferences) {
    const counts = preferenceCounts(sections.preferences);
    rows.push({ section: 'preferences', count: counts.choices });
    rows.push({ section: 'loops', count: counts.loops });
    rows.push({ section: 'hiddenFolders', count: counts.hiddenFolders });
  }
  if (sections.playlists) {
    rows.push({
      section: 'playlists',
      count: sections.playlists.length,
      videos: sections.playlists.reduce((total, playlist) => total + playlist.items.length, 0),
    });
  }
  if (sections.videoBookmarks) {
    rows.push({ section: 'videoBookmarks', count: sections.videoBookmarks.length });
  }
  if (sections.playStats) {
    rows.push({ section: 'playStats', count: sections.playStats.length });
  }
  if (sections.files) {
    const counts = filesBackupCounts(sections.files);
    rows.push({ section: 'files', count: counts.folders, items: counts.items });
  }
  return {
    rows,
    exportedAt: backup.exportedAt,
    settingsOnly: backup.source === 'settings',
    empty: rows.every((row) => row.count === 0),
  };
}
