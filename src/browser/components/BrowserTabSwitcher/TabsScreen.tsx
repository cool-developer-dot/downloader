import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, ToastAndroid, View } from 'react-native';

import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import { bookmarkAllTabs } from '@/browser/bookmarks/bookmarks.service';
import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { isIncognitoAvailable, openIncognitoTab } from '@/browser/incognito/incognito.service';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { selectActiveTabId, selectMountedTabIds, selectTabs, useBrowserStore } from '@/browser/stores';
import { useTabSound } from '@/browser/tab-sound/components/TabSoundButton';
import { closedTabsService } from '@/browser/tabs/closed-tabs.service';
import { GROUP_COLORS, type GroupsState } from '@/browser/tabs/tab-groups';
import { groupTabsBySite, useClosedGroups, useTabGroups } from '@/browser/tabs/tab-groups.service';
import { normalizeTabSortOrder, sortTabsForDisplay, TAB_SORT_ORDERS, type TabSortOrder } from '@/browser/tabs/tab-list-ops';
import { tabSnapshots } from '@/browser/tabs/tab-snapshots';
import type { BrowserTab } from '@/browser/tabs/types';
import { isBrowserHomeUrl } from '@/browser/utils';
import {
  DsChip,
  DsChipRow,
  DsHeader,
  DsIcon,
  DsRow,
  DsRowGroup,
  DsScreen,
  DsSearchField,
  DsSectionLabel,
  DsTile,
  DsTileGrid,
  ds,
  type DsIconName,
} from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation, type TranslateFn } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useSettingsStore } from '@/store/settings';
import { matchesSearch } from '@/utils/search-text';

import { CloseTabsDialog, type CloseTabsDialogRequest } from './CloseTabsDialog';
import { useTabSnapshot } from './TabCard';
import { ClosedGroupsSheet, TimelineSheet } from './TabGroupsUI';
import { readableTabUrl, tabDisplaySite, tabDisplayTitle, tabSiteKey } from './tab-display';
import { useTabsScreenPresence } from './useTabsScreenPresence';

type TabsFilter = 'all' | 'groups' | 'incognito' | 'sleeping';

const SORT_LABEL_KEYS: Record<TabSortOrder, string> = {
  manual: 'browserTabs.sortManual',
  site: 'browserTabs.sortSite',
  lastUsed: 'browserTabs.sortLastUsed',
  opened: 'browserTabs.sortOpened',
};

function sortLabel(order: TabSortOrder, t: TranslateFn): string {
  return t(SORT_LABEL_KEYS[order] as never);
}

/** The preview size on a tile: a 21 dp square with 4 dp corners, where the design draws its picture icon. */
const PREVIEW = 21;
const PREVIEW_RADIUS = 4;

/** B1's order (or sort), with each group's tabs kept together where the group's first tab is (collapse ignored). */
function orderWithGroups(tabs: readonly BrowserTab[], state: GroupsState): BrowserTab[] {
  const out: BrowserTab[] = [];
  const placed = new Set<string>();
  const groupsShown = new Set<string>();
  for (const tab of tabs) {
    if (placed.has(tab.id)) continue;
    const groupId = state.membership[tab.id];
    if (!groupId) {
      out.push(tab);
      placed.add(tab.id);
      continue;
    }
    if (groupsShown.has(groupId)) continue;
    groupsShown.add(groupId);
    for (const member of tabs) {
      if (state.membership[member.id] === groupId && !placed.has(member.id)) {
        out.push(member);
        placed.add(member.id);
      }
    }
  }
  return out;
}

let prunedOnce = false;

/**
 * Design 2 "Browser · Tabs": the tab grid with its filter chips, the group-history rows, and (under MANAGE) what the
 * old switcher's menu offered. The screen is the design; the tab logic is the store's and B1–B3's services.
 */
export const TabsScreen = memo(function TabsScreen() {
  useTabsScreenPresence();
  const { t } = useTranslation();
  const tabs = useBrowserStore(selectTabs);
  const activeTabId = useBrowserStore(selectActiveTabId);
  const mountedTabIds = useBrowserStore(selectMountedTabIds);
  const groupsState = useTabGroups();
  const closedGroups = useClosedGroups();
  const sortOrder = normalizeTabSortOrder(useSettingsStore((s) => s.tabSortOrder));
  const autoGroup = useSettingsStore((s) => s.groupTabsFromOpener === true);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const closedTabs = useSyncExternalStore(closedTabsService.subscribe, closedTabsService.getSnapshot);

  const [filter, setFilter] = useState<TabsFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [closedGroupsVisible, setClosedGroupsVisible] = useState(false);
  const [sortVisible, setSortVisible] = useState(false);
  const [closeRequest, setCloseRequest] = useState<CloseTabsDialogRequest | null>(null);

  // Stale preview files of long-gone tabs are cleaned once per app run, as the old switcher did when it opened.
  useEffect(() => {
    if (prunedOnce) return;
    prunedOnce = true;
    tabSnapshots.prune([...tabs.map((tab) => tab.id), ...closedTabsService.getAll().map((entry) => entry.id)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, with the tabs open at that moment
  }, []);

  const ordered = useMemo(
    () => orderWithGroups(sortTabsForDisplay(tabs, sortOrder, tabSiteKey), groupsState),
    [groupsState, sortOrder, tabs],
  );
  const trimmedQuery = query.trim();
  const shown = useMemo(() => {
    const byFilter = ordered.filter((tab) => {
      switch (filter) {
        case 'groups':
          return groupsState.membership[tab.id] != null;
        case 'incognito':
          return isIncognitoTabId(tab.id);
        case 'sleeping':
          return !mountedTabIds.includes(tab.id);
        default:
          return true;
      }
    });
    return trimmedQuery
      ? byFilter.filter((tab) => matchesSearch(trimmedQuery, [tab.title, readableTabUrl(tab.url), tabDisplaySite(tab, t)]))
      : byFilter;
  }, [filter, groupsState.membership, mountedTabIds, ordered, t, trimmedQuery]);

  const subtitle = useMemo(() => {
    const groupCount = groupsState.groups.length;
    return t('lightTabs.subtitle', {
      tabs: tabs.length === 1 ? t('lightTabs.tabsOne') : t('browserTabGroups.closedGroupTabs', { count: tabs.length }),
      groups: groupCount === 1 ? t('lightTabs.groupsOne') : t('lightTabs.groupsOther', { count: groupCount }),
    });
  }, [groupsState.groups.length, t, tabs.length]);

  const handleNewTab = useCallback(() => {
    const result = useBrowserStore.getState().createTab();
    if (result.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
      return;
    }
    navigation.back();
  }, []);

  const incognitoAvailable = useMemo(() => isIncognitoAvailable(), []);
  const handleNewIncognitoTab = useCallback(() => {
    void openIncognitoTab().then((outcome) => {
      if (outcome === 'opened') navigation.back();
    });
  }, []);

  const handleSelect = useCallback((tabId: string) => {
    useBrowserStore.getState().switchTab(tabId);
    navigation.back();
  }, []);

  const handleOptions = useCallback((tabId: string) => {
    navigation.push(`${routePaths.browserTabOptions}?tabId=${encodeURIComponent(tabId)}`);
  }, []);

  const handleAutoGroup = useCallback(
    (next: boolean) => {
      updateSetting('groupTabsFromOpener', next);
      if (next) groupTabsBySite();
    },
    [updateSetting],
  );

  const handleReopen = useCallback(() => {
    const outcome = useBrowserStore.getState().reopenClosedTab();
    if (outcome.status === 'LIMIT_REACHED') {
      announceTabsLimitReached();
    } else if (outcome.status === 'RESTORED') {
      AccessibilityInfo.announceForAccessibility(t('browserTabs.reopened'));
    } else {
      ToastAndroid.show(t('browserTabs.noClosedTabs'), ToastAndroid.SHORT);
    }
  }, [t]);

  const requestCloseAll = useCallback(() => {
    setCloseRequest({
      kind: 'all',
      unpinnedCount: tabs.filter((tab) => !tab.pinned).length,
      pinnedCount: tabs.filter((tab) => tab.pinned).length,
    });
  }, [tabs]);

  const confirmClose = useCallback((includePinned: boolean) => {
    setCloseRequest(null);
    useBrowserStore.getState().closeAllTabs({ includePinned });
  }, []);

  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => {
      if (open) setQuery('');
      return !open;
    });
  }, []);

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

  const newTileForIncognito = filter === 'incognito' && incognitoAvailable;

  return (
    <DsScreen testID="browser-tabs-screen">
      <DsHeader
        title={t('browser.tabSwitcherTitle')}
        subtitle={subtitle}
        onBack={navigation.back}
        action={{
          icon: 'plus',
          accessibilityLabel: t('browser.newTabA11y'),
          accessibilityHint: t('lightTabs.newTabHint'),
          onPress: handleNewTab,
          testID: 'browser-tabs-new',
        }}
      />
      <DsChipRow>
        <DsChip label={t('downloads.filterAll')} selected={filter === 'all'} onPress={() => setFilter('all')} testID="browser-tabs-filter-all" />
        <DsChip label={t('lightTabs.filterGroups')} selected={filter === 'groups'} onPress={() => setFilter('groups')} testID="browser-tabs-filter-groups" />
        <DsChip label={t('browserIncognito.badge')} selected={filter === 'incognito'} onPress={() => setFilter('incognito')} testID="browser-tabs-filter-incognito" />
        <DsChip label={t('lightTabs.filterSleeping')} selected={filter === 'sleeping'} onPress={() => setFilter('sleeping')} testID="browser-tabs-filter-sleeping" />
      </DsChipRow>
      {searchOpen ? (
        <DsSearchField
          testID="browser-tabs-search"
          value={query}
          onChangeText={setQuery}
          placeholder={t('browserTabs.searchPlaceholder')}
          accessibilityLabel={t('browserTabs.searchA11y')}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          actions={[{ icon: 'x', accessibilityLabel: t('browserTabs.clearSearchA11y'), onPress: toggleSearch }]}
        />
      ) : null}
      <DsTileGrid testID="browser-tabs-grid">
        {[
          ...shown.map((tab) => {
            const groupId = groupsState.membership[tab.id];
            const group = groupId ? groupsState.groups.find((g) => g.id === groupId) : undefined;
            return (
              <TabTile
                key={tab.id}
                tab={tab}
                active={tab.id === activeTabId}
                sleeping={!mountedTabIds.includes(tab.id)}
                groupColor={group ? GROUP_COLORS[group.color] : null}
                onSelect={handleSelect}
                onOptions={handleOptions}
              />
            );
          }),
          <DsTile
            key="new"
            icon="plus"
            label={t('lightTabs.newTile')}
            accessibilityLabel={newTileForIncognito ? t('browserIncognito.newTabA11y') : t('browser.newTabA11y')}
            onPress={newTileForIncognito ? handleNewIncognitoTab : handleNewTab}
            testID="browser-tabs-new-tile"
          />,
        ]}
      </DsTileGrid>

      <DsSectionLabel>{t('lightTabs.groupHistory')}</DsSectionLabel>
      <DsRowGroup testID="browser-tabs-group-history">
        <DsRow
          icon="folder"
          title={t('lightTabs.smartGrouping')}
          subtitle={t('lightTabs.smartGroupingHint')}
          toggle={{ value: autoGroup, onValueChange: handleAutoGroup }}
          testID="browser-tabs-smart-grouping"
        />
        <DsRow icon="clock" title={t('lightTabs.timeline')} subtitle={t('lightTabs.timelineHint')} onPress={() => setTimelineVisible(true)} testID="browser-tabs-timeline" />
        <DsRow
          icon="refresh-cw"
          title={t('browserTabs.reopenClosed')}
          onPress={handleReopen}
          accessibilityHint={closedTabs.length > 0 ? t('browserTabs.reopenClosedA11y') : t('browserTabs.noClosedTabs')}
          testID="browser-tabs-reopen"
        />
      </DsRowGroup>

      {/* The old switcher's header and menu, kept reachable (a deliberate addition to the frame). */}
      <DsSectionLabel>{t('lightTabs.manage')}</DsSectionLabel>
      <DsRowGroup testID="browser-tabs-manage">
        <DsRow icon="search" title={t('browserTabs.searchPlaceholder')} onPress={toggleSearch} accessibilityLabel={t('browserTabs.searchA11y')} testID="browser-tabs-search-row" />
        <DsRow icon="arrow-up-down" title={t('browserTabs.sortBy')} value={sortLabel(sortOrder, t)} onPress={() => setSortVisible(true)} accessibilityLabel={t('browserTabs.sortA11y', { order: sortLabel(sortOrder, t) })} testID="browser-tabs-sort" />
        <DsRow icon="folder-plus" title={t('browserTabGroups.groupBySite')} onPress={groupTabsBySite} testID="browser-tabs-group-by-site" />
        <DsRow icon="bookmark" title={t('browserBookmarks.bookmarkAllTabs')} onPress={() => void bookmarkAllTabs()} testID="browser-tabs-bookmark-all" />
        {closedGroups.length > 0 ? (
          <DsRow icon="history" title={t('browserTabGroups.closedGroups')} onPress={() => setClosedGroupsVisible(true)} testID="browser-tabs-closed-groups" />
        ) : null}
        <DsRow icon="trash-2" title={t('browserTabs.closeAll')} onPress={requestCloseAll} testID="browser-tabs-close-all" />
      </DsRowGroup>

      {timelineVisible ? <TimelineSheet visible onClose={() => setTimelineVisible(false)} onSelect={handleSelect} /> : null}
      <ClosedGroupsSheet visible={closedGroupsVisible} onClose={() => setClosedGroupsVisible(false)} />
      <ActionSheetModal visible={sortVisible} actions={sortActions} title={t('browserTabs.sortBy')} onClose={() => setSortVisible(false)} testID="browser-tabs-sort-sheet" />
      <CloseTabsDialog request={closeRequest} onCancel={() => setCloseRequest(null)} onConfirm={confirmClose} />
    </DsScreen>
  );
});

type TabTileProps = {
  tab: BrowserTab;
  active: boolean;
  sleeping: boolean;
  /** The group's colour as the tile's edge (null when ungrouped). */
  groupColor: string | null;
  onSelect: (tabId: string) => void;
  onOptions: (tabId: string) => void;
};

/** One tab as the design's tile: its preview (or the picture icon), its title, and a pin / speaker / moon badge. */
const TabTile = memo(function TabTile({ tab, active, sleeping, groupColor, onSelect, onOptions }: TabTileProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const snapshot = useTabSnapshot(tab.id);
  const sound = useTabSound(tab.id);
  const title = tabDisplayTitle(tab, t);
  const site = tabDisplaySite(tab, t);
  const home = isBrowserHomeUrl(tab.url);

  const badge: DsIconName | undefined = tab.pinned ? 'pin' : sound.muted ? 'volume-x' : sound.playing ? 'volume-2' : sleeping ? 'moon' : undefined;
  const label = [
    t('lightTabs.tileA11y', { title, site }),
    tab.pinned ? t('browserTabs.pinned') : null,
    sound.muted ? t('browserTabSound.muted') : sound.playing ? t('browserTabSound.playing') : null,
    sleeping ? t('lightTabs.sleeping') : null,
    active ? t('browser.tabActiveA11y') : null,
  ]
    .filter(Boolean)
    .join('. ');

  const leading =
    snapshot && !home ? (
      <View style={{ width: PREVIEW, height: PREVIEW, borderRadius: PREVIEW_RADIUS, overflow: 'hidden', backgroundColor: theme.colors.background }}>
        <Image
          source={{ uri: snapshot.uri, cacheKey: `${tab.id}-${snapshot.takenAt}` }}
          cachePolicy="memory"
          contentFit="cover"
          contentPosition="top"
          style={{ width: PREVIEW, height: PREVIEW }}
          accessibilityLabel={t('browserTabs.previewA11y', { title })}
        />
      </View>
    ) : (
      <DsIcon name="image" size={ds.size.tileIcon} color="primary" strokeWidth={ds.stroke.tile} />
    );

  return (
    <DsTile
      leading={leading}
      label={title}
      badge={badge}
      selected={active}
      onPress={() => onSelect(tab.id)}
      onLongPress={() => onOptions(tab.id)}
      accessibilityLabel={label}
      accessibilityHint={t('browserTabs.cardHintNoDrag')}
      style={!active && groupColor ? { borderColor: groupColor } : undefined}
      testID={`browser-tab-tile-${tab.id.slice(0, 8)}`}
    />
  );
});
