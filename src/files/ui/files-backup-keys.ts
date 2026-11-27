/**
 * F17 (Faran's backup format v2): the File Manager screens' own MMKV keys that a backup carries, each with how its
 * store reads MMKV again after a restore (`registerFilesBackupKey`). Loaded once when the app starts (the app layout
 * imports it). Never a PIN or a Private file. F10's locked folders register in its SecurityHost.
 */

import { registerFilesBackupKey } from '@/backup/files-section.runtime';
import { mmkvKeys } from '@/storage/constants';

import { reloadFilesViewSettings } from './files-view-settings';

// F2 · File manager settings: view, sort, extensions, Confirm before delete.
registerFilesBackupKey(mmkvKeys.filesViewSettings, reloadFilesViewSettings);
// F7 · Organize
