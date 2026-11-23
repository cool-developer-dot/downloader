import { getDatabase } from '@/storage/sqlite/client';
import { toStorageError } from '@/storage/types';
import { nowIso } from '@/storage/utils';

import {
  readUserData,
  restoreUserData,
  type UserData,
  type UserDataRestore,
  type UserDataRestoreSummary,
} from './user-data.queries';

/** P11 #700 — the backup's playlists, video bookmarks and play counts in the app database (`vidorax.db`). */
export async function readBackupUserData(): Promise<UserData> {
  try {
    return await readUserData(await getDatabase());
  } catch (error) {
    throw toStorageError(error, 'Failed to read data for a backup', 'QUERY_FAILED');
  }
}

export async function restoreBackupUserData(
  data: UserDataRestore,
  mode: 'merge' | 'replace',
): Promise<UserDataRestoreSummary> {
  try {
    return await restoreUserData(await getDatabase(), data, mode, nowIso());
  } catch (error) {
    throw toStorageError(error, 'Failed to restore a backup', 'QUERY_FAILED');
  }
}
