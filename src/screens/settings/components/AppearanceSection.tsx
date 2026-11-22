import { memo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTranslation, type TranslationKey } from '@/localization';
import type { ThemePreference } from '@/store/theme';
import { colors, THEME_PREFERENCES } from '@/theme';
import { useSettingsTokens } from '../theme/settings-tokens';
import { SettingsSection } from './SettingsSection';

export type AppearanceSectionProps = {
  themeMode: ThemePreference;
  onThemeChange: (mode: ThemePreference) => void;
  disabled?: boolean;
  testID?: string;
};

const LABELS: Record<ThemePreference, { label: TranslationKey; a11y: TranslationKey }> = {
  light: { label: 'settings.themeLight', a11y: 'settings.themeLightA11y' },
  dark: { label: 'settings.themeDark', a11y: 'settings.themeDarkA11y' },
  red: { label: 'settings.themeRed', a11y: 'settings.themeRedA11y' },
  cream: { label: 'settings.themeCream', a11y: 'settings.themeCreamA11y' },
  midnight: { label: 'settings.themeMidnight', a11y: 'settings.themeMidnightA11y' },
  blush: { label: 'settings.themeBlush', a11y: 'settings.themeBlushA11y' },
};

type SwatchProps = {
  mode: ThemePreference;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
};

/** A thumbnail of one theme: its page, its header (the band on Red), a card with an accent tile and a text line. */
const ThemeSwatch = memo(function ThemeSwatch({ mode, selected, disabled, onPress, testID }: SwatchProps) {
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  const c = colors[mode];
  const keys = LABELS[mode];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected, disabled }}
      accessibilityLabel={t(keys.a11y)}
      style={({ pressed }) => ({
        width: '31%',
        flexGrow: 1,
        borderRadius: 14,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? settingsTokens.primary : settingsTokens.divider,
        padding: selected ? 7 : 8,
        gap: 8,
        opacity: pressed ? 0.85 : 1,
        backgroundColor: settingsTokens.card,
      })}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ height: 52, borderRadius: 10, overflow: 'hidden', backgroundColor: c.background, borderWidth: 1, borderColor: c.cardBorder }}>
        <View style={{ height: 16, backgroundColor: c.headerBackground, justifyContent: 'center', paddingHorizontal: 6 }}>
          <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: c.headerText, opacity: 0.9 }} />
        </View>
        <View
          style={{
            marginHorizontal: 6,
            marginTop: 6,
            height: 18,
            borderRadius: 6,
            backgroundColor: c.card,
            borderWidth: 1,
            borderColor: c.cardBorder,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 4,
            gap: 4,
          }}>
          <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 4, height: 4, borderRadius: 1, backgroundColor: c.primary }} />
          </View>
          <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: c.textPrimary, opacity: 0.8 }} />
          <View style={{ width: 10, height: 6, borderRadius: 3, backgroundColor: c.primary }} />
        </View>
      </View>
      <Text
        variant="caption"
        numberOfLines={1}
        style={{ lineHeight: 16, color: selected ? settingsTokens.primary : settingsTokens.textPrimary, fontWeight: '600' }}>
        {t(keys.label)}
      </Text>
    </Pressable>
  );
});

/** The theme picker: six swatches in the PDF's order (Light, Dark, Red, Cream, Midnight, Blush). */
export const AppearanceSection = memo(function AppearanceSection({
  themeMode,
  onThemeChange,
  disabled = false,
  testID = 'settings-appearance',
}: AppearanceSectionProps) {
  const settingsTokens = useSettingsTokens();
  const { t, rtl } = useTranslation();

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

        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('settings.themeA11y')}
          testID={`${testID}-theme`}
          style={{ flexDirection: rtl.rowDirection, flexWrap: 'wrap', gap: 10 }}>
          {THEME_PREFERENCES.map((mode) => (
            <ThemeSwatch
              key={mode}
              mode={mode}
              selected={mode === themeMode}
              disabled={disabled}
              onPress={() => onThemeChange(mode)}
              testID={`${testID}-theme-${mode}`}
            />
          ))}
        </View>
      </View>
    </SettingsSection>
  );
});
