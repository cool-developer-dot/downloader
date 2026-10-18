import { Image } from 'expo-image';
import { memo, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import {
  formatContainerLabel,
  formatQualityFileSize,
  formatStreamPresentation,
  resolveDisplayTitle,
  type AnalyzedMediaSelection,
  type DownloadQualityOption,
} from '@/downloads/quality';
import { formatDuration } from '@/media-detection/utils';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { TranslationKey } from '@/localization/types';
import { primaryAlphas } from '@/theme';

export type MediaResultCardProps = {
  selection: AnalyzedMediaSelection;
  selectedOption: DownloadQualityOption | null;
  testID?: string;
};

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

function formatAudioStatus(option: DownloadQualityOption | null, t: Translate): string | null {
  if (!option) {
    return null;
  }
  if (option.hasAudio === true && option.hasVideo === true) {
    return t('mediaResult.audioIncluded');
  }
  if (option.hasAudio === false && option.hasVideo === true) {
    return t('mediaResult.videoOnly');
  }
  if (option.isAudioOnly || option.hasVideo === false) {
    return t('mediaResult.audioOnly');
  }
  return null;
}

function formatSizeLabel(option: DownloadQualityOption | null, t: Translate): string {
  if (!option) {
    return t('mediaResult.calculating');
  }
  const exact = formatQualityFileSize(option.estimatedFileSize ?? option.fileSize);
  if (exact) {
    return exact.replace(/^≈\s*/, '');
  }
  return t('mediaResult.calculating');
}

export const MediaResultCard = memo(function MediaResultCard({
  selection,
  selectedOption,
  testID = 'quality-media-result-card',
}: MediaResultCardProps) {
  const theme = useTheme();
  const primary = primaryAlphas(theme.colors.primary);
  const { t } = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);

  const title = resolveDisplayTitle(selection);
  const thumbnail = selection.thumbnailUrl?.trim();
  const showImage = Boolean(thumbnail) && !imageFailed;

  const formatLabel =
    (selectedOption && formatStreamPresentation(selectedOption)) ||
    formatContainerLabel(selection.container) ||
    '—';

  const qualityLabel = selectedOption?.label ?? '—';
  const sizeLabel = formatSizeLabel(selectedOption, t);
  const durationLabel = formatDuration(selection.duration) ?? '—';
  const audioLabel = formatAudioStatus(selectedOption, t) ?? '—';

  const platformLabel = useMemo(() => {
    const platform = selection.platform?.trim().toUpperCase() ?? '';
    if (platform.includes('TIKTOK')) {
      return 'TikTok Video';
    }
    if (platform.includes('INSTAGRAM')) {
      return 'Instagram Reel';
    }
    if (platform.includes('FACEBOOK')) {
      return 'Facebook Video';
    }
    return selection.platform?.trim() || null;
  }, [selection.platform]);

  const placeholderIcon =
    selection.mediaType === 'audio'
      ? 'music-note'
      : selection.mediaType === 'stream'
        ? 'broadcast'
        : 'play-circle-outline';

  const rows = [
    { label: t('downloads.infoFormat'), value: formatLabel },
    { label: t('downloads.infoQuality'), value: qualityLabel },
    { label: t('downloads.infoFileSize'), value: sizeLabel },
    { label: t('downloads.infoDuration'), value: durationLabel },
    { label: t('mediaResult.audio'), value: audioLabel },
  ];

  return (
    <Box
      testID={testID}
      gap={14}
      p={16}
      borderRadius="md"
      style={{
        backgroundColor: theme.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
      }}
      accessibilityRole="summary"
      accessibilityLabel={t('mediaResult.videoFoundA11y', { title })}>
      <Box row gap={14} style={{ alignItems: 'center' }}>
        <Box
          style={{
            width: 88,
            height: 88,
            borderRadius: theme.radius.md,
            overflow: 'hidden',
            backgroundColor: primary.medium,
          }}
          accessibilityRole="image"
          accessibilityLabel={showImage ? t('mediaResult.thumbnailA11y') : t('mediaResult.placeholderA11y')}>
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
              <Icon name={placeholderIcon} size={32} color="primary" />
            </Box>
          )}
        </Box>

        <Box flex={1} gap={6}>
          <Text variant="caption" color="primary">
            {`✓ ${t('mediaResult.videoFound')}`}
          </Text>
          <Text variant="title" numberOfLines={2}>
            {title}
          </Text>
          {platformLabel ? (
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {platformLabel}
            </Text>
          ) : null}
        </Box>
      </Box>

      <Box
        gap={0}
        borderRadius="sm"
        style={{
          overflow: 'hidden',
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        }}>
        {rows.map((row, index) => (
          <Box
            key={row.label}
            row
            px={14}
            py={12}
            style={{
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor:
                index % 2 === 0 ? theme.colors.background : theme.colors.surface,
            }}>
            <Text variant="caption" color="textSecondary">
              {row.label}
            </Text>
            <Text variant="bodySmall" style={{ fontWeight: '600' }}>
              {row.value}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
});
