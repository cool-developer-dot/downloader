import { memo, useCallback } from 'react';
import { View } from 'react-native';

import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { useTranslation } from '@/localization';
import { navigation } from '@/navigation';

import { useSettingsTokens } from '../theme/settings-tokens';
import { AddressBarSettingsSection } from './AddressBarSettingsSection';
import { BrowserDataSection } from './BrowserDataSection';
import { HistorySettingsSection } from './HistorySettingsSection';
import { StartupSettingsSection } from './StartupSettingsSection';
import { TabsSettingsSection } from './TabsSettingsSection';
import { SitePermissionsSection } from './SitePermissionsSection';
import { BookmarksSettingsSection } from './BookmarksSettingsSection';
import { PageDisplaySettingsSection } from './PageDisplaySettingsSection';
import { DataSaverSettingsSection } from './DataSaverSettingsSection';
import { BlockingSettingsSection } from './BlockingSettingsSection';
import { IncognitoSettingsSection } from './IncognitoSettingsSection';
import { ShareSettingsSection } from './ShareSettingsSection';
import { NavigationSettingsSection } from './NavigationSettingsSection';
import { PrivacySettingsSection } from './PrivacySettingsSection';
import { ProfilesSettingsSection } from './ProfilesSettingsSection';
import { SearchSettingsSection } from './SearchSettingsSection';

/**
 * Browser settings (route `/browser-settings`). One section component per area, each added by the package that
 * needs it: Search (B5), Address bar (B4), Tabs, Page display (B16), Data saver (B18), Startup (B21), Developer (B19).
 * Faran's: Profiles and guest mode, Back up and export (B20), Privacy (B12).
 */
export const BrowserSettingsScreen = memo(function BrowserSettingsScreen() {
  const settingsTokens = useSettingsTokens();
  const { t } = useTranslation();
  const goBack = useCallback(() => navigation.back(), []);

  return (
    <SafeAreaScreen
      testID="browser-settings-screen"
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
      <ScreenHeader title={t('browserSettings.title')} showBack onBackPress={goBack} testID="browser-settings-header" />
      <View style={{ gap: settingsTokens.spacing.sectionGap }}>
        <SearchSettingsSection />
        <AddressBarSettingsSection />
        <NavigationSettingsSection />
        <HistorySettingsSection />
        <StartupSettingsSection />
        <TabsSettingsSection />
        <BookmarksSettingsSection />
        <PageDisplaySettingsSection />
        <DataSaverSettingsSection />
        <BlockingSettingsSection />
        <IncognitoSettingsSection />
        <ShareSettingsSection />
        <PrivacySettingsSection />
        <SitePermissionsSection />
        <ProfilesSettingsSection />
        <BrowserDataSection />
      </View>
    </SafeAreaScreen>
  );
});
