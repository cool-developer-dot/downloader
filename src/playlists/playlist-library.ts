/**
 * P7 — what playlists read from the library and the phone: the library's videos (as the Library screen loads them),
 * a video's name and file name when it is added, and the videos an import can match.
 */

import { ensureV2LibraryHydrated } from '@/downloads/v2';
import {
  configureLibraryRepository,
  getInternalPlaybackUri,
  getLibrary,
  getMediaById,
  type MediaLibraryItem,
} from '@/library';
import { deviceMediaId, isDeviceMediaId, knownDeviceVideo, listDeviceVideos } from '@/player/device-media';
import { getCachedFavoriteMediaIds } from '@/storage/services/catalog-persist';
import type { PlaylistItemInput } from '@/storage/repositories/playlists.repository';
import { selectAllDownloadItems, useDownloadsStore } from '@/store/downloads';
import { useFavoritesStore } from '@/store/favorites';

import type { ImportCandidate } from './import-match';
import type { EntryLookup } from './playlist-entries';

/** The same sources the Library screen gives the repository (`useLibraryScreen`); the Player may open first. */
function configurePlaylistLibrary(): void {
  configureLibraryRepository({
    getDownloadItems: () => selectAllDownloadItems(useDownloadsStore.getState()),
    getTransfers: () => useDownloadsStore.getState().transferById,
    getFavoriteSourceKeys: () => new Set(Object.keys(useFavoritesStore.getState().urlIndex)),
    getFavoriteMediaIds: () => getCachedFavoriteMediaIds(),
  });
}

/** Every library video by id, with its file checked (missing / available), as the Library lists them. */
export async function loadLibraryIndex(): Promise<Map<string, MediaLibraryItem>> {
  configurePlaylistLibrary();
  await ensureV2LibraryHydrated();
  const { items } = await getLibrary();
  return new Map(items.map((item) => [item.id, item] as const));
}

/**
 * Phone videos are known only once VidoraX has listed them in this run. When a playlist has some that aren't, list
 * them now (no permission prompt: without access the list is just empty). True when something new became known.
 */
export async function listUnknownDeviceVideos(mediaIds: readonly string[]): Promise<boolean> {
  const unknown = mediaIds.filter((id) => isDeviceMediaId(id) && !knownDeviceVideo(id));
  if (unknown.length === 0) {
    return false;
  }
  const listing = await listDeviceVideos(500);
  return listing.items.length > 0 && unknown.some((id) => knownDeviceVideo(id) != null);
}

export const deviceLookup: EntryLookup['device'] = (mediaId) => {
  const video = knownDeviceVideo(mediaId);
  return video ? { title: video.title, durationMs: video.durationMs } : null;
};

export function libraryItemToInput(item: MediaLibraryItem): PlaylistItemInput {
  return {
    mediaId: item.id,
    title: item.displayName,
    fileName: item.fileName,
    durationSeconds: item.duration,
  };
}

/** What a playlist keeps about the video playing in the Player (its name for when it is gone, its file name). */
export async function describeMediaForPlaylist(mediaId: string, fallbackTitle: string | null): Promise<PlaylistItemInput> {
  if (isDeviceMediaId(mediaId)) {
    const video = knownDeviceVideo(mediaId);
    return {
      mediaId,
      title: video?.title ?? fallbackTitle ?? '',
      fileName: video?.title ?? fallbackTitle ?? '',
      durationSeconds: video?.durationMs != null ? video.durationMs / 1000 : null,
    };
  }
  try {
    configurePlaylistLibrary();
    const item = await getMediaById(mediaId);
    if (item) {
      return libraryItemToInput(item);
    }
  } catch {
    // Keep what the Player shows.
  }
  return { mediaId, title: fallbackTitle ?? '', fileName: fallbackTitle ?? '', durationSeconds: null };
}

export type LibraryImportCandidate = ImportCandidate & { input: PlaylistItemInput };

/**
 * The videos an imported playlist can name: every library video (its path is where VidoraX plays it from, known once
 * its file has been checked), and the phone's videos when VidoraX may read them.
 */
export async function listImportCandidates(): Promise<LibraryImportCandidate[]> {
  const library = await loadLibraryIndex();
  const candidates: LibraryImportCandidate[] = [...library.values()].map((item) => ({
    id: item.id,
    fileName: item.fileName,
    path: getInternalPlaybackUri(item.id),
    playable: item.localAvailability !== 'missing',
    input: libraryItemToInput(item),
  }));
  try {
    const listing = await listDeviceVideos(500);
    for (const video of listing.items) {
      const id = deviceMediaId(video);
      candidates.push({
        id,
        fileName: video.title,
        path: null,
        playable: true,
        input: {
          mediaId: id,
          title: video.title,
          fileName: video.title,
          durationSeconds: video.durationMs != null ? video.durationMs / 1000 : null,
        },
      });
    }
  } catch {
    // No phone videos: the library alone.
  }
  return candidates;
}
