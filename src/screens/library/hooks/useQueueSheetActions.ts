import { useCallback } from 'react';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { useTranslation } from '@/localization';
import { addToPlayQueue, playNextInQueue } from '@/player/play-queue';
import { ensurePlayQueuePersistence } from '@/player/play-queue-persistence';
import { usePlayerSessionHostStore } from '@/player/session-host';
import { announcePlayer } from '@/screens/player/page/use-player-not-yet';

/**
 * P6 #620 Play Next, and Add to queue, in a library video's menu. They act on the queue of the video open in the
 * Player or the mini player, so they show only while one is (and not for that video itself).
 */
export function useQueueSheetActions(): (
  id: string,
  title: string | null,
  close: () => void,
) => ActionSheetItem[] {
  const { t } = useTranslation();
  const playingId = usePlayerSessionHostStore((state) => state.request?.mediaId ?? null);
  return useCallback(
    (id, title, close) => {
      if (!playingId || id === playingId) {
        return [];
      }
      const name = title?.trim() || t('player.untitled');
      return [
        {
          id: 'play-next',
          label: t('videoPlayer.queuePlayNext'),
          icon: 'playlist-play',
          onPress: () => {
            close();
            ensurePlayQueuePersistence();
            playNextInQueue(id, playingId);
            announcePlayer(t('videoPlayer.queuePlayNextDone', { title: name }));
          },
        },
        {
          id: 'add-to-queue',
          label: t('videoPlayer.queueAdd'),
          icon: 'playlist-plus',
          onPress: () => {
            close();
            ensurePlayQueuePersistence();
            const result = addToPlayQueue(id, playingId);
            announcePlayer(
              result === 'already' ? t('videoPlayer.queueAlready') : t('videoPlayer.queueAdded', { title: name }),
            );
          },
        },
      ];
    },
    [playingId, t],
  );
}
