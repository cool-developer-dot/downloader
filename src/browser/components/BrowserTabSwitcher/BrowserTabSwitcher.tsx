import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Modal,
  Pressable as RNPressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { SearchField } from '@/components/inputs/SearchField';
import { TabUndoSnackbar } from '@/browser/components/TabUndoSnackbar/TabUndoSnackbar';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { selectActiveTabId, selectTabs, useBrowserStore } from '@/browser/stores';
import { closedTabsService } from '@/browser/tabs/closed-tabs.service';
import { MAX_OPEN_TABS } from '@/browser/tabs/constants';
import {
  canMoveTab,
  normalizeTabSortOrder,
  pinnedCount as countPinned,
  sortTabsForDisplay,
  TAB_SORT_ORDERS,
  type TabSortOrder,
} from '@/browser/tabs/tab-list-ops';
import { tabSnapshots } from '@/browser/tabs/tab-snapshots';
import type { BrowserTab } from '@/browser/tabs/types';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslateFn } from '@/localization';
import { useSettingsStore } from '@/store/settings';
import { useTourBlocker } from '@/tour/tour-store';
import { matchesSearch } from '@/utils/search-text';

import { CloseTabsDialog, type CloseTabsDialogRequest } from './CloseTabsDialog';
import { SortableTabList } from './SortableTabList';
import { AddToGroupSheet, ClosedGroupsSheet, GroupedTabList, TimelineSheet, useHasGroups } from './TabGroupsUI';
import { groupTabWith, groupTabsBySite, takeTabOutOfGroup, useClosedGroups, useTabGroups } from '@/browser/tabs/tab-groups.service';
import { TabActionsSheet, type TabSheetAction } from './TabActionsSheet';
import { tabAudio } from '@/browser/tab-sound/tab-audio.service';
import { TabVolumeSheet } from '@/browser/tab-sound/components/TabVolumeSheet';
import { bookmarkAllTabs } from '@/browser/bookmarks/bookmarks.service';
import { readableTabUrl, tabDisplaySite, tabDisplayTitle, tabSiteKey } from './tab-display';
import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { closeAllIncognitoTabs, isIncognitoAvailable, openIncognitoTab } from '@/browser/incognito/incognito.service';
import { INCOGNITO_COLORS } from '@/browser/incognito/incognito-theme';
import { IncognitoIcon } from '@/browser/incognito/components/IncognitoIcon';

export type BrowserTabSwitcherProps = {
  visible: boolean;
  onClose: () => void;
  onLimitReached?: () => void;
  testID?: string;
};

const SORT_LABEL_KEYS: Record<TabSortOrder, string> = {
  manual: 'browserTabs.sortManual',
  site: 'browserTabs.sortSite',
  lastUsed: 'browserTabs.sortLastUsed',
  opened: 'browserTabs.sortOpened',
};

function sortLabel(order: TabSortOrder, t: TranslateFn): string {
  return t(SORT_LABEL_KEYS[order] as never);
}

type CloseRequest = CloseTabsDialogRequest & { keepTabId: string | null };

/**
 * The tab switcher (B1): search, sort, drag to reorder, previews, pin, duplicate, close other / all tabs, reopen a
 * closed tab, and Undo after every close.
 */
export const BrowserTabSwitcher = memo(function BrowserTabSwitcher({
  visible,
  onClose,
  onLimitReached,
  testID = 'browser-tab-switcher',
}: BrowserTabSwitcherProps) {
  const theme = useTheme();
  const { t, rtl } = useTranslation();
  const insets = useSafeAreaInsets();
  const tabs = useBrowserStore(selectTabs);
  const activeTabId = useBrowserStore(selectActiveTabId);
  const sortOrder = normalizeTabSortOrder(useSettingsStore((s) => s.tabSortOrder));
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const closedTabs = useSyncExternalStore(closedTabsService.subscribe, closedTabsService.getSnapshot);

  const [query, setQuery] = useState('');
  const [optionsTabId, setOptionsTabId] = useState<string | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [sortVisible, setSortVisible] = useState(false);
  const [closeRequest, setCloseRequest] = useState<CloseRequest | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const window = useWindowDimensions();
  const prunedRef = useRef(false);

  // The sheet sits above the keyboard while the tab search is typed in (a Modal window is not resized for it).
  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);

  useTourBlocker(visible);

  // Opening the switcher refreshes the active tab's preview; stale files of long-gone tabs are cleaned once.
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setOptionsTabId(null);
      setMenuVisible(false);
      setSortVisible(false);
      setCloseRequest(null);
      return;
    }
    const state = useBrowserStore.getState();
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (active) {
      void tabSnapshots.capture(active);
    }
    if (!prunedRef.current) {
      prunedRef.current = true;
      tabSnapshots.prune([...state.tabs.map((tab) => tab.id), ...closedTabsService.getAll().map((e) => e.id)]);
    }
  }, [visible]);

  const displayed = useMemo(() => sortTabsForDisplay(tabs, sortOrder, tabSiteKey), [sortOrder, tabs]);
  const trimmedQuery = query.trim();
  const filtered = useMemo(
    () =>
      trimmedQuery
        ? displayed.filter((tab) =>
            matchesSearch(trimmedQuery, [tab.title, readableTabUrl(tab.url), tabDisplaySite(tab, t)]),
          )
        : displayed,
    [displayed, t, trimmedQuery],
  );
  const dragEnabled = sortOrder === 'manual' && !trimmedQuery;
  const pinned = countPinned(tabs);

  const canMove = useCallback((tabId: string, delta: -1 | 1) => canMoveTab(tabs, tabId, delta), [tabs]);

  const handleSelect = useCallback(
    (tabId: string) => {
      useBrowserStore.getState().switchTab(tabId);
      onClose();
    },
    [onClose],
  );

  const handleCloseTab = useCallback((tabId: string) => {
    useBrowserStore.getState().closeTab(tabId);
  }, []);

  const handleMove = useCallback((tabId: string, toIndex: number) => {
    useBrowserStore.getState().moveTab(tabId, toIndex);
  }, []);

  const handleMoveBy = useCallback(
    (tabId: string, delta: -1 | 1) => {
      const store = useBrowserStore.getState();
      store.moveTabBy(tabId, delta);
      const next = useBrowserStore.getState().tabs;
      const position = next.findIndex((tab) => tab.id === tabId) + 1;
      AccessibilityInfo.announceForAccessibility(t('browserTabs.movedTo', { position, count: next.length }));
    },
    [t],
  );

  // B11 #104: a new incognito tab from the switcher.
  const handleNewIncognitoTab = useCallback(() => {
    void openIncognitoTab().then((outcome) => {
      if (outcome === 'opened') onClose();
      else if (outcome === 'limit') onLimitReached?.();
    });
  }, [onClose, onLimitReached]);
  const incognitoAvailable = useMemo(() => isIncognitoAvailable(), []);
  // B11: incognito tabs are listed apart, after the normal ones, in their own look.
  const normalTabs = useMemo(() => filtered.filter((tab) => !isIncognitoTabId(tab.id)), [filtered]);
  const incognitoTabs = useMemo(() => filtered.filter((tab) => isIncognitoTabId(tab.id)), [filtered]);
  const hasIncognito = useMemo(() => tabs.some((tab) => isIncognitoTabId(tab.id)), [tabs]);
  // B2: with groups the list shows group blocks (no drag there); without, B1's sortable list exactly as before.
  const groupsState = useTabGroups();
  const closedGroups = useClosedGroups();
  const normalGrouped = useHasGroups(normalTabs);
  const incognitoGrouped = useHasGroups(incognitoTabs);
  const [groupPickerTabId, setGroupPickerTabId] = useState<string | null>(null);
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [closedGroupsVisible, setClosedGroupsVisible] = useState(false);
  const noMove = useCallback(() => false, []);
  const noop = useCallback(() => undefined, []);

  const handleNewTab = useCallback(() => {
    const result = useBrowserStore.getState().createTab();
    if (result.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
      onLimitReached?.();
      return;
    }
    onClose();
  }, [onClose, onLimitReached]);

  const handleReopen = useCallback(() => {
    const outcome = useBrowserStore.getState().reopenClosedTab();
    if (outcome.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
      onLimitReached?.();
    } else if (outcome.status === 'RESTORED') {
      AccessibilityInfo.announceForAccessibility(t('browserTabs.reopened'));
    }
  }, [onLimitReached, t]);

  const requestClose = useCallback(
    (kind: 'others' | 'all', keepTabId: string | null) => {
      const candidates = tabs.filter((tab) => kind === 'all' || tab.id !== keepTabId);
      setCloseRequest({
        kind,
        keepTabId,
        unpinnedCount: candidates.filter((tab) => !tab.pinned).length,
        pinnedCount: candidates.filter((tab) => tab.pinned).length,
      });
    },
    [tabs],
  );

  const confirmClose = useCallback(
    (includePinned: boolean) => {
      const request = closeRequest;
      setCloseRequest(null);
      if (!request) return;
      const store = useBrowserStore.getState();
      if (request.kind === 'all') {
        store.closeAllTabs({ includePinned });
      } else if (request.keepTabId) {
        store.closeOtherTabs(request.keepTabId, { includePinned });
      }
    },
    [closeRequest],
  );

  // B3 #220: the tab whose volume sheet is open.
  const [volumeTabId, setVolumeTabId] = useState<string | null>(null);
  const volumeTab = useMemo(() => tabs.find((tab) => tab.id === volumeTabId) ?? null, [tabs, volumeTabId]);

  const optionsTab: BrowserTab | null = useMemo(
    () => tabs.find((tab) => tab.id === optionsTabId) ?? null,
    [optionsTabId, tabs],
  );

  // B3: the options tab's mute state, so Mute / Unmute follows it (the list below is memoized).
  const optionsMuted = useSyncExternalStore(tabAudio.subscribe, () => (optionsTabId ? tabAudio.get(optionsTabId).muted : false));

  const optionsActions = useMemo((): TabSheetAction[] => {
    if (!optionsTab) return [];
    const id = optionsTab.id;
    const list: TabSheetAction[] = [
      {
        id: optionsTab.pinned ? 'unpin' : 'pin',
        label: optionsTab.pinned ? t('browserTabs.unpin') : t('browserTabs.pin'),
        icon: optionsTab.pinned ? 'pin-off-outline' : 'pin-outline',
        onPress: () => useBrowserStore.getState().setTabPinned(id, !optionsTab.pinned),
      },
      {
        id: 'duplicate',
        label: t('browserTabs.duplicate'),
        icon: 'content-duplicate',
        onPress: () => {
          const result = useBrowserStore.getState().duplicateTab(id);
          if (result.status === 'LIMIT_REACHED') {
            announceTabsLimitReached();
            onLimitReached?.();
          }
        },
      },
    ];
    if (dragEnabled && canMoveTab(tabs, id, -1)) {
      list.push({ id: 'move_up', label: t('browserTabs.moveUp'), icon: 'arrow-up', onPress: () => handleMoveBy(id, -1) });
    }
    if (dragEnabled && canMoveTab(tabs, id, 1)) {
      list.push({ id: 'move_down', label: t('browserTabs.moveDown'), icon: 'arrow-down', onPress: () => handleMoveBy(id, 1) });
    }
    if (tabs.length > 1) {
      list.push({ id: 'close_others', label: t('browserTabs.closeOthers'), icon: 'close-box-multiple-outline', onPress: () => requestClose('others', id) });
    }
    // B3 #8 / #220: this tab's sound.
    const muted = optionsMuted;
    list.push({
      id: muted ? 'unmute' : 'mute',
      label: muted ? t('browserTabSound.unmute') : t('browserTabSound.mute'),
      icon: muted ? 'volume-high' : 'volume-off',
      onPress: () => tabAudio.setMuted(id, !muted),
    });
    list.push({ id: 'volume', label: t('browserTabSound.volume'), icon: 'volume-medium', onPress: () => setVolumeTabId(id) });
    // B2 #6: groups (incognito tabs only with incognito tabs).
    list.push({ id: 'add_to_group', label: t('browserTabGroups.addToGroup'), icon: 'group', onPress: () => setGroupPickerTabId(id) });
    if (groupsState.membership[id]) {
      list.push({ id: 'remove_from_group', label: t('browserTabGroups.removeFromGroup'), icon: 'ungroup', onPress: () => takeTabOutOfGroup(id) });
    }
    list.push({ id: 'close', label: t('browserTabs.closeTab'), icon: 'close', destructive: true, onPress: () => handleCloseTab(id) });
    return list;
  }, [dragEnabled, groupsState, handleCloseTab, handleMoveBy, onLimitReached, optionsMuted, optionsTab, requestClose, t, tabs]);

  const menuActions = useMemo((): ActionSheetItem[] => {
    const list: ActionSheetItem[] = [];
    if (closedTabs.length > 0) {
      list.push({ id: 'reopen', label: t('browserTabs.reopenClosed'), icon: 'restore', onPress: handleReopen });
    }
    // B2 #258 / #259 / #288.
    list.push({ id: 'group_by_site', label: t('browserTabGroups.groupBySite'), icon: 'group', onPress: groupTabsBySite });
    list.push({ id: 'timeline', label: t('browserTabGroups.timeline'), icon: 'timeline-clock-outline', onPress: () => setTimelineVisible(true) });
    if (closedGroups.length > 0) {
      list.push({ id: 'closed_groups', label: t('browserTabGroups.closedGroups'), icon: 'restore', onPress: () => setClosedGroupsVisible(true) });
    }
    // B9 #83: every open page into a new bookmark folder named with the date.
    list.push({ id: 'bookmark_all', label: t('browserBookmarks.bookmarkAllTabs'), icon: 'bookmark-plus-outline', onPress: () => void bookmarkAllTabs() });
    list.push({
      id: 'sort',
      label: t('browserTabs.sortByValue', { order: sortLabel(sortOrder, t) }),
      icon: 'sort',
      onPress: () => setSortVisible(true),
    });
    if (tabs.length > 1) {
      list.push({ id: 'close_others', label: t('browserTabs.closeOthers'), icon: 'close-box-multiple-outline', onPress: () => requestClose('others', activeTabId) });
    }
    list.push({ id: 'close_all', label: t('browserTabs.closeAll'), icon: 'tab-remove', destructive: true, onPress: () => requestClose('all', null) });
    return list;
  }, [activeTabId, closedGroups.length, closedTabs.length, handleReopen, requestClose, sortOrder, t, tabs.length]);

  const sortActions = useMemo(
    (): ActionSheetItem[] =>
      TAB_SORT_ORDERS.map((order) => ({
        id: `sort_${order}`,
        label: sortLabel(order, t),
        selected: order === sortOrder,
        onPress: () => updateSetting('tabSortOrder', order),
      })),
    [sortOrder, t, updateSetting],
  );

  // Unmount when dismissed — Android transparent Modal leftover windows
  // intercept taps across Browser / Downloads / Library.
  if (!visible) {
    return null;
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root} testID={`${testID}-root`}>
        <RNPressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          onPress={onClose}
          style={[styles.backdrop, { backgroundColor: `rgba(0,0,0,${theme.opacity.overlay})` }]}
        />
        <View
          testID={testID}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.card,
              borderTopLeftRadius: theme.radius.xl,
              borderTopRightRadius: theme.radius.xl,
              paddingBottom: keyboardHeight > 0 ? 8 : insets.bottom + 16,
              marginBottom: keyboardHeight,
              maxHeight: keyboardHeight > 0 ? window.height - keyboardHeight - insets.top - 24 : '88%',
            },
          ]}>
          <View style={[styles.handle, { backgroundColor: theme.colors.border }]} />
          <Box
            px={16}
            pb={8}
            style={{ flexDirection: rtl.rowDirection, alignItems: 'center', gap: 4 }}>
            <Text variant="title" style={{ flex: 1 }} accessibilityRole="header">
              {t('browser.tabSwitcherTitle')}
            </Text>
            <Text variant="caption" color="textSecondary">
              {tabs.length}/{MAX_OPEN_TABS}
            </Text>
            <Pressable
              testID={`${testID}-sort`}
              accessibilityRole="button"
              accessibilityLabel={t('browserTabs.sortA11y', { order: sortLabel(sortOrder, t) })}
              onPress={() => setSortVisible(true)}
              style={styles.iconButton}>
              <Icon name="sort" size={22} color={sortOrder === 'manual' ? 'secondary' : 'primary'} />
            </Pressable>
            <Pressable
              testID={`${testID}-menu`}
              accessibilityRole="button"
              accessibilityLabel={t('browserTabs.menuA11y')}
              onPress={() => setMenuVisible(true)}
              style={styles.iconButton}>
              <Icon name="dots-vertical" size={22} color="secondary" />
            </Pressable>
          </Box>

          <Box px={16} pb={8}>
            <SearchField
              testID={`${testID}-search`}
              value={query}
              onChangeText={setQuery}
              placeholder={t('browserTabs.searchPlaceholder')}
              accessibilityLabel={t('browserTabs.searchA11y')}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {sortOrder !== 'manual' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('browserTabs.sortByValue', { order: sortLabel(sortOrder, t) })}. ${t('browserTabs.dragOnlyManual')}`}
                onPress={() => setSortVisible(true)}
                style={{ minHeight: 32, justifyContent: 'center' }}>
                <Text variant="caption" color="textSecondary">
                  {t('browserTabs.sortByValue', { order: sortLabel(sortOrder, t) })} · {t('browserTabs.dragOnlyManual')}
                </Text>
              </Pressable>
            ) : null}
          </Box>

          {filtered.length === 0 && trimmedQuery ? (
            <Box px={16} py={24}>
              <Text variant="body" color="textSecondary" align="center" accessibilityLiveRegion="polite">
                {t('browserTabs.noMatches', { query: trimmedQuery })}
              </Text>
            </Box>
          ) : (
            <>
              {normalGrouped ? (
                <GroupedTabList tabs={normalTabs} activeTabId={activeTabId} onSelect={handleSelect} onClose={handleCloseTab} onOptions={setOptionsTabId} />
              ) : (
                <SortableTabList
                  tabs={normalTabs}
                  activeTabId={activeTabId}
                  // Dragging uses positions in this list; with incognito tabs in between, Move up / down only.
                  dragEnabled={dragEnabled && !hasIncognito}
                  pinnedCount={pinned}
                  canMove={canMove}
                  onSelect={handleSelect}
                  onClose={handleCloseTab}
                  onOptions={setOptionsTabId}
                  onMove={handleMove}
                  onMoveBy={handleMoveBy}
                  // B2 #6: hold a dragged tab over another and let go to group the two.
                  onDropOnto={groupTabWith}
                />
              )}
              {incognitoTabs.length > 0 ? (
                <View
                  testID="browser-tab-switcher-incognito"
                  style={{
                    marginHorizontal: 12,
                    marginTop: 8,
                    paddingVertical: 8,
                    borderRadius: theme.radius.lg,
                    backgroundColor: INCOGNITO_COLORS.surface,
                  }}>
                  <Box row rtlRow center gap={8} px={12} style={{ minHeight: 48 }}>
                    <IncognitoIcon size={22} />
                    <Box flex={1} style={{ minWidth: 0 }}>
                      <Text
                        variant="label"
                        accessibilityRole="header"
                        style={{ color: INCOGNITO_COLORS.text, textAlign: rtl.textAlign }}>
                        {t('browserIncognito.sectionTitle')}
                      </Text>
                      <Text variant="caption" style={{ color: INCOGNITO_COLORS.muted, textAlign: rtl.textAlign }}>
                        {t('browserIncognito.sectionHint')}
                      </Text>
                    </Box>
                    <Pressable
                      testID="browser-tab-switcher-close-incognito"
                      accessibilityRole="button"
                      accessibilityLabel={t('browserIncognito.closeAllA11y')}
                      onPress={() => void closeAllIncognitoTabs()}
                      style={{
                        minHeight: 48,
                        minWidth: 48,
                        paddingHorizontal: 8,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                      <Text variant="caption" style={{ color: INCOGNITO_COLORS.text }}>
                        {t('browserIncognito.closeAll')}
                      </Text>
                    </Pressable>
                  </Box>
                  {incognitoGrouped ? (
                    <GroupedTabList tabs={incognitoTabs} activeTabId={activeTabId} onSelect={handleSelect} onClose={handleCloseTab} onOptions={setOptionsTabId} />
                  ) : (
                    <SortableTabList
                      tabs={incognitoTabs}
                      activeTabId={activeTabId}
                      dragEnabled={false}
                      pinnedCount={0}
                      canMove={noMove}
                      onSelect={handleSelect}
                      onClose={handleCloseTab}
                      onOptions={setOptionsTabId}
                      onMove={noop}
                      onMoveBy={noop}
                    />
                  )}
                </View>
              ) : null}
            </>
          )}

          <Box px={16} pt={8}>
            <Pressable
              testID="browser-tab-switcher-new-tab"
              accessibilityRole="button"
              accessibilityLabel={t('browser.newTabA11y')}
              onPress={handleNewTab}
              style={{
                minHeight: 48,
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: rtl.rowDirection,
                gap: 8,
              }}>
              <Icon name="tab-plus" size={20} color="onPrimary" />
              <Text variant="label" color="textOnPrimary">
                {t('browser.newTab')}
              </Text>
            </Pressable>
            {incognitoAvailable ? (
              <Pressable
                testID="browser-tab-switcher-new-incognito-tab"
                accessibilityRole="button"
                accessibilityLabel={t('browserIncognito.newTabA11y')}
                onPress={handleNewIncognitoTab}
                style={{
                  minHeight: 48,
                  marginTop: 8,
                  borderRadius: theme.radius.lg,
                  backgroundColor: INCOGNITO_COLORS.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: rtl.rowDirection,
                  gap: 8,
                }}>
                <IncognitoIcon size={20} />
                <Text variant="label" style={{ color: INCOGNITO_COLORS.text }}>
                  {t('browserIncognito.newTab')}
                </Text>
              </Pressable>
            ) : null}
          </Box>
          {/* Over the New tab button: see TabUndoSnackbar's `bottom`. */}
          <TabUndoSnackbar
            visible
            bottom={(keyboardHeight > 0 ? 8 : insets.bottom + 16) - 2}
            testID="browser-tab-switcher-undo"
          />
        </View>

        <TabActionsSheet tab={optionsTab} actions={optionsActions} onClose={() => setOptionsTabId(null)} />
        {/* B2: add to group, the timeline and recently closed groups. */}
        <AddToGroupSheet tabId={groupPickerTabId} onClose={() => setGroupPickerTabId(null)} />
        {timelineVisible ? <TimelineSheet visible onClose={() => setTimelineVisible(false)} onSelect={handleSelect} /> : null}
        <ClosedGroupsSheet visible={closedGroupsVisible} onClose={() => setClosedGroupsVisible(false)} />
        <TabVolumeSheet
          tabId={volumeTab ? volumeTab.id : null}
          title={volumeTab ? tabDisplayTitle(volumeTab, t) : ''}
          onClose={() => setVolumeTabId(null)}
        />
        <ActionSheetModal
          visible={menuVisible}
          actions={menuActions}
          title={t('browser.tabSwitcherTitle')}
          onClose={() => setMenuVisible(false)}
          testID={`${testID}-menu-sheet`}
        />
        <ActionSheetModal
          visible={sortVisible}
          actions={sortActions}
          title={t('browserTabs.sortBy')}
          onClose={() => setSortVisible(false)}
          testID={`${testID}-sort-sheet`}
        />
        <CloseTabsDialog request={closeRequest} onCancel={() => setCloseRequest(null)} onConfirm={confirmClose} />
      </GestureHandlerRootView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
