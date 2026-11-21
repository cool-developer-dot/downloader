import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsCard, DsIcon, DsIconButton, DsText, DsThumb } from '@/design';
import { useRtl, useTranslation } from '@/localization';
import type { FavoriteItem as FavoriteEntry } from '@/store/favorites';

import {
  buildFavoriteMetaLine,
  formatFavoriteHost,
} from '../utils/favorite-format';

export type FavoriteItemProps = {
  item: FavoriteEntry;
  unavailable?: boolean;
  removing?: boolean;
  onPress: (item: FavoriteEntry) => void;
  onRemove: (item: FavoriteEntry) => void;
  testID?: string;
};

/** The same thumbnail width as the Downloads cards (design 10). */
const THUMB_WIDTH = 64;

/** A favorite as the design's white card: thumbnail · title / platform · date / host · a heart, with ✕ to remove. */
export const FavoriteItem = memo(function FavoriteItem({
  item,
  unavailable = false,
  removing = false,
  onPress,
  onRemove,
  testID,
}: FavoriteItemProps) {
  const rtl = useRtl();
  const { t } = useTranslation();
  const title = item.title?.trim() || formatFavoriteHost(item.sourceUrl) || t('favorites.title');
  const meta = buildFavoriteMetaLine(item);
  const host = formatFavoriteHost(item.sourceUrl);

  const handlePress = useCallback(() => {
    onPress(item);
  }, [item, onPress]);

  const handleRemove = useCallback(() => {
    onRemove(item);
  }, [item, onRemove]);

  const a11yLabel = unavailable
    ? t('favorites.itemUnavailableA11y', { title })
    : t('favorites.itemA11y', { title, meta });

  return (
    <DsCard testID={testID} style={{ marginBottom: 8, opacity: unavailable ? 0.8 : 1 }}>
      <Pressable
        onPress={handlePress}
        onLongPress={handleRemove}
        delayLongPress={420}
        disabled={removing}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={unavailable ? t('favorites.unavailableHint') : t('favorites.openHint')}
        accessibilityState={{ disabled: removing }}
        style={{ margin: -ds.space.cardPad, padding: ds.space.cardPad }}>
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'flex-start', gap: ds.space.rowGap }}>
          <DsThumb uri={item.thumbnailUrl || null} kind="video" width={THUMB_WIDTH} />
          <View style={{ flex: 1, minWidth: 0, paddingEnd: 28 }}>
            <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 6 }}>
              <DsText variant="rowTitle" numberOfLines={2} style={{ flexShrink: 1 }}>
                {title}
              </DsText>
              <DsIcon name="heart" size={14} color="primary" strokeWidth={2.2} accessibilityLabel={t('favorites.favoritedA11y')} />
            </View>
            {meta ? (
              <DsText variant="rowSub" numberOfLines={1} style={{ marginTop: 1 }}>
                {meta}
              </DsText>
            ) : null}
            <DsText variant="rowSub" color={unavailable ? 'primary' : 'textSecondary'} numberOfLines={1}>
              {unavailable ? t('favorites.downloadUnavailableLabel') : host}
            </DsText>
          </View>
        </View>
      </Pressable>

      <View style={{ position: 'absolute', top: 0, end: 0 }}>
        <DsIconButton
          variant="plain"
          icon="x"
          iconSize={18}
          onPress={handleRemove}
          disabled={removing}
          accessibilityLabel={t('favorites.removeItemA11y', { title })}
          accessibilityHint={t('favorites.removeOnlyHint')}
          testID={testID ? `${testID}-remove` : undefined}
        />
      </View>
    </DsCard>
  );
});
