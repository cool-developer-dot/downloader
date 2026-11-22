import { memo } from 'react';
import { View } from 'react-native';

import { DsButton, DsCard, DsIcon, DsText, ds } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type AnalyzeFallbackStateProps = {
  title: string;
  description: string;
  onOpenVideo: () => void;
  onRetry: () => void;
  testID?: string;
};

/** The sheet when the page must play the video once first: the reason, Open Video, Try again. */
export const AnalyzeFallbackState = memo(function AnalyzeFallbackState({
  title,
  description,
  onOpenVideo,
  onRetry,
  testID = 'quality-analyze-fallback',
}: AnalyzeFallbackStateProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ gap: ds.space.stack }} testID={testID}>
      <DsCard>
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 8 }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              backgroundColor: theme.colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <DsIcon name="circle-play" size={24} color="primary" strokeWidth={1.8} />
          </View>
          <DsText variant="cardTitle" align="center">
            {title}
          </DsText>
          <DsText variant="body" align="center">
            {description}
          </DsText>
        </View>
      </DsCard>
      <DsButton
        label={t('lightVideoSheet.openVideo')}
        icon="globe"
        fullWidth
        onPress={onOpenVideo}
        accessibilityHint={t('lightVideoSheet.openVideoHint')}
        testID="quality-open-video"
      />
      <DsButton label={t('common.retry')} variant="secondary" fullWidth onPress={onRetry} testID="quality-analyze-retry" />
    </View>
  );
});
