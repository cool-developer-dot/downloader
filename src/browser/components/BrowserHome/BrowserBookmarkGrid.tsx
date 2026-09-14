import { memo, useCallback, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import {
  resolveQuickAccessGap,
  resolveQuickAccessTileWidth,
} from '@/browser/components/QuickAccess';
import { useTranslation } from '@/localization';
import type { BookmarkEntry } from '@/storage/types';

import { BookmarkSiteCard } from './BookmarkSiteCard';
import { browserHomeTokens } from './browser-home-tokens';

export type BrowserBookmarkGridProps = {
  bookmarks: BookmarkEntry[];
  loading: boolean;
  onOpenSite: (url: string) => void;
  testID?: string;
};

export const BrowserBookmarkGrid = memo(function BrowserBookmarkGrid({
  bookmarks,
  loading,
  onOpenSite,
  testID = 'browser-bookmark-grid',
}: BrowserBookmarkGridProps) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const gap = resolveQuickAccessGap(width);

  const tileWidth = useMemo(
    () =>
      resolveQuickAccessTileWidth({
        windowWidth: width,
        horizontalPadding: browserHomeTokens.screenPaddingX,
      }),
    [width],
  );

  const handlePress = useCallback(
    (url: string) => {
      onOpenSite(url);
    },
    [onOpenSite],
  );

  if (!loading && bookmarks.length === 0) {
    return (
      <Box testID={`${testID}-empty`} center py={24} px={16} gap={8}>
        <Text variant="bodySmall" color="textSecondary" align="center">
          {t('browser.home.noBookmarks')}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      testID={testID}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap,
      }}>
      {bookmarks.map((bookmark) => (
        <Box key={bookmark.id} style={{ width: tileWidth }}>
          <BookmarkSiteCard
            bookmark={bookmark}
            onPress={handlePress}
            testID={`${testID}-item-${bookmark.id}`}
          />
        </Box>
      ))}
    </Box>
  );
});
