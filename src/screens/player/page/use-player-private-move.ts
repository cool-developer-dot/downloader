import { router as appRouter, type useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { isDeviceMediaId } from '@/player/device-media';
import { isExternalMediaId } from '@/player/external-media';
import { queueNeighbours, removeFromPlayQueue, setPlayQueueCurrent, usePlayQueueStore } from '@/player/play-queue';
import { isStreamMediaId } from '@/player/remote-stream';
import { closePlayerSession } from '@/player/session-host';
import type { PlayerController } from '@/player/types';
import { canMoveMediaToPrivate } from '@/privacy/private-folder';
import { canMoveToPrivateFolder, isPrivateFolderAvailable } from '@/privacy/private-folder.runtime';
import { usePrivateMove, type PrivateMoveController } from '@/screens/private/usePrivateMove';
import { useDownloadsStore } from '@/store/downloads';

/**
 * P11 #686 in the Player: ⋮ → Tools → "Move to Private" for a library video. It is Private's own move (H21's
 * `usePrivateMove` and `PrivateMoveDialog`): App Lock must be on (else it offers to set it up), the confirm always
 * says that private videos are lost if VidoraX is uninstalled and the first move needs "I understand", and a Gallery
 * copy can be removed too. The video is paused when the move starts. After it, as P9's Quick Delete: the next video
 * in the queue plays, or the Player closes. The move itself forgets the video everywhere (`src/privacy`).
 */
export function usePlayerPrivateMove({
  mediaId,
  controller,
  endLongPress,
  bumpControls,
  sessionKey,
  restorePresentation,
  router,
}: {
  mediaId: string | null;
  controller: PlayerController;
  endLongPress: () => void;
  bumpControls: () => void;
  sessionKey: Parameters<typeof closePlayerSession>[0];
  restorePresentation: () => Promise<void>;
  router: ReturnType<typeof useRouter>;
}) {
  // A finished video in VidoraX's library (as Quick Delete), which the native library keeps (the vault reads it).
  const inLibrary = useDownloadsStore((state) =>
    mediaId != null ? (state.itemsById[mediaId] ?? state.engineRowsById[mediaId])?.status === 'COMPLETED' : false,
  );
  const available = canMoveMediaToPrivate({
    mediaId,
    isLibraryVideo: inLibrary && canMoveToPrivateFolder(mediaId),
    isDeviceVideo: isDeviceMediaId(mediaId),
    isExternalFile: isExternalMediaId(mediaId),
    isStream: isStreamMediaId(mediaId),
    vaultAvailable: isPrivateFolderAvailable(),
  });

  const onMoved = useCallback(
    (id: string) => {
      // P6's queue: the next video becomes the one playing, then the moved one leaves the queue.
      const { nextId } = queueNeighbours(usePlayQueueStore.getState().ids, id);
      const next = nextId != null && nextId !== id ? nextId : null;
      setPlayQueueCurrent(next);
      removeFromPlayQueue(id);
      if (next) {
        bumpControls();
        appRouter.setParams({ id: next });
        return;
      }
      // Nothing next: the Player closes, and its session too (the mini player must not go on with a moved file).
      closePlayerSession(sessionKey);
      void (async () => {
        await restorePresentation();
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/library');
        }
      })();
    },
    [bumpControls, restorePresentation, router, sessionKey],
  );

  const move = usePrivateMove(onMoved);
  const { confirm, request, cancel } = move;

  // The video pauses when the move starts (the encryption reads its file), not when the dialog opens.
  const confirmPaused = useCallback(
    async (understood?: boolean, removeGallery?: boolean) => {
      try {
        controller.pause();
      } catch {
        // already released
      }
      await confirm(understood, removeGallery);
    },
    [confirm, controller],
  );
  const dialogController = useMemo<PrivateMoveController>(() => ({ ...move, confirm: confirmPaused }), [confirmPaused, move]);

  const run = useCallback(() => {
    endLongPress();
    if (available && mediaId) {
      void request(mediaId);
    }
  }, [available, endLongPress, mediaId, request]);

  const option = useMemo(() => ({ moveToPrivate: { available, run } }), [available, run]);

  return {
    /** The options sheet's context field (`PlayerOptionContext.privacy`). */
    option,
    /** For `PrivateMoveDialog`. */
    controller: dialogController,
    sheetOpen: move.dialog.kind !== 'closed',
    /** The Player locks: the dialog closes (not while a move runs). */
    close: cancel,
  };
}
