import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ToastAndroid } from 'react-native';

import { canOpenInNewTab } from '@/browser/actions/open-link-in-new-tab';
import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { openIncognitoTab } from '@/browser/incognito/incognito.service';
import { canMoveTabToWindow, moveTabToWindow } from '@/browser/profiles/browser-window.service';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { selectActiveTabId, selectMountedTabIds, selectTabs, useBrowserStore } from '@/browser/stores';
import { useTabSound } from '@/browser/tab-sound/components/TabSoundButton';
import { TabVolumeSheet } from '@/browser/tab-sound/components/TabVolumeSheet';
import { tabAudio } from '@/browser/tab-sound/tab-audio.service';
import { backgroundTabNotice } from '@/browser/tabs/background-tab-notice';
import { getGroupsState } from '@/browser/tabs/tab-groups-state';
import { takeTabOutOfGroup, useTabGroups } from '@/browser/tabs/tab-groups.service';
import { canMoveTab, normalizeTabSortOrder } from '@/browser/tabs/tab-list-ops';
import { DsHeader, DsRow, DsRowGroup, DsScreen, DsSectionLabel } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useSettingsStore } from '@/store/settings';

import { CloseTabsDialog, type CloseTabsDialogRequest } from './CloseTabsDialog';
import { AddToGroupSheet } from './TabGroupsUI';
import { tabDisplaySite, tabDisplayTitle } from './tab-display';
import { useTabsScreenPresence } from './useTabsScreenPresence';

export type TabOptionsScreenProps = {
  tabId: string;
};

type CloseRequest = CloseTabsDialogRequest & { keepTabId: string | null };

/** Back past the Tabs screen to the page (after an action that put a new tab in front). */
function backToBrowser(): void {
  try {
    navigation.dismiss(2);
  } catch {
    navigation.back();
  }
}

/**
 * Design 35 "Tab · Long-press menu": the rows of the old TabActionsSheet as a screen (pin, mute, duplicate, window,
 * group, sleep, close others / all; open this page in the background or in incognito), plus Move up / Move down,
 * Tab volume and Close tab at the end so nothing the sheet offered is lost.
 */
export const TabOptionsScreen = memo(function TabOptionsScreen({ tabId }: TabOptionsScreenProps) {
  useTabsScreenPresence();
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const tabs = useBrowserStore(selectTabs);
  const activeTabId = useBrowserStore(selectActiveTabId);
  const mountedTabIds = useBrowserStore(selectMountedTabIds);
  const groupsState = useTabGroups();
  const sound = useTabSound(tabId);
  const sortOrder = normalizeTabSortOrder(useSettingsStore((s) => s.tabSortOrder));
  const tab = useMemo(() => tabs.find((entry) => entry.id === tabId) ?? null, [tabId, tabs]);

  const [closeRequest, setCloseRequest] = useState<CloseRequest | null>(null);
  const [groupPickerTabId, setGroupPickerTabId] = useState<string | null>(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  // Set before an action of ours removes the tab, so the "closed elsewhere" exit below stays quiet.
  const leavingRef = useRef(false);

  const leave = useCallback(() => {
    leavingRef.current = true;
    navigation.back();
  }, []);

  // The tab closed while this screen was open (Undo, a group closing, a window): nothing to show, go back.
  useEffect(() => {
    if (tab || leavingRef.current) return;
    leavingRef.current = true;
    ToastAndroid.show(t('lightTabs.tabGone'), ToastAndroid.SHORT);
    navigation.back();
  }, [t, tab]);

  const active = tab?.id === activeTabId;
  const grouped = Boolean(groupsState.membership[tabId]);
  const awake = mountedTabIds.includes(tabId);
  const canSleep = Boolean(tab) && !active && !sound.playing && awake;
  const webPage = tab ? canOpenInNewTab(tab.url) : false;
  const canMoveWindow = canMoveTabToWindow(tab);
  const canMoveUp = sortOrder === 'manual' && canMoveTab(tabs, tabId, -1);
  const canMoveDown = sortOrder === 'manual' && canMoveTab(tabs, tabId, 1);

  const handlePin = useCallback(() => {
    if (!tab) return;
    useBrowserStore.getState().setTabPinned(tab.id, !tab.pinned);
    leave();
  }, [leave, tab]);

  const handleMute = useCallback(() => {
    tabAudio.setMuted(tabId, !sound.muted);
    leave();
  }, [leave, sound.muted, tabId]);

  const handleDuplicate = useCallback(() => {
    const result = useBrowserStore.getState().duplicateTab(tabId);
    if (result.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
      return;
    }
    leave();
  }, [leave, tabId]);

  // B20 #16, as the overflow menu does it.
  const handleMoveToWindow = useCallback(async () => {
    leavingRef.current = true;
    const outcome = await moveTabToWindow(tabId, {
      rtl: rtl.isRtl,
      dark: theme.mode === 'dark',
      colors: {
        background: theme.colors.background,
        surface: theme.colors.surface,
        text: theme.colors.textPrimary,
        textSecondary: theme.colors.textSecondary,
        accent: theme.colors.primary,
      },
      labels: {
        back: t('browserProfiles.windowBack'),
        forward: t('browserProfiles.windowForward'),
        reload: t('browserProfiles.windowReload'),
        stop: t('browserProfiles.windowStop'),
        moveBack: t('browserProfiles.windowMoveBack'),
        close: t('browserProfiles.windowClose'),
      },
    });
    if (outcome === 'moved') {
      AccessibilityInfo.announceForAccessibility(t('browserProfiles.moved'));
      navigation.back();
      return;
    }
    leavingRef.current = false;
    ToastAndroid.show(t('browserProfiles.moveFailed'), ToastAndroid.SHORT);
  }, [rtl.isRtl, t, tabId, theme]);

  const handleGroup = useCallback(() => {
    if (grouped) {
      takeTabOutOfGroup(tabId);
      leave();
      return;
    }
    setGroupPickerTabId(tabId);
  }, [grouped, leave, tabId]);

  const handleGroupPickerClose = useCallback(() => {
    setGroupPickerTabId(null);
    // A group was chosen (the sheet's action ran before it closed): done here.
    if (getGroupsState().membership[tabId]) leave();
  }, [leave, tabId]);

  const handleSleep = useCallback(() => {
    if (!canSleep) {
      ToastAndroid.show(t('lightTabs.sleepTabBlocked'), ToastAndroid.SHORT);
      return;
    }
    useBrowserStore.getState().sleepTabs([tabId]);
    leave();
  }, [canSleep, leave, t, tabId]);

  const requestClose = useCallback(
    (kind: 'others' | 'all') => {
      const candidates = tabs.filter((entry) => kind === 'all' || entry.id !== tabId);
      setCloseRequest({
        kind,
        keepTabId: kind === 'others' ? tabId : null,
        unpinnedCount: candidates.filter((entry) => !entry.pinned).length,
        pinnedCount: candidates.filter((entry) => entry.pinned).length,
      });
    },
    [tabId, tabs],
  );

  const confirmClose = useCallback(
    (includePinned: boolean) => {
      const request = closeRequest;
      setCloseRequest(null);
      if (!request) return;
      leavingRef.current = true;
      const store = useBrowserStore.getState();
      if (request.kind === 'all') {
        store.closeAllTabs({ includePinned });
      } else if (request.keepTabId) {
        store.closeOtherTabs(request.keepTabId, { includePinned });
      }
      navigation.back();
    },
    [closeRequest],
  );

  // B6 #51: this page again, in a tab behind this one (incognito stays incognito).
  const handleOpenInBackground = useCallback(() => {
    if (!tab || !webPage) return;
    const incognito = isIncognitoTabId(tab.id);
    const outcome = useBrowserStore
      .getState()
      .openTabInBackground(tab.url, { title: tab.title, ...(incognito ? { incognito: true } : {}) });
    if (outcome.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
      return;
    }
    backgroundTabNotice.offer(outcome.tabId);
    leave();
  }, [leave, tab, webPage]);

  // B11 #52: this page in a new incognito tab, in front.
  const handleOpenInIncognito = useCallback(() => {
    if (!tab) return;
    leavingRef.current = true;
    void openIncognitoTab(webPage ? tab.url : undefined).then((outcome) => {
      if (outcome === 'opened') backToBrowser();
      else leavingRef.current = false;
    });
  }, [tab, webPage]);

  const handleMoveBy = useCallback(
    (delta: -1 | 1) => {
      useBrowserStore.getState().moveTabBy(tabId, delta);
      const next = useBrowserStore.getState().tabs;
      const position = next.findIndex((entry) => entry.id === tabId) + 1;
      AccessibilityInfo.announceForAccessibility(t('browserTabs.movedTo', { position, count: next.length }));
    },
    [t, tabId],
  );

  const handleCloseTab = useCallback(() => {
    leavingRef.current = true;
    useBrowserStore.getState().closeTab(tabId);
    navigation.back();
  }, [tabId]);

  const openSettings = useCallback(() => navigation.push(routePaths.browserSettings), []);

  if (!tab) {
    return <DsScreen testID="browser-tab-options-screen" />;
  }

  return (
    <DsScreen testID="browser-tab-options-screen">
      <DsHeader
        title={t('browserTabs.menuA11y')}
        subtitle={tabDisplaySite(tab, t)}
        onBack={navigation.back}
        action={{ icon: 'settings', accessibilityLabel: t('browserSettings.title'), onPress: openSettings, testID: 'browser-tab-options-settings' }}
      />
      <DsRowGroup testID="browser-tab-options-rows">
        <DsRow icon="pin" title={tab.pinned ? t('browserTabs.unpin') : t('browserTabs.pin')} onPress={handlePin} testID="browser-tab-option-pin" />
        <DsRow
          icon={sound.muted ? 'volume-x' : 'volume-2'}
          title={sound.muted ? t('browserTabSound.unmute') : t('browserTabSound.mute')}
          onPress={handleMute}
          testID="browser-tab-option-mute"
        />
        <DsRow icon="layers" title={t('browserTabs.duplicate')} onPress={handleDuplicate} testID="browser-tab-option-duplicate" />
        <DsRow
          icon="monitor"
          title={t('browserProfiles.moveToWindow')}
          onPress={() => void handleMoveToWindow()}
          disabled={!canMoveWindow}
          testID="browser-tab-option-window"
        />
        <DsRow
          icon="folder"
          title={grouped ? t('browserTabGroups.removeFromGroup') : t('browserTabGroups.addToGroup')}
          onPress={handleGroup}
          testID="browser-tab-option-group"
        />
        <DsRow
          icon="moon"
          title={t('lightTabs.sleepTab')}
          onPress={handleSleep}
          disabled={!canSleep}
          accessibilityHint={canSleep ? t('lightTabs.sleepTabHint') : t('lightTabs.sleepTabBlocked')}
          testID="browser-tab-option-sleep"
        />
        <DsRow icon="x" title={t('browserTabs.closeOthers')} onPress={() => requestClose('others')} disabled={tabs.length <= 1} testID="browser-tab-option-close-others" />
        <DsRow icon="trash-2" title={t('browserTabs.closeAll')} onPress={() => requestClose('all')} testID="browser-tab-option-close-all" />
      </DsRowGroup>

      <DsSectionLabel>{t('lightTabs.linkLongPress')}</DsSectionLabel>
      <DsRowGroup testID="browser-tab-options-link-rows">
        <DsRow
          icon="plus"
          title={t('lightTabs.openInBackground')}
          onPress={handleOpenInBackground}
          disabled={!webPage}
          accessibilityHint={t('lightTabs.openInBackgroundHint')}
          testID="browser-tab-option-background"
        />
        <DsRow
          icon="eye"
          title={t('browserIncognito.openInIncognito')}
          onPress={handleOpenInIncognito}
          accessibilityHint={t('lightTabs.openInIncognitoHint')}
          testID="browser-tab-option-incognito"
        />
        {/* Not on the frame: reorder without dragging (B1 accessibility), the tab's volume (B3 #220) and Close tab. */}
        <DsRow icon="chevron-up" title={t('browserTabs.moveUp')} onPress={() => handleMoveBy(-1)} disabled={!canMoveUp} testID="browser-tab-option-move-up" />
        <DsRow icon="chevron-down" title={t('browserTabs.moveDown')} onPress={() => handleMoveBy(1)} disabled={!canMoveDown} testID="browser-tab-option-move-down" />
        <DsRow icon="sliders-horizontal" title={t('browserTabSound.volume')} onPress={() => setVolumeOpen(true)} testID="browser-tab-option-volume" />
        <DsRow icon="x" title={t('browserTabs.closeTab')} destructive onPress={handleCloseTab} testID="browser-tab-option-close" />
      </DsRowGroup>

      <AddToGroupSheet tabId={groupPickerTabId} onClose={handleGroupPickerClose} />
      <TabVolumeSheet tabId={volumeOpen ? tabId : null} title={tabDisplayTitle(tab, t)} onClose={() => setVolumeOpen(false)} />
      <CloseTabsDialog request={closeRequest} onCancel={() => setCloseRequest(null)} onConfirm={confirmClose} />
    </DsScreen>
  );
});
