import { memo } from 'react';
import { ScrollView } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { QuickAccessGrid } from '@/browser/components/QuickAccess';
import { START_PAGE_QUICK_SITES } from '@/browser/config/quick-sites';
import { useBrowserHome } from '@/browser/hooks/useBrowserHome';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import { browserHomeTokens } from './browser-home-tokens';

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

  return (
    <ScrollView
      testID={testID}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: browserHomeTokens.screenPaddingX,
        paddingTop: browserHomeTokens.contentPaddingTop,
        paddingBottom: browserHomeTokens.contentPaddingBottom,
      }}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      accessibilityLabel={t('browser.home.startPageA11y')}>
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
      </Box>

      <Box
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
    </ScrollView>
  );
});
