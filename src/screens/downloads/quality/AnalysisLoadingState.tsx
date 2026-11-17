import { memo } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { DsCard, DsIcon, DsText, ds } from '@/design';
import type { AnalyzePhase } from '@/downloads/analyze/analyze-state-machine';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { PlatformPageKind } from '@/media-detection/platform/types';

import { PREVIEW_HERO_HEIGHT } from './DownloadPreview';
import { resolvePlatformDisplay, shouldShowAnalyzeSpinner } from './platform-display';

export type AnalysisLoadingStateProps = {
  phase: AnalyzePhase;
  platform?: PlatformPageKind | null;
  message?: string;
};

/** The sheet while a link is checked: the hero's place as a quiet track block, then the step's label with a spinner. */
export const AnalysisLoadingState = memo(function AnalysisLoadingState({
  phase,
  platform = null,
  message,
}: AnalysisLoadingStateProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const label = message?.trim() || t('downloads.analyzing');
  const platformDisplay = resolvePlatformDisplay(platform);
  const showSpinner = shouldShowAnalyzeSpinner(phase);

  return (
    <View
      style={{ gap: ds.space.stack }}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite">
      <View
        style={{
          height: PREVIEW_HERO_HEIGHT,
          borderRadius: ds.radius.card,
          backgroundColor: theme.colors.track,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {showSpinner ? (
          <ActivityIndicator color={theme.colors.primary} size="large" />
        ) : (
          <DsIcon name={platformDisplay.icon} size={30} color="textSecondary" strokeWidth={1.8} />
        )}
      </View>
      <DsCard>
        <View style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: ds.space.rowGap }}>
          <View
            style={{
              width: ds.size.iconTile,
              height: ds.size.iconTile,
              borderRadius: ds.radius.iconTile,
              backgroundColor: theme.colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {showSpinner ? (
              <ActivityIndicator color={theme.colors.primary} size="small" />
            ) : (
              <DsIcon name={platformDisplay.icon} size={ds.size.rowIcon} color="primary" strokeWidth={ds.stroke.row} />
            )}
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <DsText variant="rowTitle">{label}</DsText>
            <DsText variant="rowSub">{platformDisplay.label}</DsText>
          </View>
        </View>
      </DsCard>
    </View>
  );
});
