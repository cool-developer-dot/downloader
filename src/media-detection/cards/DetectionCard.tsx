import { memo, useEffect, useMemo, useRef } from 'react';
import { Pressable } from 'react-native-gesture-handler';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { GlassCard } from '@/components/cards/GlassCard';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { BROWSER_TOUCH_TARGET } from '@/browser/constants';

import type { MediaDiscoveryViewModel } from '../hooks/useMediaDiscovery';
import { DISCOVERY_LAYOUT } from '../quality';
import {
  formatConfidence,
  formatContainer,
  formatDuration,
  formatFileSize,
  formatWebsite,
} from '../utils';
import { AudioOptionsRow } from './AudioOptionsRow';
import { MediaBadgeRow } from './MediaBadgeRow';
import { MediaThumbnail } from './MediaThumbnail';
import { QualityChipRow } from './QualityChipRow';

export type DetectionCardProps = {
  /** Single subscription lives in the overlay — card is presentational. */
  discovery: MediaDiscoveryViewModel;
  onDismiss?: () => void;
  onDownload?: () => void;
  downloading?: boolean;
  testID?: string;
};

/**
 * Compact premium discovery card — presentation only.
 * Retains last media snapshot during exit so dismiss animation stays populated.
 */
export const DetectionCard = memo(function DetectionCard({
  discovery,
  onDismiss,
  onDownload,
  downloading = false,
  testID = 'media-detection-card',
}: DetectionCardProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const snapshotRef = useRef<MediaDiscoveryViewModel>(discovery);

  useEffect(() => {
    if (discovery.media) {
      snapshotRef.current = discovery;
    }
  }, [discovery]);

  const view = discovery.media ? discovery : snapshotRef.current;
  const { media, qualities, audioOptions, badges, expanded, downloadable, errorMessage, platformStatus } =
    view;

  const metaLine = useMemo(() => {
    if (!media) {
      return null;
    }
    const streamLabel =
      media.streamType === 'HLS'
        ? 'HLS'
        : media.streamType === 'DASH'
          ? 'DASH'
          : null;
    const parts = [
      streamLabel && media.category === 'stream' ? streamLabel : null,
      media.resolution,
      media.codec,
      media.audioCodec,
      formatContainer(
        media.category === 'stream' ? null : media.container,
      ),
      formatFileSize(media.estimatedFileSize),
      formatDuration(media.duration),
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }, [media]);

  const website = media
    ? formatWebsite(media.websiteSource, media.pageUrl)
    : null;

  if (!media) {
    return null;
  }

  const title = media.title?.trim() || website || t('browser.downloadableMedia');
  const durationLabel = formatDuration(media.duration);
  const confidence = formatConfidence(media.confidence);
  const handleDismiss = onDismiss ?? discovery.dismiss;
  const statusLabel = downloadable
    ? t('browser.downloadAvailable')
    : t('browser.mediaDetectedShort');

  return (
    <GlassCard
      testID={testID}
      borderRadius="xl"
      padding={12}
      style={{
        width: '100%',
        maxWidth: DISCOVERY_LAYOUT.cardMaxWidth,
        alignSelf: 'center',
      }}>
      <Box
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        accessibilityLabel={t('browser.discoveryCardA11y', {
          status: statusLabel,
          title,
          meta: metaLine ?? '',
          hint: t('browser.swipeDismissHide'),
        })}>
        <Box center mb={4}>
          <Box
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{
              width: 36,
              height: 4,
              borderRadius: theme.radius.full,
              backgroundColor: theme.colors.border,
            }}
          />
        </Box>

        <Box row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Box row style={{ alignItems: 'center', gap: theme.spacing[8], flexShrink: 1 }}>
            <Icon name="download" size={16} color="primary" />
            <Text variant="label" color="primary" numberOfLines={1}>
              {statusLabel}
            </Text>
          </Box>
          <Pressable
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel={t('common.dismissDiscoveryA11y')}
            accessibilityHint={t('common.dismissDiscoveryHint')}
            hitSlop={12}
            style={{
              minWidth: BROWSER_TOUCH_TARGET,
              minHeight: BROWSER_TOUCH_TARGET,
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: -theme.spacing[8],
            }}>
            <Icon name="close" size={20} color="secondary" />
          </Pressable>
        </Box>

        {platformStatus ? (
          <Box mt={4}>
            <Text variant="caption" color="textSecondary" numberOfLines={2}>
              {platformStatus}
            </Text>
          </Box>
        ) : null}

        <Box row mt={8} style={{ gap: theme.spacing[12] }}>
          <MediaThumbnail
            uri={media.thumbnailUrl}
            category={media.category}
            durationLabel={durationLabel}
          />
          <Box flex={1} style={{ gap: theme.spacing[2], minWidth: 0, justifyContent: 'center' }}>
            <Text variant="subtitle" numberOfLines={1}>
              {title}
            </Text>
            {website ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {website}
              </Text>
            ) : null}
            {metaLine ? (
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {metaLine}
              </Text>
            ) : null}
          </Box>
        </Box>

        {badges.length > 0 ? (
          <Box mt={8}>
            <MediaBadgeRow badges={badges} />
          </Box>
        ) : null}

        {errorMessage ? (
          <Box
            mt={8}
            style={{
              paddingHorizontal: theme.spacing[8],
              paddingVertical: theme.spacing[8],
              borderRadius: theme.radius.sm,
              backgroundColor: theme.colors.warning + '18',
              borderWidth: 1,
              borderColor: theme.colors.warning,
            }}>
            <Text variant="caption" style={{ color: theme.colors.warning }} numberOfLines={2}>
              {errorMessage}
            </Text>
          </Box>
        ) : null}

        {qualities.length > 0 ? (
          <Box mt={8}>
            <QualityChipRow qualities={qualities} compact />
          </Box>
        ) : null}

        {audioOptions.length > 0 ? (
          <Box mt={8}>
            <AudioOptionsRow options={audioOptions} compact />
          </Box>
        ) : null}

        {expanded ? (
          <Box mt={8} gap={2}>
            <DetailRow label={t('browser.formatLabel')} value={formatContainer(media.container)} />
            <DetailRow label={t('browser.typeLabel')} value={media.mimeType} />
            <DetailRow label={t('browser.codecLabel')} value={media.codec} />
            <DetailRow label={t('browser.confidenceLabel')} value={confidence} />
          </Box>
        ) : null}

        <Box row mt={8} style={{ gap: theme.spacing[8] }}>
          <Pressable
            onPress={discovery.toggleExpanded}
            accessibilityRole="button"
            accessibilityLabel={
              expanded ? t('browser.hideDetails') : t('browser.showDetails')
            }
            style={{
              flex: 1,
              minHeight: BROWSER_TOUCH_TARGET,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text variant="button" color="textSecondary">
              {expanded ? t('browser.less') : t('browser.details')}
            </Text>
          </Pressable>

          <Pressable
            testID="media-detection-download-cta"
            onPress={() => {
              if (!downloadable || downloading) {
                return;
              }
              onDownload?.();
            }}
            disabled={!downloadable || downloading}
            accessibilityRole="button"
            accessibilityState={{
              disabled: !downloadable || downloading,
              busy: downloading,
            }}
            accessibilityLabel={
              !downloadable
                ? t('browser.downloadUnavailableMediaA11y')
                : downloading
                  ? t('browser.startingDownloadAnalysisA11y')
                  : t('browser.downloadThisMediaA11y')
            }
            accessibilityHint={
              downloadable ? t('browser.downloadAnalysisHint') : undefined
            }
            style={{
              flex: 1.35,
              minHeight: BROWSER_TOUCH_TARGET,
              borderRadius: theme.radius.md,
              backgroundColor: downloadable
                ? theme.colors.primary
                : theme.colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !downloadable ? 0.45 : downloading ? 0.72 : 1,
            }}>
            <Text
              variant="button"
              color={downloadable ? 'white' : 'textDisabled'}>
              {!downloadable
                ? t('browser.downloadUnavailableCta')
                : downloading
                  ? t('browser.addingDownload')
                  : t('browser.downloadCta')}
            </Text>
          </Pressable>
        </Box>

        <Box mt={4}>
          <Text variant="caption" color="textSecondary" align="center">
            {view.candidates.length > 1
              ? t('browser.swipeDownDismissMulti', {
                  count: view.candidates.length,
                })
              : t('browser.swipeDownDismiss')}
          </Text>
        </Box>
      </Box>
    </GlassCard>
  );
});

const DetailRow = memo(function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) {
    return null;
  }
  return (
    <Box row style={{ justifyContent: 'space-between', gap: 12 }}>
      <Text variant="caption" color="textSecondary">
        {label}
      </Text>
      <Text variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </Text>
    </Box>
  );
});
