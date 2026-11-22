import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { DsIconButton, DsText, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { formatPlaybackTime } from '@/player/format-time';
import type { PlaylistEntryView } from '@/playlists/playlist-entries';

export type PlaylistEntryRowProps = {
  entry: PlaylistEntryView;
  isFirst: boolean;
  isLast: boolean;
  onPlay: (mediaId: string) => void;
  onMove: (mediaId: string, delta: number) => void;
  onRemove: (mediaId: string) => void;
  testID?: string;
};

/**
 * P7 #618: one video of a playlist. Tap to play from it. Up / down move it one place; ✕ takes it out of the playlist
 * (never deletes the file). A missing video is greyed with the reason, and doesn't play; it can still be moved or
 * removed.
 */
export const PlaylistEntryRow = memo(function PlaylistEntryRow({
  entry,
  isFirst,
  isLast,
  onPlay,
  onMove,
  onRemove,
  testID,
}: PlaylistEntryRowProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const reason =
    entry.missing === 'gone' ? t('playlists.missing') : entry.missing === 'device' ? t('playlists.deviceNotListed') : null;
  const duration =
    entry.durationSeconds != null && entry.durationSeconds > 0 ? formatPlaybackTime(entry.durationSeconds) : null;
  const subtitle = reason ?? duration;
  return (
    <View
      testID={testID}
      style={{ flexDirection: rtl.rowDirection, alignItems: 'center', minHeight: ds.size.rowMinHeight, paddingStart: ds.space.cardPad }}>
      <Pressable
        onPress={() => onPlay(entry.mediaId)}
        accessibilityRole="button"
        accessibilityLabel={subtitle ? `${entry.title}, ${subtitle}` : entry.title}
        accessibilityHint={entry.playable ? t('library.playHint') : undefined}
        accessibilityState={{ disabled: !entry.playable }}
        testID={testID ? `${testID}-play` : undefined}
        style={({ pressed }) => ({
          flex: 1,
          paddingVertical: ds.space.rowPadY,
          gap: 1,
          opacity: entry.playable ? 1 : 0.5,
          backgroundColor: pressed && entry.playable ? theme.colors.surfacePressed : 'transparent',
        })}>
        <DsText variant="rowTitle" numberOfLines={2}>
          {entry.title}
        </DsText>
        {subtitle ? (
          <DsText variant="rowSub" color={reason ? 'error' : 'textSecondary'} numberOfLines={2}>
            {subtitle}
          </DsText>
        ) : null}
      </Pressable>
      {/* DsIconButton draws no disabled look: the first row's ↑ and the last row's ↓ are faded here. */}
      <View style={{ opacity: isFirst ? 0.3 : 1 }}>
        <DsIconButton
          icon="chevron-up"
          variant="plain"
          disabled={isFirst}
          accessibilityLabel={t('playlists.moveUp', { title: entry.title })}
          onPress={() => onMove(entry.mediaId, -1)}
          testID={testID ? `${testID}-up` : undefined}
        />
      </View>
      <View style={{ opacity: isLast ? 0.3 : 1 }}>
        <DsIconButton
          icon="chevron-down"
          variant="plain"
          disabled={isLast}
          accessibilityLabel={t('playlists.moveDown', { title: entry.title })}
          onPress={() => onMove(entry.mediaId, 1)}
          testID={testID ? `${testID}-down` : undefined}
        />
      </View>
      <DsIconButton
        icon="x"
        variant="plain"
        accessibilityLabel={t('playlists.removeItem', { title: entry.title })}
        onPress={() => onRemove(entry.mediaId)}
        testID={testID ? `${testID}-remove` : undefined}
      />
    </View>
  );
});
