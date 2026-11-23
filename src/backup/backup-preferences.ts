/**
 * P11 #700 Backup — the key-value (MMKV) part: an explicit allow-list of the Player's and the Library's preferences,
 * each read through its own package's normalizer (the same check as when the app starts), and how a backup's value
 * joins the phone's (Merge) or takes its place (Replace). Pure.
 *
 * Only the keys listed in `BACKUP_PREFERENCES` are ever read or written. In particular never: App Lock (its PIN and
 * recovery code are in SecureStore, `vidorax.appLock.v1`; "Unlock with fingerprint" is `vidorax.appLockBiometric.v1`),
 * Private (`vidorax.privateVault.v1`, and nothing of the vault), the play queue (what is playing now), first-run and
 * migration flags, and the browser's data (B20 has its own backup).
 */

import { DEFAULT_LIBRARY_VIEW_MODE } from '@/library/constants';
import { normalizeExcludedFolderIds } from '@/library/folder-exclusion';
import { LIBRARY_VIEW_MODES } from '@/library/types';
import { DEFAULT_CONTROLS_LAYOUT, normalizeControlsLayout } from '@/player/controls-layout';
import { DEFAULT_DURATION_LABEL_MODE, isDurationLabelMode } from '@/player/duration-label';
import { DEFAULT_END_OF_PLAYBACK_ACTION, normalizeEndOfPlaybackAction } from '@/player/end-of-playback';
import { DEFAULT_GESTURE_SETTINGS, normalizeGestureSettings } from '@/player/gesture-settings';
import { readSavedLoopRecords, type SavedLoop, type SavedLoopRecords } from '@/player/saved-loops';
import { DEFAULT_SEEK_STEP_SECONDS, normalizeSeekStepSeconds } from '@/player/seek-step';
import {
  EMPTY_SUBTITLE_RECORD,
  isEmptySubtitleRecord,
  readSubtitleRecords,
  subtitleRecordFor,
  type SubtitleRecords,
  type VideoSubtitleRecord,
} from '@/player/subtitles/subtitle-record';
import { DEFAULT_SUBTITLE_STYLE, normalizeSubtitleStyle } from '@/player/subtitles/subtitle-style';
import { readRememberedFits, rememberFit, type RememberedFits } from '@/player/video-display';
import { mmkvKeys } from '@/storage/constants';

export type PreferenceStorage = 'string' | 'number' | 'boolean' | 'json';

/**
 * How a backup's value meets the phone's:
 * - `value`: one app-wide choice. Merge and Replace both take the backup's.
 * - `fits`: P2's fit per video. Merge: the backup's fit for the videos it names, the phone's for the rest.
 * - `loops`: P5's saved A-B loops per video. Merge: the phone's loops plus the backup's that aren't there yet (the same
 *   loop is the same id or the same A and B).
 * - `subtitleChoices`: P3 / P4's subtitle choices per video (the track, the second track, the sync offset), without
 *   the subtitle files themselves (they are files on the phone). Merge: the backup's choices for the videos it names;
 *   a subtitle file chosen on the phone stays chosen.
 * - `folderSet`: P9's hidden folders. Merge: both lists.
 * Replace: the backup's list, or for subtitle choices the backup's choices (the phone keeps its subtitle files, and
 * videos the backup doesn't name lose their choices).
 */
export type PreferenceMerge = 'value' | 'fits' | 'loops' | 'subtitleChoices' | 'folderSet';

export type PreferenceSpec = {
  key: string;
  storage: PreferenceStorage;
  merge: PreferenceMerge;
  /** The value as kept, or `undefined` when `raw` isn't one (never applied). */
  read: (raw: unknown) => unknown;
  /** What Replace sets when the backup doesn't carry the key. */
  defaultValue: unknown;
};

const bool = (raw: unknown) => (typeof raw === 'boolean' ? raw : undefined);
const oneOf =
  <T extends string>(choices: readonly T[]) =>
  (raw: unknown) =>
    typeof raw === 'string' && (choices as readonly string[]).includes(raw) ? (raw as T) : undefined;
const listOrUndefined = <T>(read: (raw: unknown) => readonly T[]) => (raw: unknown) =>
  Array.isArray(raw) ? read(raw) : undefined;

/** P3 / P4: a video's subtitle choices without its files (a file choice can't travel without the file). */
export function subtitleChoicesOf(record: VideoSubtitleRecord): VideoSubtitleRecord {
  const primary = record.primary?.kind === 'file' ? null : record.primary;
  const choices: VideoSubtitleRecord = { primary, files: [], offsetMs: record.offsetMs };
  if (record.secondary?.kind === 'off') {
    choices.secondary = { kind: 'off' };
  }
  return choices;
}

/** P3 / P4: the subtitle choices in a backup (or on the phone, for a backup), files left out. */
export function readSubtitleChoices(raw: unknown): SubtitleRecords {
  return readSubtitleRecords(raw)
    .map(([id, record]) => [id, subtitleChoicesOf(record)] as const)
    .filter(([, record]) => !isEmptySubtitleRecord(record));
}

export const BACKUP_PREFERENCES: readonly PreferenceSpec[] = [
  // P1
  {
    key: mmkvKeys.playerDurationLabelMode,
    storage: 'string',
    merge: 'value',
    read: (raw) => (isDurationLabelMode(raw) ? raw : undefined),
    defaultValue: DEFAULT_DURATION_LABEL_MODE,
  },
  {
    key: mmkvKeys.playerSeekStepSeconds,
    storage: 'number',
    merge: 'value',
    read: (raw) => (typeof raw === 'number' && Number.isFinite(raw) ? normalizeSeekStepSeconds(raw) : undefined),
    defaultValue: DEFAULT_SEEK_STEP_SECONDS,
  },
  // P2
  { key: mmkvKeys.playerVideoFits, storage: 'json', merge: 'fits', read: listOrUndefined(readRememberedFits), defaultValue: [] },
  { key: mmkvKeys.playerFillCutout, storage: 'boolean', merge: 'value', read: bool, defaultValue: false },
  { key: mmkvKeys.playerInfoOverlay, storage: 'boolean', merge: 'value', read: bool, defaultValue: false },
  // P3 / P4
  {
    key: mmkvKeys.playerSubtitles,
    storage: 'json',
    merge: 'subtitleChoices',
    read: listOrUndefined(readSubtitleChoices),
    defaultValue: [],
  },
  { key: mmkvKeys.playerSubtitleAutoDetect, storage: 'boolean', merge: 'value', read: bool, defaultValue: true },
  {
    key: mmkvKeys.playerSubtitleStyle,
    storage: 'json',
    merge: 'value',
    read: (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? normalizeSubtitleStyle(raw) : undefined),
    defaultValue: DEFAULT_SUBTITLE_STYLE,
  },
  // P5
  {
    key: mmkvKeys.playerEndOfPlayback,
    storage: 'string',
    merge: 'value',
    read: (raw) => (typeof raw === 'string' ? normalizeEndOfPlaybackAction(raw) : undefined),
    defaultValue: DEFAULT_END_OF_PLAYBACK_ACTION,
  },
  { key: mmkvKeys.playerSavedLoops, storage: 'json', merge: 'loops', read: listOrUndefined(readSavedLoopRecords), defaultValue: [] },
  // P6 (the queue itself is left out: it is what is playing now)
  { key: mmkvKeys.playerAutoPlayNext, storage: 'boolean', merge: 'value', read: bool, defaultValue: false },
  { key: mmkvKeys.playerNextEpisodePrompt, storage: 'boolean', merge: 'value', read: bool, defaultValue: true },
  // P8
  {
    key: mmkvKeys.playerGestures,
    storage: 'json',
    merge: 'value',
    read: (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? normalizeGestureSettings(raw) : undefined),
    defaultValue: DEFAULT_GESTURE_SETTINGS,
  },
  {
    key: mmkvKeys.playerControlsLayout,
    storage: 'json',
    merge: 'value',
    read: (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? normalizeControlsLayout(raw) : undefined),
    defaultValue: DEFAULT_CONTROLS_LAYOUT,
  },
  // P9
  { key: mmkvKeys.playerDisableHistory, storage: 'boolean', merge: 'value', read: bool, defaultValue: false },
  {
    key: mmkvKeys.libraryExcludedFolders,
    storage: 'json',
    merge: 'folderSet',
    read: listOrUndefined(normalizeExcludedFolderIds),
    defaultValue: [],
  },
  // The Library's list / grid
  {
    key: mmkvKeys.libraryViewMode,
    storage: 'string',
    merge: 'value',
    read: oneOf(LIBRARY_VIEW_MODES),
    defaultValue: DEFAULT_LIBRARY_VIEW_MODE,
  },
  // P11 #689
  { key: mmkvKeys.privacyBlockScreenCapture, storage: 'boolean', merge: 'value', read: bool, defaultValue: false },
];

const SPECS = new Map(BACKUP_PREFERENCES.map((spec) => [spec.key, spec]));

export function preferenceSpec(key: string): PreferenceSpec | null {
  return SPECS.get(key) ?? null;
}

/**
 * Kept out of every backup on purpose (a test checks none is in the allow-list): App Lock, Private, the queue, and
 * flags that describe this install rather than a choice.
 */
export const NEVER_IN_BACKUP: readonly string[] = [
  'vidorax.appLock.v1',
  'vidorax.appLockBiometric.v1',
  'vidorax.privateVault.v1',
  mmkvKeys.playerQueue,
  mmkvKeys.firstLaunch,
  mmkvKeys.onboardingComplete,
  mmkvKeys.catalogSeededV1,
  mmkvKeys.playbackMigratedLocalV1,
  mmkvKeys.authSecretsClearedV1,
  mmkvKeys.favoritesPerItemMigratedV1,
  mmkvKeys.downloadNotificationEvents,
  mmkvKeys.inAppReview,
];

/**
 * The phone's allow-listed values, each through its own check (`read(spec)` returns what MMKV holds, or undefined).
 * For a backup file the subtitle records are only their choices; `fullSubtitleRecords` keeps them whole (with the
 * phone's subtitle files), which a restore needs to merge into.
 */
export function collectPreferences(
  read: (spec: PreferenceSpec) => unknown,
  options: { fullSubtitleRecords?: boolean } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of BACKUP_PREFERENCES) {
    let raw: unknown;
    try {
      raw = read(spec);
    } catch {
      continue;
    }
    if (raw === undefined || raw === null) {
      continue;
    }
    const value =
      spec.merge === 'subtitleChoices' && options.fullSubtitleRecords
        ? Array.isArray(raw)
          ? readSubtitleRecords(raw)
          : undefined
        : spec.read(raw);
    if (value !== undefined) {
      out[spec.key] = value;
    }
  }
  return out;
}

/** A backup's preferences section: only allow-listed keys with a valid value; the rest is listed as ignored. */
export function readBackupPreferences(raw: unknown): { values: Record<string, unknown>; ignored: string[] } {
  const values: Record<string, unknown> = {};
  const ignored: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { values, ignored };
  }
  for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
    const spec = SPECS.get(key);
    const value = spec ? spec.read(entry) : undefined;
    if (!spec || value === undefined) {
      ignored.push(key);
      continue;
    }
    values[key] = value;
  }
  return { values, ignored };
}

function sameLoop(a: SavedLoop, b: SavedLoop): boolean {
  return a.id === b.id || (a.startMs === b.startMs && a.endMs === b.endMs);
}

/** P5 Merge: the phone's loops, plus the backup's that the phone doesn't have yet (per video, within the limits). */
export function mergeSavedLoops(phone: SavedLoopRecords, file: SavedLoopRecords): SavedLoopRecords {
  const out = phone.map(([id, loops]) => [id, [...loops]] as [string, SavedLoop[]]);
  for (const [mediaId, loops] of file) {
    let entry = out.find(([id]) => id === mediaId);
    if (!entry) {
      entry = [mediaId, []];
      out.push(entry);
    }
    for (const loop of loops) {
      if (!entry[1].some((existing) => sameLoop(existing, loop))) {
        entry[1].push(loop);
      }
    }
  }
  return readSavedLoopRecords(out);
}

/** P2 Merge: the backup's fit for each video it names (as if chosen now), the phone's for the others. */
export function mergeFits(phone: RememberedFits, file: RememberedFits): RememberedFits {
  let list = phone;
  for (const [mediaId, fit] of file) {
    list = rememberFit(list, mediaId, fit);
  }
  return list;
}

/**
 * P3 / P4: the phone's subtitle records after a backup's choices. The phone always keeps its subtitle files (and a
 * file chosen on it, where the backup has no choice of its own for that track). Replace also clears the choices of
 * videos the backup doesn't name.
 */
export function mergeSubtitleChoices(
  phone: SubtitleRecords,
  file: SubtitleRecords,
  mode: 'merge' | 'replace',
): SubtitleRecords {
  const named = new Set(file.map(([id]) => id));
  const out: (readonly [string, VideoSubtitleRecord])[] = [];
  for (const [id, record] of phone) {
    if (named.has(id)) {
      continue;
    }
    if (mode === 'replace') {
      const cleared: VideoSubtitleRecord = { ...EMPTY_SUBTITLE_RECORD, files: record.files };
      if (!isEmptySubtitleRecord(cleared)) {
        out.push([id, cleared]);
      }
    } else {
      out.push([id, record]);
    }
  }
  for (const [id, choices] of file) {
    const current = subtitleRecordFor(phone, id);
    const next: VideoSubtitleRecord = {
      primary: choices.primary ?? (current.primary?.kind === 'file' ? current.primary : null),
      files: current.files,
      offsetMs: choices.offsetMs,
    };
    const secondary = choices.secondary ?? (current.secondary?.kind === 'file' ? current.secondary : undefined);
    if (secondary) {
      next.secondary = secondary;
    }
    if (!isEmptySubtitleRecord(next)) {
      out.push([id, next]);
    }
  }
  return readSubtitleRecords(out);
}

/**
 * The value every allow-listed key gets from a backup. Merge: only keys the backup carries change (lists join).
 * Replace: every allow-listed key takes the backup's value, or its default when the backup doesn't carry it. `phone`
 * is what the phone holds now (`collectPreferences`, with subtitle records in full).
 */
export function restoredPreferences(
  phone: Readonly<Record<string, unknown>>,
  file: Readonly<Record<string, unknown>>,
  mode: 'merge' | 'replace',
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of BACKUP_PREFERENCES) {
    const has = Object.prototype.hasOwnProperty.call(file, spec.key);
    if (!has && mode === 'merge') {
      continue;
    }
    const fileValue = has ? file[spec.key] : spec.defaultValue;
    const phoneValue = phone[spec.key];
    switch (spec.merge) {
      case 'fits':
        out[spec.key] =
          mode === 'merge'
            ? mergeFits(readRememberedFits(phoneValue), readRememberedFits(fileValue))
            : readRememberedFits(fileValue);
        break;
      case 'loops':
        out[spec.key] =
          mode === 'merge'
            ? mergeSavedLoops(readSavedLoopRecords(phoneValue), readSavedLoopRecords(fileValue))
            : readSavedLoopRecords(fileValue);
        break;
      case 'subtitleChoices':
        out[spec.key] = mergeSubtitleChoices(readSubtitleRecords(phoneValue), readSubtitleChoices(fileValue), mode);
        break;
      case 'folderSet':
        out[spec.key] =
          mode === 'merge'
            ? normalizeExcludedFolderIds([
                ...normalizeExcludedFolderIds(phoneValue),
                ...normalizeExcludedFolderIds(fileValue),
              ])
            : normalizeExcludedFolderIds(fileValue);
        break;
      default:
        out[spec.key] = spec.read(fileValue) ?? spec.defaultValue;
    }
  }
  return out;
}

/** How many entries a preferences section holds, for the preview. */
export function preferenceCounts(values: Readonly<Record<string, unknown>>): {
  choices: number;
  loops: number;
  hiddenFolders: number;
} {
  let choices = 0;
  let loops = 0;
  let hiddenFolders = 0;
  for (const [key, value] of Object.entries(values)) {
    if (key === mmkvKeys.playerSavedLoops) {
      loops += readSavedLoopRecords(value).reduce((total, [, list]) => total + list.length, 0);
    } else if (key === mmkvKeys.libraryExcludedFolders) {
      hiddenFolders += normalizeExcludedFolderIds(value).length;
    } else if (SPECS.has(key)) {
      choices += 1;
    }
  }
  return { choices, loops, hiddenFolders };
}
