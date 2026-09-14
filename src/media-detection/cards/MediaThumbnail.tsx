import { Image } from 'expo-image';
import { memo, useEffect, useMemo, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import { DISCOVERY_LAYOUT } from '../quality';
import { isSafeMediaUrl } from '../utils';

export type MediaThumbnailProps = {
  uri: string | null | undefined;
  category: 'video' | 'audio' | 'stream';
  durationLabel?: string | null;
  testID?: string;
};

export const MediaThumbnail = memo(function MediaThumbnail({
  uri,
  category,
  durationLabel,
  testID = 'media-thumbnail',
}: MediaThumbnailProps) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const size = DISCOVERY_LAYOUT.thumbnailSize;

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const safeUri = useMemo(() => {
    if (!uri || failed) {
      return null;
    }
    return isSafeMediaUrl(uri) ? uri : null;
  }, [uri, failed]);

  const placeholderIcon =
    category === 'audio' ? 'music-note' : category === 'stream' ? 'broadcast' : 'play-circle-outline';

  return (
    <Box
      testID={testID}
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.md,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
      accessibilityRole="image"
      accessibilityLabel={safeUri ? 'Media thumbnail' : 'Media placeholder'}>
      {safeUri ? (
        <Image
          source={{ uri: safeUri }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={180}
          onError={() => setFailed(true)}
        />
      ) : (
        <Box flex={1} center>
          <Icon name={placeholderIcon} size={28} color="secondary" />
        </Box>
      )}
      {durationLabel ? (
        <Box
          style={{
            position: 'absolute',
            right: theme.spacing[4],
            bottom: theme.spacing[4],
            backgroundColor: theme.colors.overlay,
            borderRadius: theme.radius.xs,
            paddingHorizontal: theme.spacing[4],
            paddingVertical: 1,
          }}>
          <Text variant="caption" color="white">
            {durationLabel}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
