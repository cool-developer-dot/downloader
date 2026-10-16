/**
 * Save Location (#297), Default Folder (#465), SD Card Download (#395), Auto Categorize (#382), Per-type Folder
 * (#383), Per-site Folder (#384). Pure: no React Native, no storage.
 *
 * Model: the library file in app-private storage stays exactly as it is (engine, library database, resume and cleanup
 * depend on it). When the user turns on "Also save a copy to…", every download that completes afterwards also gets
 * an extra copy in a folder they picked with the Android folder picker — any folder the picker offers, an SD card
 * included. Deleting in VidoraX never deletes those copies.
 */

import type { SiteId } from '@modules/vidorax-media/src/VidoraMedia.types';

export type SaveLocationSettings = {
  /** "Also save a copy to…". Default off. */
  enabled: boolean;
  /** The picked folder (a persisted Storage Access Framework tree URI); null until one is picked. */
  treeUri: string | null;
  /** The folder's name as shown to the user. */
  folderName: string | null;
  /** Copies go into Videos / Audio (Auto Categorize #382, Per-type Folder #383). Default off. */
  byType: boolean;
  /** Copies go into a folder per site (#384). Default off. */
  bySite: boolean;
  /** When the copy was last turned on (epoch ms): only downloads completed since then are copied. */
  enabledAt: number | null;
  /** The folder stopped being writable and the option was turned off; shown until a folder is picked again. */
  accessLost: boolean;
};

export const DEFAULT_SAVE_LOCATION: SaveLocationSettings = {
  enabled: false,
  treeUri: null,
  folderName: null,
  byType: false,
  bySite: false,
  enabledAt: null,
  accessLost: false,
};

const MAX_URI_LENGTH = 2048;

function isTreeUri(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_URI_LENGTH && /^content:\/\/[^/]+\/tree\/./.test(value);
}

/** Whatever was stored (or imported), as settings: unknown fields fall back to today's behaviour (off). */
export function normalizeSaveLocation(raw: unknown): SaveLocationSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SAVE_LOCATION };
  }
  const value = raw as Record<string, unknown>;
  const treeUri = isTreeUri(value.treeUri) ? value.treeUri : null;
  const folderName = typeof value.folderName === 'string' ? sanitizeFolderName(value.folderName) || null : null;
  const enabledAt =
    typeof value.enabledAt === 'number' && Number.isFinite(value.enabledAt) && value.enabledAt > 0 ? value.enabledAt : null;
  const enabled = value.enabled === true && treeUri !== null;
  return {
    enabled,
    treeUri,
    folderName: treeUri ? folderName : null,
    byType: value.byType === true,
    bySite: value.bySite === true,
    // Without it, only the catch-up pass waits; completions seen live are still copied.
    enabledAt,
    accessLost: value.accessLost === true && !enabled,
  };
}

export type SaveLocationAction =
  /** A folder was picked (turning the copy on, or Change). */
  | { type: 'picked'; treeUri: string; folderName: string | null; now: number }
  /** The switch. Turning on without a folder does nothing: the picker comes first. */
  | { type: 'set-enabled'; enabled: boolean; now: number }
  | { type: 'set-by-type'; value: boolean }
  | { type: 'set-by-site'; value: boolean }
  /** Remove: forget the folder (its grant is given back) and turn the copy off. */
  | { type: 'remove' }
  /** The folder can no longer be written: turn off and say so. */
  | { type: 'access-lost' }
  | { type: 'dismiss-access-lost' };

/** Pure: the settings after one user choice. */
export function reduceSaveLocation(state: SaveLocationSettings, action: SaveLocationAction): SaveLocationSettings {
  switch (action.type) {
    case 'picked': {
      if (!isTreeUri(action.treeUri)) {
        return state;
      }
      const folderName = (action.folderName && sanitizeFolderName(action.folderName)) || folderLabelFromTreeUri(action.treeUri);
      return {
        ...state,
        enabled: true,
        treeUri: action.treeUri,
        folderName,
        // Changing the folder keeps the moment the copy was turned on; turning it on starts now.
        enabledAt: state.enabled && state.enabledAt ? state.enabledAt : action.now,
        accessLost: false,
      };
    }
    case 'set-enabled':
      if (action.enabled) {
        if (!state.treeUri || state.enabled) {
          return state;
        }
        return { ...state, enabled: true, enabledAt: action.now, accessLost: false };
      }
      return state.enabled ? { ...state, enabled: false } : state;
    case 'set-by-type':
      return state.byType === action.value ? state : { ...state, byType: action.value };
    case 'set-by-site':
      return state.bySite === action.value ? state : { ...state, bySite: action.value };
    case 'remove':
      return { ...state, enabled: false, treeUri: null, folderName: null, accessLost: false };
    case 'access-lost':
      return { ...state, enabled: false, treeUri: null, folderName: null, accessLost: true };
    case 'dismiss-access-lost':
      return state.accessLost ? { ...state, accessLost: false } : state;
    default:
      return state;
  }
}

// --- folder names ---

/** Longest folder name made here, in code points (letters of any script stay whole). */
export const MAX_FOLDER_NAME_LENGTH = 60;

/** Characters no file system (Android, an SD card's FAT/exFAT, a PC) accepts in a name, and control characters. */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
/** Direction overrides and invisible formatting that could disguise a name. */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

/**
 * A safe folder name: illegal characters become spaces, invisible direction marks go, whitespace collapses, and
 * leading/trailing spaces and dots go (so "." and ".." are never names and no folder is hidden). Letters of every
 * script — Urdu, Arabic, CJK — are kept as they are. Empty when nothing usable is left.
 */
export function sanitizeFolderName(raw: string): string {
  const cleaned = raw.replace(INVISIBLE, '').replace(ILLEGAL, ' ').replace(/\s+/g, ' ');
  const trimmed = cleaned.replace(/^[\s.]+|[\s.]+$/g, '');
  const points = Array.from(trimmed);
  return (points.length > MAX_FOLDER_NAME_LENGTH ? points.slice(0, MAX_FOLDER_NAME_LENGTH).join('') : trimmed).replace(
    /[\s.]+$/g,
    '',
  );
}

/** Folder names for Per-type Folder. Fixed English names, so switching the app's language never splits a folder. */
export const TYPE_FOLDERS = { video: 'Videos', audio: 'Audio' } as const;

/** The same names the Gallery copy uses (`Movies/VidoraX/<Site>`, SiteId.folderName in Kotlin). */
const SITE_FOLDERS: Record<SiteId, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  twitter: 'X',
  reddit: 'Reddit',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion',
  twitch: 'Twitch',
  pinterest: 'Pinterest',
  snapchat: 'Snapchat',
  linkedin: 'LinkedIn',
  web: 'Web',
};

/** A named site's folder, else the page's host without `www.` (generic websites), else "Web". */
export function siteFolderName(site: SiteId | string | null | undefined, pageUrl: string | null | undefined): string {
  if (site && site !== 'web' && site in SITE_FOLDERS) {
    return SITE_FOLDERS[site as SiteId];
  }
  if (pageUrl) {
    try {
      const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
      const name = sanitizeFolderName(host);
      if (name) {
        return name;
      }
    } catch {
      // fall through
    }
  }
  return SITE_FOLDERS.web;
}

export type CopyTarget = { mimeType: string; site: SiteId | string | null; pageUrl: string | null };

/** Pure: the subfolders of the picked folder a copy goes into — type first, then site; none with both options off. */
export function copySubfolders(settings: Pick<SaveLocationSettings, 'byType' | 'bySite'>, item: CopyTarget): string[] {
  const folders: string[] = [];
  if (settings.byType) {
    folders.push(item.mimeType.toLowerCase().startsWith('audio/') ? TYPE_FOLDERS.audio : TYPE_FOLDERS.video);
  }
  if (settings.bySite) {
    folders.push(siteFolderName(item.site, item.pageUrl));
  }
  return folders;
}

/**
 * A readable name for a picked folder from its URI alone (`…/tree/primary%3AMovies%2FVidoraX` → "Movies/VidoraX"),
 * for when the provider does not say. Null when the URI says nothing readable.
 */
export function folderLabelFromTreeUri(treeUri: string): string | null {
  const match = /\/tree\/([^/?#]+)/.exec(treeUri);
  if (!match) {
    return null;
  }
  let documentId: string;
  try {
    documentId = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  const colon = documentId.indexOf(':');
  const path = colon >= 0 ? documentId.slice(colon + 1) : documentId;
  const parts = path
    .split('/')
    .map(sanitizeFolderName)
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join('/') : null;
}

// --- per-item records ---

/** Where a library item's copy went, kept so Show in Folder can open it. Never the media bytes or a page URL. */
export type ExternalCopyRecord =
  | { status: 'copied'; folderUri: string; documentUri: string; name: string; folderLabel: string | null; at: number }
  | { status: 'failed'; reason: 'storage' | 'access'; at: number };

export type ExternalCopyRecords = Record<string, ExternalCopyRecord>;

/** Records kept at most (oldest dropped first): a few hundred bytes each. */
export const MAX_COPY_RECORDS = 2000;

/** Pure: the records with `id` set, capped at MAX_COPY_RECORDS by age. */
export function withCopyRecord(records: ExternalCopyRecords, id: string, record: ExternalCopyRecord): ExternalCopyRecords {
  if (!id) {
    return records;
  }
  const next: ExternalCopyRecords = { ...records, [id]: record };
  const ids = Object.keys(next);
  if (ids.length <= MAX_COPY_RECORDS) {
    return next;
  }
  const oldestFirst = ids.sort((a, b) => next[a]!.at - next[b]!.at);
  for (const drop of oldestFirst.slice(0, ids.length - MAX_COPY_RECORDS)) {
    if (drop !== id) {
      delete next[drop];
    }
  }
  return next;
}

/** Pure: the records without `ids` (items deleted from VidoraX; their copies themselves are never touched). */
export function withoutCopyRecords(records: ExternalCopyRecords, ids: readonly string[]): ExternalCopyRecords {
  if (!ids.some((id) => Object.prototype.hasOwnProperty.call(records, id))) {
    return records;
  }
  const next = { ...records };
  for (const id of ids) {
    delete next[id];
  }
  return next;
}

/** Whatever was stored, as records: anything malformed is dropped. */
export function normalizeCopyRecords(raw: unknown): ExternalCopyRecords {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: ExternalCopyRecords = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const record = value as Record<string, unknown>;
    const at = typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : null;
    if (at === null) {
      continue;
    }
    if (
      record.status === 'copied' &&
      typeof record.folderUri === 'string' &&
      record.folderUri.startsWith('content://') &&
      typeof record.documentUri === 'string' &&
      record.documentUri.startsWith('content://') &&
      typeof record.name === 'string'
    ) {
      out[id] = {
        status: 'copied',
        folderUri: record.folderUri,
        documentUri: record.documentUri,
        name: record.name,
        folderLabel: typeof record.folderLabel === 'string' ? record.folderLabel : null,
        at,
      };
    } else if (record.status === 'failed' && (record.reason === 'storage' || record.reason === 'access')) {
      out[id] = { status: 'failed', reason: record.reason, at };
    }
  }
  return out;
}

/** The folder Show in Folder opens for an item, or null when it has no external copy (the action is hidden). */
export function showInFolderTarget(
  record: ExternalCopyRecord | null | undefined,
): { folderUri: string; folderLabel: string | null; name: string } | null {
  return record?.status === 'copied'
    ? { folderUri: record.folderUri, folderLabel: record.folderLabel, name: record.name }
    : null;
}

/** Copies a catch-up pass starts at most; the rest follow on the next pass. */
export const MAX_CATCH_UP = 20;

/**
 * Pure: library items that completed while the copy was on but got no copy yet (they finished while no JavaScript
 * ran, e.g. in the background), oldest first. Items with a record — copied or failed — are never retried here.
 */
export function pendingCopyIds(
  items: readonly { id: string; completedAt: number }[],
  records: ExternalCopyRecords,
  settings: Pick<SaveLocationSettings, 'enabled' | 'treeUri' | 'enabledAt'>,
  busy: ReadonlySet<string> = new Set(),
): string[] {
  if (!settings.enabled || !settings.treeUri || !settings.enabledAt) {
    return [];
  }
  const since = settings.enabledAt;
  return items
    .filter((item) => item.completedAt >= since && !records[item.id] && !busy.has(item.id))
    .sort((a, b) => a.completedAt - b.completedAt)
    .slice(0, MAX_CATCH_UP)
    .map((item) => item.id);
}
