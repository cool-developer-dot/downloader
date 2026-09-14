import { memo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Skeleton } from '@/components/common/Skeleton';
import { useTranslation } from '@/localization';

import { useSettingsTokens } from '../theme/settings-tokens';

export type SettingsSkeletonProps = {
  testID?: string;
};

function SkeletonSection({ rows }: { rows: number }) {
  const settingsTokens = useSettingsTokens();
  return (
    <View>
      <Box row center gap={12} mb={12}>
        <Skeleton width={36} height={36} borderRadius={settingsTokens.radius.icon} />
        <Box flex={1} gap={6}>
          <Skeleton width="36%" height={16} />
          <Skeleton width="52%" height={10} />
        </Box>
      </Box>
      <View
        style={[
          {
            backgroundColor: settingsTokens.card,
            borderRadius: settingsTokens.radius.card,
            borderWidth: 1,
            borderColor: settingsTokens.cardBorder,
            paddingHorizontal: settingsTokens.spacing.cardPadding,
            paddingVertical: 8,
          },
          settingsTokens.elevation.card,
        ]}>
        {Array.from({ length: rows }, (_, index) => (
          <Box key={`settings-sk-row-${index}`} gap={8} py={14}>
            <Box row center gap={14}>
              <Skeleton width={40} height={40} borderRadius={12} />
              <Box flex={1} gap={6}>
                <Skeleton width="42%" height={14} />
                <Skeleton width="68%" height={10} />
              </Box>
              <Skeleton width={72} height={22} borderRadius={999} />
            </Box>
            {index < rows - 1 ? (
              <View
                style={{
                  height: 1,
                  marginTop: 6,
                  marginLeft: 54,
                  backgroundColor: settingsTokens.divider,
                }}
              />
            ) : null}
          </Box>
        ))}
      </View>
    </View>
  );
}

export const SettingsSkeleton = memo(function SettingsSkeleton({
  testID = 'settings-skeleton',
}: SettingsSkeletonProps) {
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  return (
    <Box
      testID={testID}
      gap={settingsTokens.spacing.sectionGap}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('settings.loadingA11y')}
      accessibilityState={{ busy: true }}
      style={{ paddingTop: 8 }}>
      <Box gap={8} mb={4}>
        <Skeleton width="28%" height={28} />
        <Skeleton width="62%" height={14} />
      </Box>
      <SkeletonSection rows={1} />
      <SkeletonSection rows={1} />
      <SkeletonSection rows={3} />
      <SkeletonSection rows={1} />
      <SkeletonSection rows={3} />
    </Box>
  );
});
