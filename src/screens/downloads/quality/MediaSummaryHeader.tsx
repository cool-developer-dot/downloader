import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import {
  buildMediaInfoLine,
  resolveDisplayHost,
  resolveDisplayTitle,
  type AnalyzedMediaSelection,
} from '@/downloads/quality';
import { useTheme } from '@/hooks/use-theme';
import { primaryAlphas } from '@/theme';

export type MediaSummaryHeaderProps = {
  selection: AnalyzedMediaSelection;
  testID?: string;
};

export const MediaSummaryHeader = memo(function MediaSummaryHeader({
  selection,
  testID = 'quality-media-summary',
}: MediaSummaryHeaderProps) {
  const theme = useTheme();
  const primary = primaryAlphas(theme.colors.primary);
  const [imageFailed, setImageFailed] = useState(false);

  const title = resolveDisplayTitle(selection);
  const host = resolveDisplayHost(selection);
  const info = buildMediaInfoLine(selection);
  const thumbnail = selection.thumbnailUrl?.trim();
  const showImage = Boolean(thumbnail) && !imageFailed;

  const placeholderIcon =
    selection.mediaType === 'audio'
      ? 'music-note'
      : selection.mediaType === 'stream'
        ? 'broadcast'
        : 'play-circle-outline';

  return (
    <Box
      testID={testID}
      row
      gap={14}
      p={14}
      borderRadius="md"
      style={{
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        alignItems: 'center',
      }}
      accessibilityRole="text"
      accessibilityLabel={[title, host, info].filter(Boolean).join('. ')}>
      <Box
        style={{
          width: 64,
          height: 64,
          borderRadius: theme.radius.sm,
          overflow: 'hidden',
          backgroundColor: primary.medium,
        }}
        accessibilityRole="image"
        accessibilityLabel={showImage ? 'Media thumbnail' : 'Media placeholder'}>
        {showImage ? (
          <Image
            source={{ uri: thumbnail }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            transition={160}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Box flex={1} center>
            <Icon name={placeholderIcon} size={28} color="primary" />
          </Box>
        )}
      </Box>

      <Box flex={1} gap={4} style={{ justifyContent: 'center' }}>
        <Text variant="subtitle" numberOfLines={2}>
          {title}
        </Text>
        {host ? (
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {host}
          </Text>
        ) : null}
        {info ? (
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {info}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
});
