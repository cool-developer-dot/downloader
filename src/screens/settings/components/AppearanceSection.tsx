import { memo, useMemo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { SegmentedControl } from '@/components/inputs/SegmentedControl';
import { useTranslation } from '@/localization';
import type { ThemePreference } from '@/store/theme';
import { useSettingsTokens } from '../theme/settings-tokens';
import { SettingsSection } from './SettingsSection';

export type AppearanceSectionProps = {
  themeMode: ThemePreference;
  onThemeChange: (mode: ThemePreference) => void;
  disabled?: boolean;
  testID?: string;
};

export const AppearanceSection = memo(function AppearanceSection({
  themeMode,
  onThemeChange,
  disabled = false,
  testID = 'settings-appearance',
}: AppearanceSectionProps) {
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      {
        value: 'light' as const,
        label: t('settings.themeLight'),
        accessibilityLabel: t('settings.themeLightA11y'),
      },
      {
        value: 'logo' as const,
        label: t('settings.themeLogo'),
        accessibilityLabel: t('settings.themeLogoA11y'),
      },
      {
        value: 'dark' as const,
        label: t('settings.themeDark'),
        accessibilityLabel: t('settings.themeDarkA11y'),
      },
    ],
    [t],
  );

  return (
    <SettingsSection
      testID={testID}
      title={t('settings.appearanceSection')}
      description={t('settings.appearanceDescription')}
      icon="palette-outline">
      <View style={{ paddingVertical: 10 }}>
        <Box row rtlRow center gap={14} mb={14}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: settingsTokens.actionIconBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityElementsHidden
            importantForAccessibility="no">
            <Icon name="theme-light-dark" size="md" color="primary" />
          </View>
          <Box flex={1} gap={3}>
            <Text
              variant="body"
              style={{
                letterSpacing: -0.2,
                lineHeight: 22,
                color: settingsTokens.textPrimary,
              }}>
              {t('settings.theme')}
            </Text>
            <Text
              variant="caption"
              style={{ lineHeight: 16, color: settingsTokens.textSecondary }}>
              {t('settings.themeHint')}
            </Text>
          </Box>
        </Box>

        <SegmentedControl
          options={options}
          value={themeMode}
          onChange={onThemeChange}
          disabled={disabled}
          accessibilityLabel={t('settings.themeA11y')}
          testID={`${testID}-theme`}
        />
      </View>
    </SettingsSection>
  );
});
