/**
 * Files F11 · design 62: "Back up now" and "Send to device", on the existing backup service (no format change: the file
 * is `collectAppBackup` + `appBackupJson`, exactly what Export writes).
 *
 * - Back up now saves to the folder chosen last time; the first time (or when Android no longer lets VidoraX write
 *   there) it asks with Android's folder picker. What it wrote is remembered on this phone only.
 * - Send to device shares the newest backup through the share sheet (a fresh one when none can be read).
 */

import { Directory, File } from 'expo-file-system';
// A namespace import: Share is read only when the share sheet is actually used.
import * as ReactNative from 'react-native';

import { appBackupJson } from '@/backup/backup-format';
import { collectAppBackup } from '@/backup/backup.service';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';
import { exportFileName } from '@/utils/text-file-export';
import { isCancelError, MAX_SHARE_CHARS } from '@/utils/text-file-export-core';

import { utf8Bytes, type LastBackup } from './backup-screen-model';

export type LastBackupRecord = LastBackup & { folderUri: string | null; fileUri: string | null };

function readRecord(): LastBackupRecord | null {
  const raw = mmkvGetObject<Partial<LastBackupRecord>>(mmkvKeys.filesLastBackup);
  if (!raw || typeof raw.at !== 'string' || typeof raw.bytes !== 'number') return null;
  return {
    at: raw.at,
    bytes: raw.bytes,
    folderUri: typeof raw.folderUri === 'string' ? raw.folderUri : null,
    fileUri: typeof raw.fileUri === 'string' ? raw.fileUri : null,
  };
}

/** This phone's last backup (the Last backup card). */
export const useLastBackupStore = createStore<{ last: LastBackupRecord | null }>()(() => ({ last: readRecord() }));

function remember(record: LastBackupRecord): void {
  mmkvSetObject(mmkvKeys.filesLastBackup, record);
  useLastBackupStore.setState({ last: record });
}

async function buildBackup(now: Date): Promise<{ fileName: string; json: string }> {
  const sections = await collectAppBackup(now);
  return { fileName: exportFileName('all-data', 'json', now), json: appBackupJson(sections, now) };
}

export async function backUpNow(): Promise<'saved' | 'cancelled' | 'failed'> {
  const now = new Date();
  let backup: { fileName: string; json: string };
  try {
    backup = await buildBackup(now);
  } catch {
    return 'failed';
  }
  const write = (directory: Directory): File => {
    const file = directory.createFile(backup.fileName, 'application/json');
    file.write(backup.json);
    return file;
  };
  const folderUri = useLastBackupStore.getState().last?.folderUri ?? null;
  let directory: Directory | null = null;
  let file: File | null = null;
  if (folderUri) {
    try {
      directory = new Directory(folderUri);
      file = write(directory);
    } catch {
      directory = null;
      file = null;
    }
  }
  if (!directory || !file) {
    try {
      directory = await withExpectedSystemScreen(() => Directory.pickDirectoryAsync());
    } catch (error) {
      return isCancelError(error) ? 'cancelled' : 'failed';
    }
    try {
      file = write(directory);
    } catch {
      return 'failed';
    }
  }
  remember({ at: now.toISOString(), bytes: utf8Bytes(backup.json), folderUri: directory.uri, fileUri: file.uri });
  return 'saved';
}

export async function shareNewestBackup(title: string): Promise<'shared' | 'dismissed' | 'too-large' | 'failed'> {
  let text: string | null = null;
  const fileUri = useLastBackupStore.getState().last?.fileUri ?? null;
  if (fileUri) {
    try {
      text = await new File(fileUri).text();
    } catch {
      text = null;
    }
  }
  try {
    text ??= (await buildBackup(new Date())).json;
  } catch {
    return 'failed';
  }
  if (text.length > MAX_SHARE_CHARS) return 'too-large';
  try {
    const { Share } = ReactNative;
    const message = text;
    const result = await withExpectedSystemScreen(() => Share.share({ message, title }, { dialogTitle: title }));
    return result.action !== Share.dismissedAction ? 'shared' : 'dismissed';
  } catch {
    return 'failed';
  }
}
