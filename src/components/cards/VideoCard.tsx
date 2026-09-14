import { Image } from 'expo-image';
import { memo } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import { Card } from './Card';

export type VideoCardProps = {
  title: string;
  subtitle?: string;
  thumbnailUri?: string;
  duration?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const VideoCard = memo(function VideoCard({
  title,
  subtitle,
  thumbnailUri,
  duration,
  onPress,
  style,
  testID,
}: VideoCardProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}>
      <Card padding={0} style={style}>
        <Box
          style={{
            height: theme.spacing[48] * 3,
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.md,
            borderTopRightRadius: theme.radius.md,
            overflow: 'hidden',
          }}>
          {thumbnailUri ? (
            <Image source={{ uri: thumbnailUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
          ) : null}
          {duration ? (
            <Box
              style={{
                position: 'absolute',
                right: theme.spacing[8],
                bottom: theme.spacing[8],
                backgroundColor: theme.colors.overlay,
                borderRadius: theme.radius.sm,
                paddingHorizontal: theme.spacing[8],
                paddingVertical: theme.spacing[4],
              }}>
              <Text variant="caption" color="white">
                {duration}
              </Text>
            </Box>
          ) : null}
        </Box>
        <Box p={12} gap={4}>
          <Text variant="subtitle" numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="bodySmall" color="textSecondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </Box>
      </Card>
    </Pressable>
  );
});
