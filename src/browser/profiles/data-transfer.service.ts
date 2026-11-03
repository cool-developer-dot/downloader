/**
 * B20 #209 Backup and restore, #210 Export data — the file side. The formats are pure (src/browser/data); this reads
 * and writes the profiles' data and the files, always where the user picks (the system folder or file picker, no
 * storage permission) and never anywhere else.
 */
import {
  BACKUP_LIMITS,
  backupJson,
  MAX_BACKUP_BYTES,
  parseBackup,
  type BackupCounts,
  type BackupProfile,
  type BrowserBackup,
} from '@/browser/data/data-backup';
import { historyCsv } from '@/browser/data/history-csv';
import { netscapeBookmarksHtml } from '@/browser/data/netscape-bookmarks';
import { BROWSER_SETTING_KEYS } from '@/browser/settings/browser-setting-keys';
import { importSettingsValues } from '@/screens/settings/backup-reset/useSettingsBackupReset';
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetString, mmkvSetString } from '@/storage/mmkv';
import { GUEST_PROFILE_ID, getActiveProfileId } from '@/storage/profile/active-profile';
import { browserProfileDataRepository } from '@/storage/repositories/browser-profile-data.repository';
import { useBookmarksStore } from '@/store/bookmarks';
import { useHistoryStore } from '@/store/history';
import { useRecentSearchesStore } from '@/store/recent-searches';
import { useSettingsStore } from '@/store/settings';
import {
  backupKeys,
  parseSettingsBackup,
  SETTINGS_BACKUP_FORMAT,
  SETTINGS_BACKUP_VERSION,
} from '@/store/settings/backup';
import { initialSettingsState } from '@/store/settings/state';
import {
  exportFileName,
  exportTextFile,
  exportTextFiles,
  importTextFile,
  type TextExportResult,
} from '@/utils/text-file-export';

import { checkProfileName, MAX_PROFILES, type BrowserProfile } from './profile-registry';
import { browserSettingDefaults, profileSettingsText, profileSettingsValues, saveProfileSettings } from './profile-settings';
import { saveProfileList, useProfilesStore } from './profile-service';

type Primitive = string | number | boolean;
type Values = Record<string, unknown>;

const BROWSER_KEYS = new Set<string>(BROWSER_SETTING_KEYS);

/** App settings a backup carries: Settings Backup's keys without the per-profile browser settings. */
function appSettingDefaults(): Values {
  const defaults = initialSettingsState as unknown as Values;
  const picked: Values = {};
  for (const key of backupKeys(defaults)) {
    if (!BROWSER_KEYS.has(key)) picked[key] = defaults[key];
  }
  return picked;
}

function primitivesOf(values: Values, defaults: Values): Record<string, Primitive> {
  const result: Record<string, Primitive> = {};
  for (const key of Object.keys(defaults)) {
    const value = values[key];
    if ((typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') && typeof value === typeof defaults[key]) {
      result[key] = value;
    }
  }
  return result;
}

/** Checked the way Settings Backup checks a file: only known keys of the right type and an allowed choice. */
function checkedSettings(values: Record<string, Primitive>, defaults: Values): Record<string, Primitive> {
  const text = JSON.stringify({ format: SETTINGS_BACKUP_FORMAT, version: SETTINGS_BACKUP_VERSION, settings: values });
  const parsed = parseSettingsBackup(text, defaults);
  return parsed.ok ? parsed.values : {};
}

function profileSettingsTextOf(profileId: string): string | undefined {
  return mmkvGetString(`${mmkvKeys.browserProfileSettings}@${profileId}`);
}

/** Pure-ish: everything a backup holds, read now. */
export async function collectBackup(now: Date = new Date()): Promise<BrowserBackup> {
  const active = getActiveProfileId();
  if (active !== GUEST_PROFILE_ID) {
    // The active profile's settings are in the store; its saved copy is brought up to date first.
    saveProfileSettings(active);
  }
  const defaults = browserSettingDefaults();
  const profiles: BackupProfile[] = [];
  for (const profile of useProfilesStore.getState().profiles) {
    const data = await browserProfileDataRepository.read(profile.id, {
      bookmarks: BACKUP_LIMITS.bookmarksPerProfile,
      history: BACKUP_LIMITS.historyPerProfile,
      searches: BACKUP_LIMITS.searchesPerProfile,
    });
    profiles.push({
      id: profile.id,
      name: profile.name,
      color: profile.color,
      browserSettings: primitivesOf(profileSettingsValues(profileSettingsTextOf(profile.id), defaults), defaults),
      bookmarks: data.bookmarks,
      history: data.history,
      searches: data.searches,
    });
  }
  return {
    exportedAt: now.toISOString(),
    settings: primitivesOf(useSettingsStore.getState() as unknown as Values, appSettingDefaults()),
    profiles,
  };
}

export async function backUpBrowserData(shareTitle: string): Promise<TextExportResult> {
  const now = new Date();
  const backup = await collectBackup(now);
  return exportTextFile({
    fileName: exportFileName('backup', 'json', now),
    mimeType: 'application/json',
    content: backupJson(backup),
    shareTitle,
  });
}

export type PickedBackup =
  | { status: 'picked'; backup: BrowserBackup; counts: BackupCounts }
  | { status: 'cancelled' | 'too-large' | 'failed' | 'not-backup' | 'newer-version' };

export async function pickBackupFile(): Promise<PickedBackup> {
  const picked = await importTextFile(['application/json', 'text/plain', 'application/octet-stream'], MAX_BACKUP_BYTES);
  if (picked.status !== 'picked') return { status: picked.status };
  const parsed = parseBackup(picked.text);
  if (!parsed.ok) return { status: parsed.reason === 'unsupported-version' ? 'newer-version' : 'not-backup' };
  return { status: 'picked', backup: parsed.backup, counts: parsed.counts };
}

export type RestoreSummary = {
  profilesAdded: number;
  /** Profiles in the file there was no room for (the limit is MAX_PROFILES). */
  profilesSkipped: number;
  bookmarks: number;
  history: number;
  searches: number;
  settings: number;
};

/** A free name for a profile from a backup: its own, or "<name> 2", "<name> 3"… */
function freeName(name: string, profiles: readonly BrowserProfile[], defaultName: string): string {
  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? name : `${name.slice(0, 26)} ${n}`;
    if (checkProfileName(candidate, profiles, { defaultName }).ok) return candidate;
  }
  return `${name.slice(0, 20)} ${Date.now() % 1000}`;
}

/** Where a backup's profile goes: the default to the default, a known id to itself, else a new profile if there's room. */
function targetFor(source: BackupProfile, defaultName: string): string | null {
  const { profiles } = useProfilesStore.getState();
  if (source.id === 'default' || profiles.some((p) => p.id === source.id)) return source.id;
  const sameName = profiles.find((p) => p.name && p.name.toLocaleLowerCase() === source.name.toLocaleLowerCase());
  if (sameName) return sameName.id;
  if (profiles.length >= MAX_PROFILES) return null;
  const id = source.id;
  const profile: BrowserProfile = {
    id,
    name: freeName(source.name || defaultName, profiles, defaultName),
    color: source.color,
    createdAt: Date.now(),
  };
  saveProfileList([...profiles, profile]);
  return id;
}

/**
 * Adds a backup to what the phone has; nothing is replaced or deleted. App settings and the active profile's browser
 * settings apply now; other profiles' browser settings apply when the user next switches to them.
 */
export async function restoreBrowserBackup(backup: BrowserBackup, defaultName: string): Promise<RestoreSummary> {
  const summary: RestoreSummary = { profilesAdded: 0, profilesSkipped: 0, bookmarks: 0, history: 0, searches: 0, settings: 0 };
  const active = getActiveProfileId();
  const browserDefaults = browserSettingDefaults();
  for (const source of backup.profiles) {
    const before = useProfilesStore.getState().profiles.length;
    const target = targetFor(source, defaultName);
    if (!target) {
      summary.profilesSkipped += 1;
      continue;
    }
    if (useProfilesStore.getState().profiles.length > before) summary.profilesAdded += 1;
    const added = await browserProfileDataRepository.merge(target, source);
    summary.bookmarks += added.bookmarks;
    summary.history += added.history;
    summary.searches += added.searches;
    const settings = checkedSettings(source.browserSettings, browserDefaults);
    if (target === active) {
      summary.settings += importSettingsValues(settings);
    } else {
      mmkvSetString(
        `${mmkvKeys.browserProfileSettings}@${target}`,
        profileSettingsText({ ...browserDefaults, ...settings }, new Date(), browserDefaults),
      );
    }
  }
  summary.settings += importSettingsValues(checkedSettings(backup.settings, appSettingDefaults()));
  // What the active profile shows now includes what was added.
  useHistoryStore.getState().reset();
  useBookmarksStore.getState().reset();
  useRecentSearchesStore.getState().reset();
  void useHistoryStore.getState().load(1);
  void useBookmarksStore.getState().load(1);
  void useRecentSearchesStore.getState().load(1);
  return summary;
}

export type ExportLabels = {
  folderName: string;
  csvHeaders: { title: string; url: string; visitedAt: string };
  shareTitle: string;
};

/** #210: the active profile's bookmarks (bookmark file for other browsers) and history (CSV), in one folder. */
export async function exportProfileData(profileSlug: string, labels: ExportLabels): Promise<TextExportResult> {
  const now = new Date();
  const data = await browserProfileDataRepository.read(getActiveProfileId(), {
    bookmarks: BACKUP_LIMITS.bookmarksPerProfile,
    history: BACKUP_LIMITS.historyPerProfile,
    searches: 0,
  });
  return exportTextFiles(
    [
      {
        fileName: exportFileName(`bookmarks-${profileSlug}`, 'html', now),
        mimeType: 'text/html',
        content: netscapeBookmarksHtml(labels.folderName, data.bookmarks, now),
      },
      {
        fileName: exportFileName(`history-${profileSlug}`, 'csv', now),
        mimeType: 'text/csv',
        content: historyCsv(data.history, labels.csvHeaders),
      },
    ],
    labels.shareTitle,
  );
}
