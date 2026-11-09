import { memo } from 'react';
import { ScrollView, View } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { QuickAccessGrid } from '@/browser/components/QuickAccess';
import { GuestModeCard } from '@/browser/components/ProfileSwitcher/GuestModeCard';
import { START_PAGE_QUICK_SITES } from '@/browser/config/quick-sites';
import { useBrowserHome } from '@/browser/hooks/useBrowserHome';
import { ThemeModeOverrideContext, useTheme } from '@/hooks/use-theme';
import { StartPageBackdrop, useStartPageBackground } from '@/browser/startup/components/StartPageBackdrop';
import { useTranslation } from '@/localization';
import { useTourTargetRef } from '@/tour/tour-targets';
import { useSaverEffects } from '@/browser/data-saver/data-saver.service';
import { LightweightHome } from '@/browser/data-saver/components/LightweightHome';

import { browserHomeTokens } from './browser-home-tokens';
import { ScanQrButton } from '@/browser/share-qr/components/ScanQrButton';
import { StartPageCards } from '@/browser/calendar/components/StartPageCards';

export type BrowserHomeViewProps = {
  testID?: string;
};

/**
 * Unified Browser start page — compact left-aligned intro + 3×3 Quick Access.
 * Chrome (tabs / omnibox / overflow) lives in BrowserHeader above this view.
 */
export const BrowserHomeView = memo(function BrowserHomeView({
  testID = 'browser-home',
}: BrowserHomeViewProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { openUrl } = useBrowserHome();
  const quickAccessRef = useTourTargetRef('startPage');
  // B21 #245: a colour, gradient or photo behind the page (dark layer + dark palette); the theme by default.
  const background = useStartPageBackground();
  const custom = background.kind !== 'theme';
  // B18 #285 / #188: the text-only start page (its own switch, or Lite mode).
  const lightHome = useSaverEffects().lightHome;
  if (lightHome) return <LightweightHome onOpen={openUrl} />;

  const page = (
    <ScrollView
      testID={testID}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: browserHomeTokens.screenPaddingX,
        paddingTop: browserHomeTokens.contentPaddingTop,
        paddingBottom: browserHomeTokens.contentPaddingBottom,
      }}
      style={{ flex: 1, backgroundColor: custom ? 'transparent' : theme.colors.background }}
      accessibilityLabel={t('browser.home.startPageA11y')}>
      <GuestModeCard />
      <Box
        testID="browser-start-intro"
        style={{
          alignItems: 'flex-start',
          gap: browserHomeTokens.introTitleGap,
          marginBottom: browserHomeTokens.introToQuickAccessGap,
        }}>
        <Text
          variant={browserHomeTokens.brandTitleVariant}
          accessibilityRole="header"
          accessibilityLabel={t('browser.home.brandA11y')}>
          {t('home.brand')}
        </Text>
        <Text
          variant={browserHomeTokens.brandSubtitleVariant}
          color="textSecondary"
          accessibilityLabel={t('browser.home.startSubtitle')}>
          {t('browser.home.startSubtitle')}
        </Text>
        {/* B22 #30 */}
        <ScanQrButton testID="browser-home-scan" />
      </Box>

      <Box
        ref={quickAccessRef}
        collapsable={false}
        gap={browserHomeTokens.quickAccessHeadingGap}
        accessibilityLabel={t('home.quickAccessA11y')}>
        <Text
          variant={browserHomeTokens.quickAccessHeadingVariant}
          accessibilityRole="header">
          {t('browser.home.quickAccess')}
        </Text>
        <QuickAccessGrid
          sites={START_PAGE_QUICK_SITES}
          onOpenSite={openUrl}
          density="startPage"
          horizontalPadding={browserHomeTokens.screenPaddingX}
          testID="browser-quick-access-grid"
        />
      </Box>
      {/* B24 #269 / #270: dates and prayer times (each only when switched on). */}
      <StartPageCards />
    </ScrollView>
  );

  if (background.kind === 'theme') {
    return page;
  }
  return (
    <View style={{ flex: 1 }}>
      <StartPageBackdrop background={background} />
      <ThemeModeOverrideContext.Provider value="dark">{page}</ThemeModeOverrideContext.Provider>
    </View>
  );
});
