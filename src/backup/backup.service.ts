/**
 * P11 #700 Backup / Restore — the app's side: what the phone holds now, the file (saved through the existing save /
 * share flow, inside App Lock's `withExpectedSystemScreen`), and a restore. The format and the rules are pure
 * (`backup-format.ts`, `backup-preferences.ts`, `backup-restore.ts`, `user-data.queries.ts`).
 *
 * It wraps Settings Backup (#471) rather than replacing it: the settings section is what `settingsBackupJson` writes,
 * read back by `parseSettingsBackup` and applied by `importSettingsValues`, exactly as Settings → Export / Import
 * settings (which stay as they are) do. A Settings Backup file restores here too.
 */

import { refreshPlayCounts } from '@/library/library-stats-store';
import { loadVideoBookmarks, useVideoBookmarksStore } from '@/player/video-bookmarks-store';
import { notifyPlaylistsChanged } from '@/playlists/playlist-changes';
import { importSettingsValues } from '@/screens/settings/backup-reset/useSettingsBackupReset';
import { useSettingsStore } from '@/store/settings';
import { settingsBackupJson } from '@/store/settings/backup';
import { initialSettingsState } from '@/store/settings/state';
import { exportFileName, exportTextFile, importTextFile, type TextExportResult } from '@/utils/text-file-export';

import { applyRestoredPreference, readStoredPreference } from './apply-preferences.runtime';
import {
  appBackupJson,
  MAX_APP_BACKUP_BYTES,
  parseAppBackup,
  type AppBackup,
  type AppBackupSections,
} from './backup-format';
import { collectPreferences, restoredPreferences } from './backup-preferences';
import { changedKeys, restoredSettingsValues, type RestoreMode } from './backup-restore';
import { readBackupUserData, restoreBackupUserData } from './user-data.repository';
import type { UserDataRestoreSummary } from './user-data.queries';

type Values = Record<string, unknown>;

function settingsDefaults(): Values {
  return initialSettingsState as unknown as Values;
}

function currentSettings(): Values {
  const state = useSettingsStore.getState() as unknown as Values;
  const values: Values = {};
  for (const key of Object.keys(settingsDefaults())) {
    values[key] = state[key];
  }
  return values;
}

/** Everything a backup holds, read now. */
export async function collectAppBackup(now: Date = new Date()): Promise<AppBackupSections> {
  // The settings exactly as Settings Backup writes them.
  const settings = (JSON.parse(settingsBackupJson(currentSettings(), settingsDefaults(), now)) as { settings: AppBackupSections['settings'] })
    .settings;
  const preferences = collectPreferences(readStoredPreference);
  const userData = await readBackupUserData();
  // F17: the File Manager's folders, tags, notes and settings (never media, Private or the bin's items).
  const { collectFilesBackup } = await import('./files-section.runtime');
  const files = await collectFilesBackup().catch(() => undefined);
  return { settings, preferences, ...userData, ...(files ? { files } : {}) };
}

/** Saves the backup where the user picks (or shares it). */
export async function exportAppBackup(shareTitle: string): Promise<TextExportResult> {
  const now = new Date();
  const sections = await collectAppBackup(now);
  return exportTextFile({
    // "vidorax-all-data-2026-11-23.json" (B20's browser backup is "vidorax-backup-…").
    fileName: exportFileName('all-data', 'json', now),
    mimeType: 'application/json',
    content: appBackupJson(sections, now),
    shareTitle,
  });
}

export type PickedAppBackup =
  | { status: 'picked'; backup: AppBackup; ignored: string[] }
  | { status: 'cancelled' | 'too-large' | 'failed' | 'not-backup' | 'newer-version' | 'browser-backup' };

/** Opens the system file picker and reads the backup (nothing is applied yet). */
export async function pickAppBackup(): Promise<PickedAppBackup> {
  const picked = await importTextFile(['application/json', 'text/plain', 'application/octet-stream'], MAX_APP_BACKUP_BYTES);
  if (picked.status !== 'picked') {
    return { status: picked.status };
  }
  const parsed = parseAppBackup(picked.text, settingsDefaults());
  if (!parsed.ok) {
    return {
      status:
        parsed.reason === 'newer-version'
          ? 'newer-version'
          : parsed.reason === 'browser-backup'
            ? 'browser-backup'
            : 'not-backup',
    };
  }
  return { status: 'picked', backup: parsed.backup, ignored: parsed.ignored };
}

export type AppRestoreSummary = UserDataRestoreSummary & { settings: number; preferences: number; filesItems?: number };

/**
 * Restores a backup the user confirmed. The database part first, in one transaction: if it fails, nothing at all is
 * changed (it rejects). Then the preferences and the settings, each through its own setter.
 */
export async function restoreAppBackup(backup: AppBackup, mode: RestoreMode): Promise<AppRestoreSummary> {
  const { sections } = backup;
  const userData =
    sections.playlists || sections.videoBookmarks || sections.playStats
      ? await restoreBackupUserData(
          { playlists: sections.playlists, videoBookmarks: sections.videoBookmarks, playStats: sections.playStats },
          mode,
        )
      : { playlistsAdded: 0, playlistVideosAdded: 0, bookmarksAdded: 0, playCountsChanged: 0 };

  let preferences = 0;
  if (sections.preferences) {
    const phone = collectPreferences(readStoredPreference, { fullSubtitleRecords: true });
    const next = restoredPreferences(phone, sections.preferences, mode);
    for (const key of changedKeys(phone, next)) {
      try {
        applyRestoredPreference(key, next[key], phone[key]);
        preferences += 1;
      } catch {
        // One choice that can't be applied doesn't stop the others.
      }
    }
  }

  let settings = 0;
  if (sections.settings) {
    settings = importSettingsValues(restoredSettingsValues(sections.settings, settingsDefaults(), mode));
  }

  // What open screens show now includes the restore.
  if (sections.playlists) {
    notifyPlaylistsChanged();
  }
  if (sections.videoBookmarks) {
    for (const mediaId of Object.keys(useVideoBookmarksStore.getState().byMediaId)) {
      void loadVideoBookmarks(mediaId);
    }
  }
  if (sections.playStats) {
    void refreshPlayCounts();
  }
  let filesItems: number | undefined;
  if (sections.files) {
    const { restoreFilesBackup } = await import('./files-section.runtime');
    const files = await restoreFilesBackup(sections.files, mode).catch(() => null);
    filesItems = files ? files.foldersAdded + files.itemsUpdated + files.settings : 0;
  }
  return { ...userData, settings, preferences, ...(filesItems !== undefined ? { filesItems } : {}) };
}
