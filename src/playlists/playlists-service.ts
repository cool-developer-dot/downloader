/**
 * P7 — what the playlist screens and sheets do, with the message the user sees and hears for each. Nothing here
 * deletes or moves a video file: playlists only hold ids.
 */

import { File } from 'expo-file-system';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';

import { showAppDialog } from '@/components/modals/app-dialog';
import { translate } from '@/localization';
import { decodeSubtitleBytes } from '@/player/subtitles/subtitle-encoding';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';
import {
  playlistsRepository,
  type AddItemsResult,
  type Playlist,
  type PlaylistItemInput,
} from '@/storage/repositories/playlists.repository';
import { exportTextFile } from '@/utils/text-file-export';
import { importTextFileWith } from '@/utils/text-file-export-core';

import { matchImportEntries } from './import-match';
import { parseM3u, type M3uEntry, type M3u8Line, writeM3u8 } from './m3u';
import { notifyPlaylistsChanged } from './playlist-changes';
import { listImportCandidates } from './playlist-library';
import { playlistExportFileName, playlistNameFromFileName, uniquePlaylistName } from './playlist-names';

/** A toast, and spoken for TalkBack. */
export function announcePlaylist(message: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
  AccessibilityInfo.announceForAccessibility(message);
}

export function addedMessage(name: string, result: AddItemsResult): string {
  if (result.added === 0) {
    return translate('playlists.alreadyIn', { name });
  }
  if (result.alreadyThere > 0) {
    return translate('playlists.addedSome', { name, added: result.added, already: result.alreadyThere });
  }
  return result.added === 1
    ? translate('playlists.addedOne', { name })
    : translate('playlists.addedMany', { name, count: result.added });
}

/** #617: the videos at the end of the playlist (one already there stays). Null when it failed. */
export async function addToPlaylist(
  playlist: Pick<Playlist, 'id' | 'name'>,
  inputs: readonly PlaylistItemInput[],
): Promise<AddItemsResult | null> {
  try {
    const result = await playlistsRepository.addItems(playlist.id, inputs);
    notifyPlaylistsChanged();
    announcePlaylist(addedMessage(playlist.name, result));
    return result;
  } catch {
    announcePlaylist(translate('playlists.addFailed'));
    return null;
  }
}

/** #617: a new playlist, with these videos in it (none for an empty one). Null when it failed. */
export async function createPlaylistWith(name: string, inputs: readonly PlaylistItemInput[] = []): Promise<Playlist | null> {
  try {
    const playlist = await playlistsRepository.create(name);
    notifyPlaylistsChanged();
    if (inputs.length > 0) {
      await addToPlaylist(playlist, inputs);
    }
    return playlist;
  } catch {
    // The name dialog never sends an empty name (PlaylistError INVALID_NAME); this is a database failure.
    announcePlaylist(translate('playlists.addFailed'));
    return null;
  }
}

/** #618 */
export async function renamePlaylistTo(id: string, name: string): Promise<boolean> {
  try {
    const renamed = await playlistsRepository.rename(id, name);
    notifyPlaylistsChanged();
    return renamed;
  } catch {
    return false;
  }
}

/** #618: after a confirm. Only the playlist goes; its videos stay in the library and on the phone. */
export async function deletePlaylistAfterConfirm(playlist: Pick<Playlist, 'id' | 'name'>): Promise<boolean> {
  const confirmed = await showAppDialog({
    title: translate('playlists.deleteTitle', { name: playlist.name }),
    message: translate('playlists.deleteMessage'),
    confirmLabel: translate('common.delete'),
    cancelLabel: translate('common.cancel'),
    variant: 'error',
  });
  if (!confirmed) {
    return false;
  }
  try {
    const deleted = await playlistsRepository.remove(playlist.id);
    notifyPlaylistsChanged();
    announcePlaylist(translate('playlists.deleted'));
    return deleted;
  } catch {
    return false;
  }
}

/** #618: out of this playlist only; the video's file is untouched. */
export async function removeFromPlaylist(playlistId: string, mediaId: string): Promise<void> {
  try {
    if (await playlistsRepository.removeItem(playlistId, mediaId)) {
      notifyPlaylistsChanged();
      announcePlaylist(translate('playlists.removed'));
    }
  } catch {
    // The list reloads as it is.
  }
}

/** #618: one place up (−1) or down (+1). */
export async function movePlaylistEntry(playlistId: string, mediaId: string, delta: number): Promise<void> {
  try {
    if (await playlistsRepository.moveItem(playlistId, mediaId, delta)) {
      notifyPlaylistsChanged();
    }
  } catch {
    // The list reloads as it is.
  }
}

/**
 * #629: the playlist as an M3U8 file in a folder the user picks (or the share sheet). Each video is one
 * `#EXTINF:<seconds or -1>,<title>` and its file name (see `m3u.ts`): missing videos too, by the name they had.
 */
export async function exportPlaylist(name: string, lines: readonly M3u8Line[]): Promise<void> {
  if (lines.length === 0) {
    announcePlaylist(translate('playlists.exportEmpty'));
    return;
  }
  const outcome = await exportTextFile({
    fileName: playlistExportFileName(name),
    // The type registered for .m3u8: Android's folder picker then keeps the name's own extension.
    mimeType: 'application/vnd.apple.mpegurl',
    content: writeM3u8(lines),
    shareTitle: translate('playlists.exportShareTitle', { name }),
  });
  if (outcome === 'saved') announcePlaylist(translate('playlists.exportDone'));
  else if (outcome === 'shared') announcePlaylist(translate('playlists.exportShared'));
  else if (outcome === 'failed') announcePlaylist(translate('playlists.exportFailed'));
}

/** Phones label .m3u / .m3u8 inconsistently, so any file can be picked (the parser decides). */
export const PLAYLIST_IMPORT_MIME_TYPES = [
  '*/*',
  'audio/x-mpegurl',
  'audio/mpegurl',
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
];

/** A playlist file is text; 4 MB is tens of thousands of lines. */
const MAX_PLAYLIST_FILE_BYTES = 4 * 1024 * 1024;

export type PlaylistImportOutcome =
  | { kind: 'cancelled' }
  | { kind: 'too-large' }
  | { kind: 'failed' }
  | { kind: 'empty' }
  | {
      kind: 'done';
      /** Null when nothing matched (no playlist is made then). */
      playlist: Playlist | null;
      added: number;
      notFound: M3uEntry[];
      skippedRemote: number;
      duplicates: number;
    };

/**
 * #629: picks an M3U / M3U8 file, reads it (UTF-8, UTF-16 or a Windows code page — an old .m3u with Urdu names), and
 * makes a playlist named after the file of the library videos it names (by path, then by file name). Web links are
 * skipped and counted; lines that match nothing are returned for the user to see.
 */
export async function importPlaylistFile(): Promise<PlaylistImportOutcome> {
  let pickedName: string | null = null;
  const picked = await importTextFileWith(
    {
      pickFile: async () => {
        const result = await withExpectedSystemScreen(() =>
          File.pickFileAsync({ mimeTypes: PLAYLIST_IMPORT_MIME_TYPES }),
        );
        if (result.canceled || !result.result) {
          return null;
        }
        const file = result.result;
        pickedName = file.name || null;
        return {
          size: typeof file.size === 'number' ? file.size : null,
          read: async () => decodeSubtitleBytes(await file.bytes(), 'auto').text,
        };
      },
    },
    MAX_PLAYLIST_FILE_BYTES,
  );
  if (picked.status !== 'picked') {
    return { kind: picked.status };
  }
  const parsed = parseM3u(picked.text);
  if (parsed.entries.length === 0 && parsed.skippedRemote === 0) {
    return { kind: 'empty' };
  }
  try {
    const candidates = await listImportCandidates();
    const result = matchImportEntries(parsed.entries, candidates);
    const base = { notFound: result.notFound, skippedRemote: parsed.skippedRemote, duplicates: result.duplicates };
    if (result.matched.length === 0) {
      return { kind: 'done', playlist: null, added: 0, ...base };
    }
    const existing = (await playlistsRepository.list()).map((playlist) => playlist.name);
    const name = uniquePlaylistName(playlistNameFromFileName(pickedName) || translate('playlists.importedName'), existing);
    const playlist = await playlistsRepository.create(name);
    const added = await playlistsRepository.addItems(
      playlist.id,
      result.matched.map((match) => match.candidate.input),
    );
    notifyPlaylistsChanged();
    return { kind: 'done', playlist, added: added.added, ...base };
  } catch {
    notifyPlaylistsChanged();
    return { kind: 'failed' };
  }
}
