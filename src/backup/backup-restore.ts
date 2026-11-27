/**
 * P11 #700 Restore — what Merge and Replace do with the settings, and what changes at all. Pure.
 *
 * - **Merge:** the backup's settings and choices are applied; lists (playlists, bookmarks, loops, hidden folders) are
 *   joined. Nothing on the phone is deleted.
 * - **Replace:** for every section the backup has, the phone ends up with exactly the backup's: each setting the
 *   backup carries is applied, every other setting of that kind goes back to its default (the language stays as it is
 *   unless the backup carries one, as Reset Settings keeps it); lists become the backup's. A section the backup doesn't
 *   have (an older settings-only file has only settings) is left as it is.
 * Both ask first (the screen confirms), and neither ever touches App Lock or Private.
 */

import { backupKeys } from '@/store/settings/backup';

import type { AppBackup } from './backup-format';

export type RestoreMode = 'merge' | 'replace';

type Primitive = string | number | boolean;

/** The language is a setting too, but Replace never resets it on its own (the layout direction follows it). */
export const SETTINGS_KEPT_ON_REPLACE: readonly string[] = ['language'];

/** The settings a restore applies: the backup's (Merge), or the backup's over the defaults (Replace). */
export function restoredSettingsValues(
  fileValues: Readonly<Record<string, Primitive>>,
  defaults: Readonly<Record<string, unknown>>,
  mode: RestoreMode,
): Record<string, Primitive> {
  if (mode === 'merge') {
    return { ...fileValues };
  }
  const out: Record<string, Primitive> = {};
  for (const key of backupKeys(defaults)) {
    if (Object.prototype.hasOwnProperty.call(fileValues, key)) {
      out[key] = fileValues[key]!;
    } else if (!SETTINGS_KEPT_ON_REPLACE.includes(key)) {
      out[key] = defaults[key] as Primitive;
    }
  }
  return out;
}

/** Keys whose value would change (compared as JSON, so lists and objects compare by content). */
export function changedKeys(
  current: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): string[] {
  return Object.keys(next).filter((key) => JSON.stringify(current[key] ?? null) !== JSON.stringify(next[key] ?? null));
}

/** Which parts a restore of this backup writes (for the confirm's wording and the order). */
export function restoreParts(backup: AppBackup): { settings: boolean; preferences: boolean; userData: boolean; files: boolean } {
  const { sections } = backup;
  return {
    settings: sections.settings !== undefined,
    preferences: sections.preferences !== undefined,
    userData: sections.playlists !== undefined || sections.videoBookmarks !== undefined || sections.playStats !== undefined,
    files: sections.files !== undefined,
  };
}
