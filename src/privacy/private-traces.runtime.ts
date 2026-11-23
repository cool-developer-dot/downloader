/**
 * P11 #686 — `hidePrivateTraces` with the app's real stores. Called by the move itself (`forgetHistory` in
 * `src/private-vault/move-to-private.runtime.ts`), so a move from the Library and one from the Player both get it.
 */

import { useItemNotesStore, useItemTagsStore } from '@/library/item-organize-store';
import { refreshPlayCounts } from '@/library/library-stats-store';
import { useMediaTagsStore } from '@/media-edit/media-tags-store';
import { deletePlaybackState, invalidatePlaybackUiQueries, PLAYBACK_LOCAL_NAMESPACE } from '@/playback';
import { dropPlaybackSessionFor } from '@/playback/bind-playback-persistence';
import { removeFromPlayQueue, setPlayQueueCurrent, usePlayQueueStore } from '@/player/play-queue';
import { getSavedLoopRecords, restoreSavedLoopRecords } from '@/player/repeat-preference';
import { closePlayerSession, usePlayerSessionHostStore } from '@/player/session-host/player-session-store';
import { notifyPlaylistsChanged } from '@/playlists/playlist-changes';
import { getVideoSubtitleRecord, updateVideoSubtitleRecord } from '@/player/subtitles/subtitle-preference';
import { EMPTY_SUBTITLE_RECORD, isEmptySubtitleRecord, pickedCopies } from '@/player/subtitles/subtitle-record';
import { forgetVideoBookmarks } from '@/player/video-bookmarks-store';
import { DEFAULT_VIDEO_FIT } from '@/player/video-display';
import { getVideoFit, setVideoFit } from '@/player/video-display-preference';
import { queryClient } from '@/services/query-client';

import { markMovedToPrivate } from './private-media-guard';
import { hidePrivateTraces, type PrivateTracesDeps, type PrivateTracesReport } from './private-traces';

function forgetPlayerChoices(mediaId: string): void {
  // P5: its saved A-B loops.
  const loops = getSavedLoopRecords();
  if (loops.some(([id]) => id === mediaId)) {
    restoreSavedLoopRecords(loops.filter(([id]) => id !== mediaId));
  }
  // P2: its fit (back to the default forgets it).
  if (getVideoFit(mediaId) !== DEFAULT_VIDEO_FIT) {
    setVideoFit(mediaId, DEFAULT_VIDEO_FIT);
  }
  // P3: its subtitle choices, and the subtitle files loaded for it (VidoraX's own copies are deleted).
  const subtitles = getVideoSubtitleRecord(mediaId);
  if (!isEmptySubtitleRecord(subtitles)) {
    updateVideoSubtitleRecord(mediaId, () => EMPTY_SUBTITLE_RECORD, pickedCopies(subtitles));
  }
}

const runtimeDeps: PrivateTracesDeps = {
  markMovedToPrivate,
  dropPlaybackSession: (mediaId) => {
    dropPlaybackSessionFor(mediaId);
  },
  forgetPlayback: (mediaId) => {
    deletePlaybackState(PLAYBACK_LOCAL_NAMESPACE, mediaId);
    invalidatePlaybackUiQueries(queryClient);
  },
  forgetPlayStatsAndBookmarks: async (mediaIds) => {
    forgetVideoBookmarks(mediaIds);
    const { libraryStatsRepository } = await import('@/storage/repositories/library-stats.repository');
    await libraryStatsRepository.forget(mediaIds);
    await refreshPlayCounts();
  },
  playlistsWith: async (mediaId) => {
    const { playlistsRepository } = await import('@/storage/repositories/playlists.repository');
    return playlistsRepository.playlistIdsWith(mediaId);
  },
  removeFromPlaylist: async (playlistId, mediaId) => {
    const { playlistsRepository } = await import('@/storage/repositories/playlists.repository');
    const removed = await playlistsRepository.removeItem(playlistId, mediaId);
    if (removed) {
      // Open playlist screens read the database again (silently: the user asked for a move, not this).
      notifyPlaylistsChanged();
    }
    return removed;
  },
  forgetPlayerChoices,
  forgetItemNotes: (mediaIds) => {
    useItemTagsStore.getState().forget(mediaIds);
    useItemNotesStore.getState().forget(mediaIds);
    useMediaTagsStore.getState().forget(mediaIds);
  },
  snapshot: () => {
    const host = usePlayerSessionHostStore.getState();
    const queue = usePlayQueueStore.getState();
    return {
      sessionMediaId: host.request?.mediaId ?? null,
      fullPlayerShown: host.fullPlayerCount > 0,
      queueIds: queue.ids,
      queueCurrentId: queue.currentId,
    };
  },
  closeMiniPlayer: () => closePlayerSession(),
  setQueueCurrent: setPlayQueueCurrent,
  removeFromQueue: removeFromPlayQueue,
};

/** Removes every trace of a library video that has just moved to Private. Never rejects. */
export function hidePrivateTracesNow(mediaId: string): Promise<PrivateTracesReport> {
  return hidePrivateTraces(mediaId, runtimeDeps);
}
