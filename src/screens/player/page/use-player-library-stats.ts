import { router as appRouter, type useRouter } from 'expo-router';
import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { showAppDialog } from '@/components/modals/app-dialog';
import { useTranslation } from '@/localization';
import { setWatchHistoryPaused, useWatchHistoryPaused } from '@/playback/history-pause-preference';
import { isDeviceMediaId } from '@/player/device-media';
import { isExternalMediaId } from '@/player/external-media';
import { formatPlaybackTime } from '@/player/format-time';
import { removeFromPlayQueue, setPlayQueueCurrent, usePlayQueueStore } from '@/player/play-queue';
import { canQuickDelete, nextAfterQuickDelete } from '@/player/quick-delete';
import { isStreamMediaId } from '@/player/remote-stream';
import { closePlayerSession } from '@/player/session-host';
import type { PlayerController } from '@/player/types';
import {
  bookmarkMarkerFractions,
  bookmarkLabel,
  bookmarkTimeLabel,
  MAX_BOOKMARKS_PER_VIDEO,
  secondsToBookmarkMs,
  type VideoBookmark,
} from '@/player/video-bookmarks';
import {
  addVideoBookmarkAt,
  deleteVideoBookmarkIn,
  loadVideoBookmarks,
  renameVideoBookmarkIn,
  useVideoBookmarks,
} from '@/player/video-bookmarks-store';
import { useDownloadsStore } from '@/store/downloads';

import { announcePlayer } from './use-player-not-yet';

type Naming = { mode: 'add'; positionMs: number } | { mode: 'rename'; bookmark: VideoBookmark };

/**
 * P9 in the Player: Disable History (#687), the video's bookmarks (#705: add, the list sheet, the name dialog, the
 * timeline dots) and Quick Delete (#726). Everything goes through the session's own seek and the app's own delete;
 * nothing here touches the session code.
 */
export function usePlayerLibraryStats({
  mediaId,
  title,
  player,
  controller,
  positionSeconds,
  durationSeconds,
  ready,
  beginSeekPreview,
  commitSeekPreview,
  bumpControls,
  endLongPress,
  sessionKey,
  restorePresentation,
  router,
}: {
  mediaId: string | null;
  title: string | null;
  player: VideoPlayer;
  controller: PlayerController;
  positionSeconds: number;
  durationSeconds: number | null;
  /** The video takes commands (loaded, no error). */
  ready: boolean;
  beginSeekPreview: (seconds: number) => void;
  commitSeekPreview: () => void;
  bumpControls: () => void;
  endLongPress: () => void;
  sessionKey: Parameters<typeof closePlayerSession>[0];
  restorePresentation: () => Promise<void>;
  router: ReturnType<typeof useRouter>;
}) {
  const { t } = useTranslation();

  // ── #687 Disable History ──
  const historyPaused = useWatchHistoryPaused();
  const setHistoryPaused = useCallback(
    (paused: boolean) => {
      setWatchHistoryPaused(paused);
      announcePlayer(t(paused ? 'libraryStats.historyPausedOn' : 'libraryStats.historyPausedOff'));
    },
    [t],
  );

  // ── #705 Video bookmarks ──
  const bookmarkable = mediaId != null && !isExternalMediaId(mediaId) && !isStreamMediaId(mediaId);
  const bookmarks = useVideoBookmarks(bookmarkable ? mediaId : null);
  useEffect(() => {
    if (bookmarkable && mediaId) {
      void loadVideoBookmarks(mediaId);
    }
  }, [bookmarkable, mediaId]);
  const [listOpen, setListOpen] = useState(false);
  const [naming, setNaming] = useState<Naming | null>(null);
  const markers = useMemo(() => bookmarkMarkerFractions(bookmarks, durationSeconds), [bookmarks, durationSeconds]);

  /** The player's own clock (the session's position lags by up to a third of a second). */
  const nowMs = useCallback(() => {
    try {
      const value = player.currentTime;
      if (Number.isFinite(value) && value >= 0) {
        return secondsToBookmarkMs(value);
      }
    } catch {
      // released: the session's position below
    }
    return secondsToBookmarkMs(positionSeconds);
  }, [player, positionSeconds]);

  const startAdd = useCallback(() => {
    endLongPress();
    if (!bookmarkable || !ready) {
      return;
    }
    setNaming({ mode: 'add', positionMs: nowMs() });
  }, [bookmarkable, endLongPress, nowMs, ready]);

  const openList = useCallback(() => {
    endLongPress();
    setListOpen(true);
  }, [endLongPress]);
  const closeList = useCallback(() => setListOpen(false), []);
  const closeNaming = useCallback(() => setNaming(null), []);

  const saveName = useCallback(
    (name: string | null) => {
      const current = naming;
      setNaming(null);
      if (!current || !mediaId) {
        return;
      }
      if (current.mode === 'rename') {
        void renameVideoBookmarkIn(current.bookmark, name);
        return;
      }
      void addVideoBookmarkAt({
        mediaId,
        positionMs: current.positionMs,
        durationMs: durationSeconds != null && durationSeconds > 0 ? durationSeconds * 1000 : null,
        name,
      }).then((outcome) => {
        if (outcome.ok) {
          announcePlayer(t('libraryStats.bookmarkAdded', { time: bookmarkTimeLabel(outcome.bookmark) }));
        } else if (outcome.reason === 'full') {
          announcePlayer(t('libraryStats.bookmarksFull', { max: MAX_BOOKMARKS_PER_VIDEO }));
        } else {
          announcePlayer(t('libraryStats.bookmarkFailed'));
        }
      });
    },
    [durationSeconds, mediaId, naming, t],
  );

  const jump = useCallback(
    (bookmark: VideoBookmark) => {
      setListOpen(false);
      if (!ready) {
        return;
      }
      // The session's exact seek (the timeline's path), as P1's Jump to time.
      beginSeekPreview(bookmark.positionMs / 1000);
      commitSeekPreview();
      bumpControls();
      announcePlayer(t('libraryStats.bookmarkJumped', { time: bookmarkTimeLabel(bookmark) }));
    },
    [beginSeekPreview, bumpControls, commitSeekPreview, ready, t],
  );

  const rename = useCallback((bookmark: VideoBookmark) => setNaming({ mode: 'rename', bookmark }), []);

  const remove = useCallback(
    (bookmark: VideoBookmark) => {
      void showAppDialog({
        title: t('libraryStats.bookmarkDeleteTitle'),
        message: t('libraryStats.bookmarkDeleteMessage', { name: bookmarkLabel(bookmark) }),
        confirmLabel: t('libraryStats.bookmarkDeleteConfirm'),
        cancelLabel: t('common.cancel'),
        variant: 'error',
      }).then(async (confirmed) => {
        if (confirmed && (await deleteVideoBookmarkIn(bookmark))) {
          announcePlayer(t('libraryStats.bookmarkDeleted'));
        }
      });
    },
    [t],
  );

  const closeSheets = useCallback(() => {
    setListOpen(false);
    setNaming(null);
  }, []);

  // ── #726 Quick Delete ──
  // A finished video in the library (the Library's delete is for those; a video still downloading is not offered).
  const inLibrary = useDownloadsStore((state) =>
    mediaId != null ? (state.itemsById[mediaId] ?? state.engineRowsById[mediaId])?.status === 'COMPLETED' : false,
  );
  const deletable = canQuickDelete({
    mediaId,
    inLibrary,
    isDeviceVideo: isDeviceMediaId(mediaId),
    isExternalFile: isExternalMediaId(mediaId),
    isStream: isStreamMediaId(mediaId),
  });
  const deletingRef = useRef(false);

  const quickDelete = useCallback(async () => {
    endLongPress();
    if (!mediaId || !deletable || deletingRef.current) {
      return;
    }
    const hasNext = nextAfterQuickDelete(usePlayQueueStore.getState().ids, mediaId) != null;
    const confirmed = await showAppDialog({
      title: t('libraryStats.quickDeleteTitle', { name: title ?? t('player.untitled') }),
      message: t(hasNext ? 'libraryStats.quickDeleteMessageNext' : 'libraryStats.quickDeleteMessageClose'),
      confirmLabel: t('libraryStats.quickDeleteConfirm'),
      cancelLabel: t('common.cancel'),
      variant: 'error',
    });
    if (!confirmed || deletingRef.current) {
      return;
    }
    deletingRef.current = true;
    try {
      const next = nextAfterQuickDelete(usePlayQueueStore.getState().ids, mediaId);
      try {
        controller.pause();
      } catch {
        // already released
      }
      // The Library's own "Delete from VidoraX" (the same service, loaded the same way).
      const { deleteCompletedFileFromVidoraX } = await import('@/downloads/completed-file/delete/delete-service');
      const result = await deleteCompletedFileFromVidoraX(mediaId);
      if (!result.ok) {
        // As the Library's delete: the video stays, and the user can try again.
        announcePlayer(t('library.deleteFailed'));
        return;
      }
      announcePlayer(t('libraryStats.quickDeleteDone'));
      // P6's queue: the next video becomes the one playing, then the deleted one can leave the queue.
      setPlayQueueCurrent(next);
      removeFromPlayQueue(mediaId);
      if (next) {
        bumpControls();
        appRouter.setParams({ id: next });
        return;
      }
      // Nothing next: the Player closes, and its session too (the mini player must not go on with a deleted file).
      closePlayerSession(sessionKey);
      await restorePresentation();
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/library');
      }
    } finally {
      deletingRef.current = false;
    }
  }, [bumpControls, controller, deletable, endLongPress, mediaId, restorePresentation, router, sessionKey, t, title]);

  /** The options sheet's context field (`PlayerOptionContext.p9`). */
  const option = useMemo(
    () => ({
      historyPaused,
      setHistoryPaused,
      bookmarks: { available: bookmarkable, count: bookmarks.length, add: startAdd, openList },
      quickDelete: {
        available: deletable,
        run: () => {
          void quickDelete();
        },
      },
    }),
    [bookmarkable, bookmarks.length, deletable, historyPaused, openList, quickDelete, setHistoryPaused, startAdd],
  );

  return {
    option,
    markers,
    sheetOpen: listOpen || naming != null,
    closeSheets,
    listSheet: {
      visible: listOpen && naming == null,
      subtitle: title ?? undefined,
      bookmarks,
      nowLabel: formatPlaybackTime(positionSeconds),
      canAdd: bookmarkable && ready,
      onAdd: startAdd,
      onJump: jump,
      onRename: rename,
      onDelete: remove,
      onClose: closeList,
    },
    nameModal: {
      visible: naming != null,
      title: t(naming?.mode === 'rename' ? 'libraryStats.bookmarkRenameTitle' : 'libraryStats.bookmarkNewTitle'),
      timeLabel:
        naming == null
          ? ''
          : naming.mode === 'add'
            ? formatPlaybackTime(naming.positionMs / 1000)
            : bookmarkTimeLabel(naming.bookmark),
      initialName: naming?.mode === 'rename' ? (naming.bookmark.name ?? '') : '',
      onSave: saveName,
      onClose: closeNaming,
    },
  };
}
