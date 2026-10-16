import { Image } from 'expo-image';
import { memo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, formatFileSize } from '@/media-detection/utils/format';
import { useTranslation } from '@/localization';
import type { VaultItem } from '@/private-vault/vault-index';
import { formatDownloadDate } from '@/screens/downloads/utils/download-format';

export type VaultItemRowProps = {
  item: VaultItem;
  /** `data:` URI, decrypted into memory only while the section is open. */
  thumbnail: string | null;
  onPlay: (id: string) => void;
  onMore: (id: string) => void;
};

const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 54;

/** One private video: its thumbnail, title, and duration · size · date moved. */
export const VaultItemRow = memo(function VaultItemRow({ item, thumbnail, onPlay, onMore }: VaultItemRowProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const title = item.title || t('privateVault.untitled');
  const details = [
    formatDuration(item.durationMs != null ? item.durationMs / 1000 : null),
    formatFileSize(item.sizeBytes),
    formatDownloadDate(new Date(item.addedAt).toISOString()),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box row rtlRow center gap={12} py={10} px={16}>
      <Pressable
        onPress={() => onPlay(item.id)}
        accessibilityRole="button"
        accessibilityLabel={t('privateVault.itemA11y', { title, details })}
        accessibilityHint={t('privateVault.playHint')}
        style={{ flex: 1 }}
        testID={`private-item-${item.id}`}>
        <Box row rtlRow center gap={12}>
          <View
            style={{
              width: THUMB_WIDTH,
              height: THUMB_HEIGHT,
              borderRadius: 8,
              overflow: 'hidden',
              backgroundColor: theme.colors.surfaceElevated,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {thumbnail ? (
              // Never cached: a private thumbnail must not reach the image cache on disk.
              <Image
                source={{ uri: thumbnail }}
                cachePolicy="none"
                style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
                contentFit="cover"
              />
            ) : (
              <Icon name="lock-outline" size="md" color="secondary" />
            )}
          </View>
          <Box flex={1} gap={4}>
            <Text variant="body" numberOfLines={2}>
              {title}
            </Text>
            {details ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {details}
              </Text>
            ) : null}
          </Box>
        </Box>
      </Pressable>
      <Pressable
        onPress={() => onMore(item.id)}
        accessibilityRole="button"
        accessibilityLabel={t('privateVault.moreA11y', { title })}
        hitSlop={8}
        style={{ padding: 8 }}
        testID={`private-item-more-${item.id}`}>
        <Icon name="dots-vertical" size="md" color="secondary" />
      </Pressable>
    </Box>
  );
});
