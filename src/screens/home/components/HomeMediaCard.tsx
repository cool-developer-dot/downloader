import { memo, useCallback, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Card } from '@/components/cards/Card';
import { ProgressBar } from '@/components/common/ProgressBar';
import { useTranslation } from '@/localization';
import { useHomeLayout } from '../theme/home-layout';
import type { HomeMediaTile } from '../utils/home-derive';

export type HomeMediaCardProps = {
  item: HomeMediaTile;
  onPress: (mediaId: string) => void;
  showProgress?: boolean;
  testID?: string;
};

export const HomeMediaCard = memo(function HomeMediaCard({
  item,
  onPress,
  showProgress = false,
  testID,
}: HomeMediaCardProps) {
  const layout = useHomeLayout();
  const { t } = useTranslation();
  const [thumbFailed, setThumbFailed] = useState(false);
  const showBar = showProgress && item.progressPercent != null;
  const progressMeta = [item.progressLabel, item.resumeLabel]
    .filter(Boolean)
    .join(' · ') || null;

  const handlePress = useCallback(() => {
    onPress(item.mediaId);
  }, [item.mediaId, onPress]);

  const a11yParts = [
    item.title,
    item.subtitle,
    showProgress ? item.resumeLabel : null,
    item.lastPlayedLabel,
  ].filter(Boolean);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={a11yParts.join('. ')}
      accessibilityHint={t('home.resumeA11y')}
      testID={testID}
      style={{ width: layout.cardWidth }}>
      <Card padding={8} elevation="sm" borderRadius="md">
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            borderRadius: layout.thumbRadius,
            overflow: 'hidden',
            aspectRatio: 16 / 9,
            backgroundColor: layout.theme.colors.surface,
          }}>
          {item.thumbnailUri && !thumbFailed ? (
            <Image
              source={{ uri: item.thumbnailUri }}
              recyclingKey={item.mediaId}
              cachePolicy="disk"
              transition={200}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <Box flex={1} center>
              <Icon name="video-outline" size="md" color="secondary" />
            </Box>
          )}
        </View>
        <Text
          variant="bodySmall"
          numberOfLines={2}
          style={{ marginTop: layout.metaGap }}>
          {item.title}
        </Text>
        {item.subtitle ? (
          <Text
            variant="caption"
            color="textSecondary"
            numberOfLines={1}
            style={{ marginTop: layout.titleGap }}>
            {item.subtitle}
          </Text>
        ) : null}
        {showBar ? (
          <>
            <ProgressBar
              progress={(item.progressPercent ?? 0) / 100}
              style={{
                marginTop: layout.metaGap,
                height: layout.progressHeight,
                borderRadius: layout.theme.radius.xs,
              }}
              accessibilityLabel={
                item.progressLabel
                  ? `Watch progress ${item.progressLabel}`
                  : 'Watch progress'
              }
            />
            {progressMeta ? (
              <Text
                variant="caption"
                color="textSecondary"
                numberOfLines={1}
                style={{ marginTop: layout.titleGap }}>
                {progressMeta}
              </Text>
            ) : null}
          </>
        ) : item.lastPlayedLabel ? (
          <Text
            variant="caption"
            color="textSecondary"
            numberOfLines={1}
            style={{ marginTop: layout.titleGap }}>
            {item.lastPlayedLabel}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
});
