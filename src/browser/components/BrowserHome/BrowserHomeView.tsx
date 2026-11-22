import { memo, useCallback } from 'react';
import { ScrollView, View } from 'react-native';

import { GuestModeCard } from '@/browser/components/ProfileSwitcher/GuestModeCard';
import { START_PAGE_QUICK_SITES } from '@/browser/config/quick-sites';
import { useBrowserHome } from '@/browser/hooks/useBrowserHome';
import { ThemeModeOverrideContext, useTheme } from '@/hooks/use-theme';
import { StartPageBackdrop, useStartPageBackground } from '@/browser/startup/components/StartPageBackdrop';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useVoiceSearch } from '@/browser/voice/use-voice-search';
import { useTourTargetRef } from '@/tour/tour-targets';
import { useSaverEffects } from '@/browser/data-saver/data-saver.service';
import { LightweightHome } from '@/browser/data-saver/components/LightweightHome';
import { scanQrCode } from '@/browser/share-qr/share-qr.service';
import { StartPageCards } from '@/browser/calendar/components/StartPageCards';
import {
  ds,
  DsButton,
  DsButtonRow,
  DsCard,
  DsHeader,
  DsSearchField,
  DsSectionLabel,
  DsText,
  DsTile,
  DsTileGrid,
} from '@/design';

import { ClipboardMonitorLine } from './ClipboardMonitorLine';
import { RecentDownloadCard } from './RecentDownloadCard';

export type BrowserHomeViewProps = {
  testID?: string;
};

/**
 * The Browser start page — design 1 "Browser · Home": the VidoraX header with ⋮ (page tools), the "Search or paste
 * link" field (opens the Search screen; mic / camera), the "Paste a link, save the video" card (Paste & Go · Scan QR
 * and the clipboard monitor line), QUICK ACCESS (six tiles) and RECENT (the latest finished download). The guest
 * card, the date / prayer cards (off by default), the text-only Lite home and the custom background stay around it.
 * Chrome (tabs / omnibox / overflow) lives in BrowserHeader above this view.
 */
export const BrowserHomeView = memo(function BrowserHomeView({
  testID = 'browser-home',
}: BrowserHomeViewProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { openUrl, pasteAndGo } = useBrowserHome();
  const quickAccessRef = useTourTargetRef('startPage');
  // The tour's "Address bar" step points here while the start page hides the browser's own address bar.
  const startSearchRef = useTourTargetRef('startSearch');
  // B21 #245: a colour, gradient or photo behind the page (dark layer + dark palette); the theme by default.
  const background = useStartPageBackground();
  const custom = background.kind !== 'theme';
  // B18 #285 / #188: the text-only start page (its own switch, or Lite mode).
  const lightHome = useSaverEffects().lightHome;

  const openPageTools = useCallback(() => navigation.push(routePaths.browserPageTools), []);
  // #31: Android's voice input screen, then the words open like a typed search or address.
  const voiceSearch = useVoiceSearch();
  const openSearch = useCallback(() => navigation.push(routePaths.browserSearch), []);
  const scan = useCallback(() => {
    void scanQrCode();
  }, []);
  const paste = useCallback(() => {
    void pasteAndGo();
  }, [pasteAndGo]);

  if (lightHome) return <LightweightHome onOpen={openUrl} />;

  const page = (
    <ScrollView
      testID={testID}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingHorizontal: ds.space.screenX,
        paddingBottom: 24,
        gap: ds.space.stack,
      }}
      style={{ flex: 1, backgroundColor: custom ? 'transparent' : theme.colors.background }}
      accessibilityLabel={t('browser.home.startPageA11y')}>
      <GuestModeCard />
      <DsHeader
        testID="browser-start-intro"
        title={t('common.brand')}
        subtitle={t('lightHome.subtitle')}
        action={{
          icon: 'ellipsis-vertical',
          accessibilityLabel: t('lightHome.menuA11y'),
          onPress: openPageTools,
          testID: 'browser-home-menu',
        }}
      />
      <View ref={startSearchRef} collapsable={false}>
        <DsSearchField
          testID="browser-home-search"
          placeholder={t('lightHome.searchPlaceholder')}
          accessibilityLabel={t('lightHome.searchA11y')}
          onPress={openSearch}
          actions={[
            { icon: 'mic', accessibilityLabel: t('lightHome.micA11y'), onPress: voiceSearch, testID: 'browser-home-mic' },
            { icon: 'camera', accessibilityLabel: t('lightHome.cameraA11y'), onPress: scan, testID: 'browser-home-scan' },
          ]}
        />
      </View>
      <DsCard testID="browser-home-paste-card">
        <DsText variant="cardTitle" accessibilityRole="header">
          {t('lightHome.pasteCardTitle')}
        </DsText>
        <DsButtonRow style={{ marginTop: 12 }}>
          <DsButton flex label={t('lightHome.pasteAndGo')} icon="clipboard" onPress={paste} testID="browser-home-paste-go" />
          <DsButton flex variant="secondary" label={t('lightHome.scanQr')} icon="qr-code" onPress={scan} testID="browser-home-scan-qr" />
        </DsButtonRow>
        <ClipboardMonitorLine />
      </DsCard>

      <DsSectionLabel>{t('lightHome.quickAccess')}</DsSectionLabel>
      <View ref={quickAccessRef} collapsable={false} accessibilityLabel={t('lightHome.quickAccessA11y')}>
        <DsTileGrid testID="browser-quick-access-grid">
          {START_PAGE_QUICK_SITES.map((site) => (
            <DsTile
              key={site.id}
              icon={site.dsIcon}
              label={site.name}
              accessibilityLabel={t('lightHome.openSiteA11y', { site: site.name })}
              onPress={() => openUrl(site.url)}
              testID={`quick-site-${site.id}`}
            />
          ))}
        </DsTileGrid>
      </View>

      <RecentDownloadCard />
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
