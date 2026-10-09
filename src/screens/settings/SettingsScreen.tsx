import { memo } from 'react';
import { View } from 'react-native';

import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { languageNameKey, useTranslation } from '@/localization';

import {
  AppearanceSection,
  DownloadsSection,
  GeneralSection,
  HowToUseSection,
  LegalSection,
  PrivacySection,
  SettingsFeedbackBanner,
  SettingsHeader,
  SettingsStaggerItem,
  StorageSection,
  SupportSection,
} from './components';
import { useSettingsScreen } from './hooks';
import { useSettingsTokens } from './theme/settings-tokens';

export const SettingsScreen = memo(function SettingsScreen() {
  const settingsTokens = useSettingsTokens();
  const { t, language } = useTranslation();
  const {
    saving,
    feedback,
    themeMode,
    languageSheetVisible,
    openLanguageSheet,
    closeLanguageSheet,
    setTheme,
    setLanguage,
  } = useSettingsScreen();

  return (
    <SafeAreaScreen
      testID="settings-screen"
      scrollable
      padded={false}
      edges={['top', 'bottom', 'left', 'right']}
      style={{ backgroundColor: settingsTokens.background }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: settingsTokens.spacing.screenX,
        paddingBottom: 40,
        backgroundColor: settingsTokens.background,
      }}>
      <View
        accessible={false}
        accessibilityState={{ busy: saving }}
        importantForAccessibility="yes">
        <SettingsStaggerItem index={0} hero>
          <SettingsHeader />
        </SettingsStaggerItem>

        <SettingsFeedbackBanner
          visible={Boolean(feedback)}
          tone={feedback?.tone}
          title={feedback ? t(feedback.titleKey) : ''}
          message={feedback ? t(feedback.messageKey) : ''}
        />

        <View style={{ gap: settingsTokens.spacing.sectionGap }}>
          <SettingsStaggerItem index={1}>
            <AppearanceSection
              themeMode={themeMode}
              onThemeChange={setTheme}
              disabled={saving}
            />
          </SettingsStaggerItem>

          <SettingsStaggerItem index={2}>
            <GeneralSection
              languageLabel={t(languageNameKey(language))}
              languageCode={language}
              sheetVisible={languageSheetVisible}
              onOpenSheet={openLanguageSheet}
              onCloseSheet={closeLanguageSheet}
              onSelectLanguage={setLanguage}
              disabled={saving}
            />
          </SettingsStaggerItem>

          <SettingsStaggerItem index={3}>
            <DownloadsSection />
          </SettingsStaggerItem>

          <SettingsStaggerItem index={4}>
            <StorageSection />
          </SettingsStaggerItem>

          <SettingsStaggerItem index={5}>
            <HowToUseSection />
          </SettingsStaggerItem>

          <SettingsStaggerItem index={6}>
            <SupportSection />
          </SettingsStaggerItem>

          <SettingsStaggerItem index={7}>
            <PrivacySection disabled={saving} />
          </SettingsStaggerItem>

          <SettingsStaggerItem index={8}>
            <LegalSection />
          </SettingsStaggerItem>
        </View>
      </View>
    </SafeAreaScreen>
  );
});
