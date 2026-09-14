import { memo, useCallback } from 'react';
import { ScrollView } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';

import { HomeMediaCard } from './HomeMediaCard';
import { HomeMediaRowSkeleton } from './HomeMediaRowSkeleton';
import { HomeSectionHeader } from './HomeSectionHeader';
import { useHomeLayout } from '../theme/home-layout';
import type { HomeMediaTile } from '../utils/home-derive';

export type HomeMediaRowProps = {
  title: string;
  items: HomeMediaTile[];
  emptyCopy: string;
  onPressItem: (mediaId: string) => void;
  actionLabel?: string;
  onActionPress?: () => void;
  actionAccessibilityLabel?: string;
  showProgress?: boolean;
  isLoading?: boolean;
  testID?: string;
};

export const HomeMediaRow = memo(function HomeMediaRow({
  title,
  items,
  emptyCopy,
  onPressItem,
  actionLabel,
  onActionPress,
  actionAccessibilityLabel,
  showProgress = false,
  isLoading = false,
  testID,
}: HomeMediaRowProps) {
  const layout = useHomeLayout();

  const handlePress = useCallback(
    (mediaId: string) => {
      onPressItem(mediaId);
    },
    [onPressItem],
  );

  return (
    <Box
      px={16}
      gap={12}
      testID={testID}
      style={{ paddingTop: layout.sectionTop }}>
      <HomeSectionHeader
        title={title}
        actionLabel={items.length > 0 ? actionLabel : undefined}
        onActionPress={items.length > 0 ? onActionPress : undefined}
        actionAccessibilityLabel={actionAccessibilityLabel}
      />
      {isLoading ? (
        <HomeMediaRowSkeleton testID={`${testID}-skeleton`} />
      ) : items.length === 0 ? (
        <Text variant="bodySmall" color="textSecondary">
          {emptyCopy}
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: layout.itemGap }}
        >
          {items.map((item) => (
            <HomeMediaCard
              key={item.mediaId}
              item={item}
              onPress={handlePress}
              showProgress={showProgress}
              testID={`${testID}-${item.mediaId}`}
            />
          ))}
        </ScrollView>
      )}
    </Box>
  );
});
