import { memo } from 'react';
import { View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Text } from '@/components/base/Text';
import { useTranslation, type TranslationKey } from '@/localization';

import { useSettingsTokens } from '../theme/settings-tokens';
import { SettingsSection } from './SettingsSection';

const STEP_KEYS: readonly TranslationKey[] = [
  'settings.howToUseStep1',
  'settings.howToUseStep2',
  'settings.howToUseStep3',
  'settings.howToUseStep4',
  'settings.howToUseStep5',
  'settings.howToUseStep6',
  'settings.howToUseStep7',
];

const NOTE_KEYS: readonly TranslationKey[] = ['settings.howToUseNoteYouTube', 'settings.howToUseNoteDrm'];

export type HowToUseSectionProps = {
  testID?: string;
};

/** Settings → How to use VidoraX: the download flow in seven short steps, and what can't be downloaded. */
export const HowToUseSection = memo(function HowToUseSection({
  testID = 'settings-how-to-use',
}: HowToUseSectionProps) {
  const { t } = useTranslation();
  const tokens = useSettingsTokens();

  return (
    <SettingsSection
      testID={testID}
      title={t('settings.howToUseSection')}
      description={t('settings.howToUseDescription')}
      icon="book-open-variant">
      <View style={{ paddingVertical: 14, gap: 10 }}>
        {STEP_KEYS.map((key, index) => (
          <Box key={key} row rtlRow gap={12} style={{ alignItems: 'flex-start' }}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: tokens.actionIconBg,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Text variant="caption" style={{ color: tokens.primary, fontWeight: '700' }}>
                {index + 1}
              </Text>
            </View>
            <Text
              variant="bodySmall"
              accessibilityLabel={`${index + 1}. ${t(key)}`}
              style={{ flex: 1, lineHeight: 22, color: tokens.textPrimary }}>
              {t(key)}
            </Text>
          </Box>
        ))}
        <View style={{ height: 1, backgroundColor: tokens.divider, marginVertical: 4 }} />
        {NOTE_KEYS.map((key) => (
          <Box key={key} row rtlRow gap={12} style={{ alignItems: 'flex-start' }}>
            <View style={{ width: 24, alignItems: 'center', paddingTop: 2 }}>
              <Icon name="information-outline" size={18} color="secondary" />
            </View>
            <Text variant="bodySmall" style={{ flex: 1, lineHeight: 20, color: tokens.textSecondary }}>
              {t(key)}
            </Text>
          </Box>
        ))}
      </View>
    </SettingsSection>
  );
});
