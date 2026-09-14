import { memo } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { Skeleton } from '@/components/common/Skeleton';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { primaryAlphas } from '@/theme';

import {
  resolvePlatformDisplay,
  shouldShowAnalyzeSpinner,
} from './platform-display';
import type { PlatformPageKind } from '@/media-detection/platform/types';
import type { AnalyzePhase } from '@/downloads/analyze/analyze-state-machine';

export type AnalysisLoadingStateProps = {
  phase: AnalyzePhase;
  platform?: PlatformPageKind | null;
  message?: string;
};

export const AnalysisLoadingState = memo(function AnalysisLoadingState({
  phase,
  platform = null,
  message,
}: AnalysisLoadingStateProps) {
  const theme = useTheme();
  const primary = primaryAlphas(theme.colors.primary);
  const { t } = useTranslation();
  const label = message?.trim() || t('downloads.analyzing');
  const platformDisplay = resolvePlatformDisplay(platform);
  const showSpinner = shouldShowAnalyzeSpinner(phase);

  return (
    <Box
      gap={16}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite">
      <Box
        row
        gap={14}
        p={14}
        borderRadius="md"
        style={{
          backgroundColor: theme.colors.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          alignItems: 'center',
        }}>
        <Box
          center
          style={{
            width: 64,
            height: 64,
            borderRadius: theme.radius.sm,
            backgroundColor: primary.medium,
          }}>
          {showSpinner ? (
            <ActivityIndicator color={theme.colors.primary} size="small" />
          ) : (
            <Icon name={platformDisplay.icon} size={28} color="primary" />
          )}
        </Box>
        <Box flex={1} gap={8}>
          <Skeleton width="78%" height={16} />
          <Skeleton width="48%" height={12} />
          <Skeleton width="36%" height={12} />
        </Box>
      </Box>

      <Box row gap={10} style={{ alignItems: 'center' }}>
        {showSpinner ? (
          <ActivityIndicator color={theme.colors.primary} size="small" />
        ) : null}
        <Text variant="label" color="textSecondary" style={{ flex: 1 }}>
          {label}
        </Text>
      </Box>

      <Skeleton width="100%" height={64} borderRadius={theme.radius.md} />
    </Box>
  );
});
