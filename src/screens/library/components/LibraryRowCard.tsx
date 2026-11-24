import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsCard, DsIcon, DsIconButton, DsText, DsThumb } from '@/design';
import { canAttemptPlayback, type MediaLibraryItem } from '@/library';
import { useRtl, useTranslation } from '@/localization';
import { formatPlaybackTime } from '@/player/format-time';

import { formatLibraryFileSize } from '../utils/library-format';
import { isAudioItem } from '../utils/library-kind';
import { LibrarySelectMark } from './LibrarySelectMark';

/** Design 18's thumbnail: as wide as the Downloads cards' (design 10), 45 dp tall. */
const THUMB_WIDTH = 64;
const THUMB_HEIGHT = 45;

/** Design 18's second line: quality · size · length ("356p · 23.5 MB · 12:40"), whatever of them is known. */
export function libraryRowMeta(item: Pick<MediaLibraryItem, 'quality' | 'fileSize' | 'duration'>): string {
  const parts = [
    item.quality,
    formatLibraryFileSize(item.fileSize),
    item.duration != null && item.duration > 0 ? formatPlaybackTime(item.duration) : null,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

export type LibraryRowCardProps = {
  item: MediaLibraryItem;
  onPress?: (id: string) => void;
  /** The ⋮ button and a long press: the video's menu. */
  onMore?: (id: string) => void;
  /** P7 selection mode: set (true / false) while selecting; a tap then selects instead of playing. */
  selected?: boolean;
  testID?: string;
};

/** A video of the Player tab as design 18 draws it: a white card with the thumbnail, the title, quality · size · length and ⋮. */
export const LibraryRowCard = memo(function LibraryRowCard({ item, onPress, onMore, selected, testID }: LibraryRowCardProps) {
  const { t } = useTranslation();
  const rtl = useRtl();
  const canPlay = canAttemptPlayback(item.localAvailability);
  const meta = libraryRowMeta(item);
  const missing = item.localAvailability === 'missing';

  const handlePress = useCallback(() => {
    if (canPlay) {
      onPress?.(item.id);
    }
  }, [canPlay, item.id, onPress]);
  const handleMore = useCallback(() => onMore?.(item.id), [item.id, onMore]);

  const a11y = [item.displayName, meta, missing ? t('library.fileUnavailable') : null, item.favorite ? t('library.favoriteA11y') : null]
    .filter(Boolean)
    .join('. ');

  return (
    <DsCard testID={testID} style={{ marginBottom: 8, opacity: missing ? 0.72 : 1 }}>
      <Pressable
        onPress={onPress && canPlay ? handlePress : undefined}
        onLongPress={onMore ? handleMore : undefined}
        delayLongPress={350}
        disabled={!onPress || !canPlay}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={
          selected !== undefined && canPlay
            ? t('playlists.selectHint')
            : canPlay
              ? t('library.longPressHint')
              : t('library.fileUnavailable')
        }
        accessibilityState={{ disabled: !canPlay, selected: selected === true }}
        style={{ margin: -ds.space.cardPad, padding: ds.space.cardPad, paddingEnd: ds.space.cardPad + 30 }}>
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: ds.space.rowGap }}>
          <View>
            <DsThumb
              uri={item.thumbnailUri}
              kind="video"
              icon={isAudioItem(item) ? 'music' : undefined}
              width={THUMB_WIDTH}
              height={THUMB_HEIGHT}
            />
            {selected !== undefined ? <LibrarySelectMark selected={selected} /> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6 }}>
              <DsText variant="rowTitle" numberOfLines={2} style={{ flexShrink: 1 }}>
                {item.displayName}
              </DsText>
              {item.favorite ? <DsIcon name="heart" size={14} color="primary" strokeWidth={2.2} /> : null}
            </View>
            {meta ? (
              <DsText variant="rowSub" numberOfLines={1} style={{ marginTop: 2 }}>
                {meta}
              </DsText>
            ) : null}
            {missing ? (
              <DsText variant="rowSub" color="error" numberOfLines={1}>
                {t('library.fileUnavailable')}
              </DsText>
            ) : null}
          </View>
        </View>
      </Pressable>
      {onMore && selected === undefined ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, end: 4, justifyContent: 'center' }}>
          <DsIconButton
            variant="plain"
            icon="ellipsis-vertical"
            iconSize={18}
            accessibilityLabel={t('playerDesign.itemMenu', { title: item.displayName })}
            onPress={handleMore}
            testID={testID ? `${testID}-more` : undefined}
          />
        </View>
      ) : null}
    </DsCard>
  );
});
