import { Image } from 'expo-image';
import { memo, useCallback, useMemo, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { BookmarkEntry } from '@/storage/types';
import { buildFaviconUrl } from '@/screens/bookmarks/utils/bookmark-format';

import { quickAccessTokens } from '@/browser/components/QuickAccess/quick-access-tokens';

export type BookmarkSiteCardProps = {
  bookmark: BookmarkEntry;
  onPress: (url: string) => void;
  testID?: string;
};

export const BookmarkSiteCard = memo(function BookmarkSiteCard({
  bookmark,
  onPress,
  testID,
}: BookmarkSiteCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [faviconFailed, setFaviconFailed] = useState(false);

  const faviconUrl = useMemo(
    () => bookmark.faviconUrl ?? buildFaviconUrl(bookmark.hostname),
    [bookmark.faviconUrl, bookmark.hostname],
  );

  const handlePress = useCallback(() => {
    onPress(bookmark.url);
  }, [bookmark.url, onPress]);

  const label = bookmark.title || bookmark.hostname || bookmark.url;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t('browser.home.openBookmarkA11y', { title: label })}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: quickAccessTokens.tileMinHeight,
        minWidth: quickAccessTokens.minTouchTarget,
        borderRadius: quickAccessTokens.tileRadius,
        paddingVertical: quickAccessTokens.tilePaddingY,
        paddingHorizontal: quickAccessTokens.tilePaddingX,
        alignItems: 'center',
        justifyContent: 'center',
        gap: quickAccessTokens.labelGap,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.92 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}>
      <Box
        center
        style={{
          width: quickAccessTokens.tileIconSize,
          height: quickAccessTokens.tileIconSize,
          borderRadius: quickAccessTokens.iconContainerRadius,
          backgroundColor: theme.colors.surface,
          overflow: 'hidden',
        }}>
        {faviconUrl && !faviconFailed ? (
          <Image
            source={{ uri: faviconUrl }}
            style={{
              width: quickAccessTokens.faviconSize,
              height: quickAccessTokens.faviconSize,
            }}
            contentFit="contain"
            onError={() => setFaviconFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Icon name="bookmark-outline" size="md" color="primary" />
        )}
      </Box>

      <Text variant="bodySmall" align="center" numberOfLines={2} style={{ lineHeight: 18 }}>
        {label}
      </Text>
    </Pressable>
  );
});
