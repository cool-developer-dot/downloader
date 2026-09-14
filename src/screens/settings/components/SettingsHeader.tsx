import { memo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import { useSettingsTokens } from '../theme/settings-tokens';

export type SettingsHeaderProps = {
  testID?: string;
};

export const SettingsHeader = memo(function SettingsHeader({
  testID = 'settings-header',
}: SettingsHeaderProps) {
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${t('settings.screenTitle')}. ${t('settings.screenSubtitle')}`}
      style={{
        paddingTop: settingsTokens.spacing.headerTop,
        paddingBottom: settingsTokens.spacing.headerBottom,
      }}>
      <Box gap={6} importantForAccessibility="no-hide-descendants">
        <Text
          variant="title"
          style={{
            letterSpacing: -0.4,
            color: settingsTokens.textPrimary,
          }}>
          {t('settings.screenTitle')}
        </Text>
        <Text
          variant="bodySmall"
          style={{
            lineHeight: 20,
            color: settingsTokens.textSecondary,
          }}>
          {t('settings.screenSubtitle')}
        </Text>
      </Box>
    </View>
  );
});
