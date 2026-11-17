import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Share, ToastAndroid } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { DsChip, DsChipRow, DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel, type DsIconName } from '@/design';
import { useBrowserMenuActions } from '@/browser/components/BrowserOverflowMenu/browser-menu-actions';
import type { BrowserMenuActionId, BrowserMenuFeedback } from '@/browser/components/BrowserOverflowMenu/types';
import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { normalizeForceDark, normalizeTextZoom, parseSiteDisplays } from '@/browser/page-display/page-display-settings';
import { pageDisplayRequests } from '@/browser/page-display/page-display-requests';
import { siteKey } from '@/browser/privacy/privacy-settings';
import { useReaderAvailable } from '@/browser/reader/reader-mode.service';
import { requestAddressBarFocus } from '@/browser/services/address-bar-focus';
import { selectCurrentUrl, selectDesktopMode, useBrowserStore } from '@/browser/stores';
import { extractPageHostname, isValidBrowserPageUrl } from '@/browser/utils';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useSettingsStore } from '@/store/settings';

import { buildTranslateTextUrl, openTabAfterCurrent, requestPageSelection, searchSelection } from './page-selection.service';

/** The design's rows cover these menu actions; everything else the menu offered is listed under MORE. */
const DESIGN_ROWS: ReadonlySet<BrowserMenuActionId> = new Set<BrowserMenuActionId>([
  'find_in_page',
  'reader_mode',
  'desktop_site',
  'page_display',
  'highlights_page',
  'draw',
  'screenshot',
  'full_page',
  'print_page',
  'save_offline',
  // The header's ⚙ opens Browser settings; the app's Settings is a tab of the bottom bar.
  'settings',
]);

const MORE_ICONS: Record<BrowserMenuActionId, DsIconName> = {
  profile: 'user',
  active_downloads: 'download',
  recent_downloads: 'file-down',
  grab_links: 'link',
  continue_watching: 'circle-play',
  recently_watched: 'clock',
  history: 'history',
  bookmarks: 'bookmark',
  new_tab: 'plus',
  new_incognito_tab: 'venetian-mask',
  reopen_closed_tab: 'undo-2',
  duplicate_tab: 'copy',
  move_to_window: 'app-window',
  add_bookmark: 'star',
  reading_list_add: 'book-open',
  copy_link: 'link',
  share: 'share-2',
  qr_code: 'qr-code',
  save_page_note: 'notebook-pen',
  notes: 'notebook',
  saved_pages: 'archive',
  highlights_page: 'highlighter',
  highlights: 'highlighter',
  draw: 'pencil',
  watch_page: 'bell',
  devtools: 'code',
  search_site: 'search',
  translate: 'languages',
  find_in_page: 'search',
  reader_mode: 'file-text',
  page_display: 'type',
  hard_reload: 'refresh-cw',
  scroll_top: 'arrow-up-to-line',
  scroll_bottom: 'arrow-down-to-line',
  auto_scroll: 'scroll-text',
  desktop_site: 'monitor',
  open_external: 'external-link',
  screenshot: 'camera',
  full_page: 'image',
  print_page: 'printer',
  save_offline: 'download',
  downloads: 'download',
  settings: 'settings',
  exit: 'log-out',
};

type Sheet = 'annotate' | 'capture' | null;

function toast(message: string): void {
  ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * Design 3 "Browser · Page menu" — the Page tools screen that replaces the ⋮ popup: the design's rows over the
 * browser menu's actions (`useBrowserMenuActions`), the "Selected text" chips, and under MORE every other action the
 * menu offered, in the menu's order.
 */
export const PageToolsScreen = memo(function PageToolsScreen() {
  const { t, language } = useTranslation();
  const currentUrl = useBrowserStore(selectCurrentUrl);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const desktopMode = useBrowserStore(selectDesktopMode);
  const setDesktopMode = useBrowserStore((s) => s.setDesktopMode);
  const incognito = useBrowserStore((s) => isIncognitoTabId(s.activeTabId));
  const hasPage = isValidBrowserPageUrl(currentUrl);
  const host = extractPageHostname(currentUrl);
  const readerAvailable = useReaderAvailable();

  const update = useSettingsStore((s) => s.updateSetting);
  const globalZoom = normalizeTextZoom(useSettingsStore((s) => s.pageTextZoom));
  const sitesRaw = useSettingsStore((s) => s.pageDisplaySites);
  const forceDark = normalizeForceDark(useSettingsStore((s) => s.pageForceDark));
  const site = siteKey(currentUrl);
  const textZoom = useMemo(() => {
    const own = site ? parseSiteDisplays(sitesRaw)[site]?.textZoom : undefined;
    return own ?? globalZoom;
  }, [globalZoom, site, sitesRaw]);

  const [sheet, setSheet] = useState<Sheet>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  // The menu's actions close the menu when done; here that is leaving the screen for the page.
  const back = useCallback(() => navigation.back(), []);
  const onFeedback = useCallback((feedback: BrowserMenuFeedback) => toast(feedback.message), []);
  const { items, handleItemPress } = useBrowserMenuActions({ onClose: back, onFeedback });

  // The page's selection, read once when the screen opens ('' = nothing selected; null = no answer).
  const [selection, setSelection] = useState<string | null>(null);
  useEffect(() => {
    if (!hasPage) return;
    let live = true;
    void requestPageSelection(activeTabId).then((text) => {
      if (live) setSelection(text);
    });
    return () => {
      live = false;
    };
  }, [activeTabId, hasPage]);

  const withSelection = useCallback(
    (action: (text: string) => void) => () => {
      const text = selection?.trim() ?? '';
      if (!text) {
        toast(t('lightPageTools.selectFirst'));
        return;
      }
      action(text);
    },
    [selection, t],
  );
  const copySelection = withSelection((text) => {
    void Clipboard.setStringAsync(text).then(() => toast(t('browserShare.copied')));
  });
  const shareSelection = withSelection((text) => {
    Share.share({ message: text }).catch(() => undefined);
  });
  const searchSelected = withSelection((text) => {
    const outcome = searchSelection(text);
    if (outcome === 'searched' || outcome === 'searchedTruncated') back();
  });
  const translateSelected = withSelection((text) => {
    const url = buildTranslateTextUrl(text, language);
    if (url && openTabAfterCurrent(url, text)) back();
  });

  const toggleDesktop = useCallback(
    (enabled: boolean) => {
      const tabId = useBrowserStore.getState().activeTabId;
      const tab = useBrowserStore.getState().tabs.find((entry) => entry.id === tabId);
      if (!tab || enabled === tab.desktopMode) return;
      setDesktopMode(enabled, { source: 'user', tabId });
      toast(enabled ? t('browser.desktopSiteEnabled') : t('browser.desktopSiteDisabled'));
    },
    [setDesktopMode, t],
  );

  const openPageDisplay = useCallback(() => {
    back();
    pageDisplayRequests.open();
  }, [back]);

  const openCalculator = useCallback(() => {
    requestAddressBarFocus();
    back();
  }, [back]);

  const openSettings = useCallback(() => navigation.push(routePaths.browserSettings), []);

  const annotateActions = useMemo(
    (): ActionSheetItem[] => [
      { id: 'highlights_page', label: t('browserAnnotate.onThisPage'), onPress: () => handleItemPress('highlights_page') },
      { id: 'draw', label: t('browserAnnotate.draw'), onPress: () => handleItemPress('draw') },
    ],
    [handleItemPress, t],
  );
  const captureActions = useMemo(
    (): ActionSheetItem[] => [
      { id: 'print_page', label: t('browserCapture.print'), onPress: () => handleItemPress('print_page') },
      { id: 'full_page', label: t('browserCapture.fullPage'), onPress: () => handleItemPress('full_page') },
      { id: 'screenshot', label: t('browserCapture.screenshot'), onPress: () => handleItemPress('screenshot') },
    ],
    [handleItemPress, t],
  );

  const moreItems = useMemo(() => items.filter((item) => !DESIGN_ROWS.has(item.id)), [items]);

  return (
    <DsScreen testID="page-tools-screen">
      <DsHeader
        title={t('lightPageTools.title')}
        subtitle={hasPage && host ? host : t('lightPageTools.home')}
        action={{ icon: 'settings', accessibilityLabel: t('lightPageTools.settingsA11y'), onPress: openSettings, testID: 'page-tools-settings' }}
      />
      <DsRowGroup testID="page-tools-rows">
        <DsRow
          icon="search"
          title={t('lightPageTools.findInPage')}
          subtitle={t('lightPageTools.findInPageHint')}
          onPress={() => handleItemPress('find_in_page')}
          disabled={!hasPage}
          testID="page-tools-find"
        />
        <DsRow
          icon="file-text"
          title={t('lightPageTools.readerMode')}
          subtitle={t('lightPageTools.readerModeHint')}
          onPress={() => handleItemPress('reader_mode')}
          disabled={!hasPage || !readerAvailable}
          accessibilityHint={readerAvailable ? undefined : t('browserReader.notArticle')}
          testID="page-tools-reader"
        />
        <DsRow
          icon="monitor"
          title={t('lightPageTools.desktopSite')}
          subtitle={t('lightPageTools.desktopSiteHint')}
          toggle={{ value: desktopMode, onValueChange: toggleDesktop, accessibilityLabel: t('browser.desktopSiteA11y') }}
          disabled={!hasPage}
          testID="page-tools-desktop"
        />
        <DsRow
          icon="type"
          title={t('lightPageTools.textSize')}
          subtitle={t('lightPageTools.textSizeHint')}
          value={`${textZoom}%`}
          onPress={openPageDisplay}
          disabled={!hasPage}
          accessibilityLabel={`${t('lightPageTools.textSize')}, ${t('browserPageDisplay.percentA11y', { value: textZoom })}`}
          testID="page-tools-text-size"
        />
        <DsRow
          icon="pencil"
          title={t('lightPageTools.highlightDraw')}
          subtitle={t('lightPageTools.highlightDrawHint')}
          onPress={() => setSheet('annotate')}
          disabled={!hasPage || incognito}
          testID="page-tools-annotate"
        />
        <DsRow
          icon="file-text"
          title={t('lightPageTools.savePdf')}
          subtitle={t('lightPageTools.savePdfHint')}
          onPress={() => setSheet('capture')}
          disabled={!hasPage || incognito}
          testID="page-tools-capture"
        />
        <DsRow
          icon="download"
          title={t('lightPageTools.saveOffline')}
          onPress={() => handleItemPress('save_offline')}
          disabled={!hasPage || incognito}
          testID="page-tools-save-offline"
        />
        <DsRow
          icon="moon"
          title={t('lightPageTools.nightLight')}
          subtitle={t('lightPageTools.nightLightHint')}
          toggle={{
            value: forceDark !== 'off',
            onValueChange: (next) => update('pageForceDark', next ? 'on' : 'off'),
            accessibilityLabel: t('browserPageDisplay.forceDark'),
          }}
          onPress={openPageDisplay}
          testID="page-tools-night-light"
        />
        <DsRow icon="cpu" title={t('lightPageTools.calculator')} onPress={openCalculator} testID="page-tools-calculator" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightPageTools.selectedText')}</DsSectionLabel>
      <DsChipRow testID="page-tools-selection-chips">
        <DsChip label={t('lightPageTools.copy')} selected onPress={copySelection} testID="page-tools-copy" />
        <DsChip label={t('common.share')} onPress={shareSelection} testID="page-tools-share" />
        <DsChip label={t('common.search')} onPress={searchSelected} testID="page-tools-search" />
        <DsChip label={t('lightPageTools.translate')} onPress={translateSelected} testID="page-tools-translate" />
      </DsChipRow>

      <DsSectionLabel>{t('lightPageTools.more')}</DsSectionLabel>
      <DsRowGroup testID="page-tools-more">
        {moreItems.map((item) => (
          <DsRow
            key={item.id}
            icon={item.id === 'auto_scroll' && item.icon === 'stop' ? 'pause' : MORE_ICONS[item.id]}
            title={item.label}
            onPress={() => handleItemPress(item.id)}
            disabled={!item.enabled}
            accessibilityLabel={item.accessibilityLabel}
            testID={`page-tools-more-${item.id}`}
          />
        ))}
      </DsRowGroup>

      <ActionSheetModal
        visible={sheet === 'annotate'}
        title={t('lightPageTools.highlightDraw')}
        actions={annotateActions}
        onClose={closeSheet}
        testID="page-tools-annotate-sheet"
      />
      <ActionSheetModal
        visible={sheet === 'capture'}
        title={t('lightPageTools.savePdf')}
        actions={captureActions}
        onClose={closeSheet}
        testID="page-tools-capture-sheet"
      />
    </DsScreen>
  );
});
