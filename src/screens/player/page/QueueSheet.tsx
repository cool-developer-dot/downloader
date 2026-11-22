import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { DsIconButton, DsRow, DsRowGroup, DsText } from '@/design';
import { useTranslation } from '@/localization';
import { formatPlaybackTime } from '@/player/format-time';
import { queueMediaDuration, queueMediaTitle, type QueueMediaIndex } from '@/player/queue-media';

import { PlayerSheetFrame } from './PlayerSheetFrame';

/** The most rows the sheet draws at once (a long library list stays quick): a few before the video playing, the rest after. */
export const QUEUE_SHEET_MAX_ROWS = 100;
const ROWS_BEFORE_CURRENT = 5;

export type QueueSheetProps = {
  visible: boolean;
  ids: readonly string[];
  currentId: string | null;
  index: QueueMediaIndex;
  shuffled: boolean;
  autoPlayNext: boolean;
  onShuffle: (on: boolean) => void;
  onAutoPlayNext: (on: boolean) => void;
  onPlay: (mediaId: string) => void;
  onMove: (mediaId: string, delta: -1 | 1) => void;
  onRemove: (mediaId: string) => void;
  onClose: () => void;
};

/**
 * P6 #619 Play Queue ("Up next"): the videos played in turn, the one playing marked. Tap one to play it; move it up or
 * down; remove it (not the one playing). Shuffle (#542) and Auto play next (#534) are switches at the top.
 */
export const QueueSheet = memo(function QueueSheet({
  visible,
  ids,
  currentId,
  index,
  shuffled,
  autoPlayNext,
  onShuffle,
  onAutoPlayNext,
  onPlay,
  onMove,
  onRemove,
  onClose,
}: QueueSheetProps) {
  const { t } = useTranslation();
  const at = currentId ? ids.indexOf(currentId) : -1;
  const start = Math.max(0, Math.min(at - ROWS_BEFORE_CURRENT, ids.length - QUEUE_SHEET_MAX_ROWS));
  const shown = ids.slice(start, start + QUEUE_SHEET_MAX_ROWS);
  const titleOf = (id: string) => queueMediaTitle(index, id) ?? t('player.untitled');
  return (
    <PlayerSheetFrame
      visible={visible}
      title={t('videoPlayer.upNext')}
      subtitle={t('videoPlayer.queueSheetHint')}
      onClose={onClose}
      testID="player-queue-sheet">
      <DsRowGroup>
        <DsRow
          icon="shuffle"
          title={t('videoPlayer.shuffle')}
          subtitle={t('videoPlayer.shuffleHint')}
          disabled={ids.length < 2}
          toggle={{ value: shuffled, onValueChange: onShuffle, accessibilityLabel: t('videoPlayer.shuffle') }}
          testID="player-queue-shuffle"
        />
        <DsRow
          icon="skip-forward"
          title={t('videoPlayer.upNextSubtitle')}
          subtitle={t('videoPlayer.autoPlayNextHint')}
          toggle={{ value: autoPlayNext, onValueChange: onAutoPlayNext, accessibilityLabel: t('videoPlayer.upNextSubtitle') }}
          testID="player-queue-auto-play-next"
        />
      </DsRowGroup>
      {ids.length === 0 ? (
        <DsText variant="rowSub" testID="player-queue-empty">
          {t('videoPlayer.queueEmpty')}
        </DsText>
      ) : (
        <>
          <DsText variant="section" accessibilityRole="header" style={styles.heading}>
            {shown.length < ids.length
              ? t('videoPlayer.queueShowing', { shown: shown.length, count: ids.length })
              : t('videoPlayer.queueCount', { count: ids.length })}
          </DsText>
          <DsRowGroup testID="player-queue-list">
            {shown.map((id, offset) => {
              const position = start + offset;
              const title = titleOf(id);
              const playing = id === currentId;
              const missing = index.get(id)?.missing === true;
              const duration = queueMediaDuration(index, id);
              return (
                <DsRow
                  key={id}
                  icon={playing ? 'circle-play' : 'film'}
                  title={title}
                  subtitle={
                    playing
                      ? t('videoPlayer.queueNowPlaying')
                      : missing
                        ? t('videoPlayer.queueMissing')
                        : duration != null
                          ? formatPlaybackTime(duration)
                          : undefined
                  }
                  disabled={missing && !playing}
                  onPress={playing || missing ? undefined : () => onPlay(id)}
                  accessibilityLabel={playing ? `${title}, ${t('videoPlayer.queueNowPlaying')}` : t('videoPlayer.queuePlayA11y', { title })}
                  trailing={
                    <View style={styles.actions}>
                      <DsIconButton
                        icon="chevron-up"
                        variant="plain"
                        disabled={position === 0}
                        accessibilityLabel={t('videoPlayer.queueMoveUpA11y', { title })}
                        onPress={() => onMove(id, -1)}
                        testID={`player-queue-up-${position}`}
                      />
                      <DsIconButton
                        icon="chevron-down"
                        variant="plain"
                        disabled={position === ids.length - 1}
                        accessibilityLabel={t('videoPlayer.queueMoveDownA11y', { title })}
                        onPress={() => onMove(id, 1)}
                        testID={`player-queue-down-${position}`}
                      />
                      {playing ? null : (
                        <DsIconButton
                          icon="x"
                          variant="plain"
                          accessibilityLabel={t('videoPlayer.queueRemoveA11y', { title })}
                          onPress={() => onRemove(id)}
                          testID={`player-queue-remove-${position}`}
                        />
                      )}
                    </View>
                  }
                  testID={`player-queue-item-${position}`}
                />
              );
            })}
          </DsRowGroup>
        </>
      )}
    </PlayerSheetFrame>
  );
});

const styles = StyleSheet.create({
  heading: {
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
