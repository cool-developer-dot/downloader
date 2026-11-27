/**
 * F17 (Faran's backup format v2): the File Manager screens' own MMKV keys that a backup carries, each with how its
 * store reads MMKV again after a restore (`registerFilesBackupKey`). Loaded once when the app starts (the app layout
 * imports it). Never a PIN or a Private file. F10's locked folders register in its SecurityHost.
 */

import { registerFilesBackupKey } from '@/backup/files-section.runtime';
import { useCustomOrderStore, useFolderColorsStore } from '@/files/organize/organize-stores';
import { useItemHiddenStore, useTagColorsStore } from '@/library/item-organize-store';
import { mmkvKeys } from '@/storage/constants';

import { reloadFilesViewSettings } from './files-view-settings';

// F2 · File manager settings: view, sort, extensions, Confirm before delete.
registerFilesBackupKey(mmkvKeys.filesViewSettings, reloadFilesViewSettings);
// F7 · Organize: hidden files, tag colours, folder colours and each folder's custom order (persist stores: rehydrate).
registerFilesBackupKey(mmkvKeys.filesHidden, () => void useItemHiddenStore.persist.rehydrate());
registerFilesBackupKey(mmkvKeys.filesTagColors, () => void useTagColorsStore.persist.rehydrate());
registerFilesBackupKey(mmkvKeys.filesFolderColors, () => void useFolderColorsStore.persist.rehydrate());
registerFilesBackupKey(mmkvKeys.filesCustomOrder, () => void useCustomOrderStore.persist.rehydrate());
