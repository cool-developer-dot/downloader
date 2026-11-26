import { Image } from 'expo-image';
import { memo } from 'react';
import { View } from 'react-native';

import { Pressable } from '@/components/base/Pressable';
import { ds, DsIcon, DsIconButton, dsThumbColors } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, formatFileSize } from '@/media-detection/utils/format';
import { useTranslation } from '@/localization';
import type { VaultItem } from '@/private-vault/vault-index';

import { privateKindOf } from './private-filters';

export type VaultGridTileProps = {
  item: VaultItem;
  /** `data:` URI, decrypted into memory only while the section is open. */
  thumbnail: string | null;
  size: number;
  onPlay: (id: string) => void;
  onMore: (id: string) => void;
};

/**
 * Design 29's vault tile: the decrypted thumbnail (memory only) or a coloured block, with ▶ on a video. A tap plays it,
 * ⋮ (or a long press) opens its actions. An item that can't be opened shows the warning sign and offers only Delete.
 */
export const VaultGridTile = memo(function VaultGridTile({ item, thumbnail, size, onPlay, onMore }: VaultGridTileProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const title = item.unreadable ? t('privateVault.unreadableTitle') : item.title || t('privateVault.untitled');
  const details = item.unreadable
    ? t('privateVault.unreadableNote')
    : [formatDuration(item.durationMs != null ? item.durationMs / 1000 : null), formatFileSize(item.sizeBytes)].filter(Boolean).join(' · ');
  const kind = privateKindOf(item);
  const palette = dsThumbColors.video;

  return (
    <View style={{ width: size, height: size }}>
      <Pressable
        onPress={() => (item.unreadable ? onMore(item.id) : onPlay(item.id))}
        onLongPress={() => onMore(item.id)}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={t('privateVault.itemA11y', { title, details })}
        accessibilityHint={item.unreadable ? t('privateVault.unreadableHint') : t('privateVault.playHint')}
        testID={`private-item-${item.id}`}
        style={{
          width: size,
          height: size,
          borderRadius: ds.radius.tile,
          overflow: 'hidden',
          backgroundColor: item.unreadable ? theme.colors.card : palette.base,
          borderWidth: item.unreadable ? 1 : 0,
          borderColor: theme.colors.cardBorder,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {thumbnail && !item.unreadable ? (
          // Never cached: a decrypted private thumbnail must not reach the image cache on disk.
          <Image source={{ uri: thumbnail }} cachePolicy="none" style={{ position: 'absolute', width: size, height: size }} contentFit="cover" />
        ) : null}
        {item.unreadable ? (
          <DsIcon name="alert-triangle" size={22} color="error" strokeWidth={2} />
        ) : kind === 'video' ? (
          <DsIcon name="play" size={20} color="#FFFFFF" fill="#FFFFFF" strokeWidth={2} />
        ) : kind === 'audio' ? (
          <DsIcon name="music" size={20} color="#FFFFFF" strokeWidth={2} />
        ) : !thumbnail ? (
          <DsIcon name="image" size={20} color="#FFFFFF" strokeWidth={2} />
        ) : null}
      </Pressable>
      <View style={{ position: 'absolute', top: 0, end: 0 }}>
        <DsIconButton
          variant="plain"
          icon="ellipsis-vertical"
          iconSize={16}
          accessibilityLabel={t('privateVault.moreA11y', { title })}
          onPress={() => onMore(item.id)}
          testID={`private-item-${item.id}-more`}
        />
      </View>
    </View>
  );
});
