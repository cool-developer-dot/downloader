import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';
import * as Crypto from 'expo-crypto';

import { isBrowserHomeUrl } from '@/browser/utils';
import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { translate } from '@/localization';
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { profileScopedKey, subscribeActiveProfile } from '@/storage/profile/active-profile';
import { useSettingsStore } from '@/store/settings';

import { MAX_OPEN_TABS } from './constants';
import {
  addToGroup,
  closedGroupsFromSave,
  createGroup,
  groupBySite as groupBySitePlan,
  nextColor,
  pruneTabs,
  pushClosedGroup,
  removeFromGroup,
  restorePlan,
  tabIdsOf,
  ungroup,
  updateGroup,
  type ClosedGroup,
  type GroupColor,
  type GroupsState,
} from './tab-groups';
import { getGroupsState, groupsVersion, setGroupsState, subscribeGroups } from './tab-groups-state';
import { persistTabEngineState } from './tab-persistence.service';

/**
 * B2 — tab groups over B1's tab list: create (from a tab's menu), rename and recolour, collapse, move tabs in and out,
 * close (each tab through the store's own close, so closed tabs and B11's incognito session end work as before),
 * group by site, and the optional "new tabs from a page join its group". Saved with the tabs (schema 3) — never
 * incognito groups. The last 10 closed groups (normal only) are kept per profile.
 */

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

export function useTabGroups(): GroupsState {
  useSyncExternalStore(subscribeGroups, groupsVersion, groupsVersion);
  return getGroupsState();
}

function commit(next: GroupsState): void {
  if (next === getGroupsState()) return;
  setGroupsState(next);
  const { tabs, activeTabId } = useBrowserStore.getState();
  persistTabEngineState({ tabs, activeTabId });
}

const orderedIds = () => useBrowserStore.getState().tabs.map((t) => t.id);

export function newGroupWith(tabId: string, name = ''): string {
  const id = Crypto.randomUUID();
  const state = getGroupsState();
  commit(createGroup(state, { id, name, color: nextColor(state), tabIds: [tabId], incognito: isIncognitoTabId(tabId) }, isIncognitoTabId));
  return id;
}

export function moveTabToGroup(tabId: string, groupId: string): void {
  commit(addToGroup(getGroupsState(), tabId, groupId, isIncognitoTabId));
}

export function takeTabOutOfGroup(tabId: string): void {
  commit(removeFromGroup(getGroupsState(), tabId));
}

export function editGroup(groupId: string, patch: { name?: string; color?: GroupColor }): void {
  commit(updateGroup(getGroupsState(), groupId, patch));
}

export function toggleGroupCollapsed(groupId: string): void {
  const group = getGroupsState().groups.find((g) => g.id === groupId);
  if (group) commit(updateGroup(getGroupsState(), groupId, { collapsed: !group.collapsed }));
}

export function ungroupTabs(groupId: string): void {
  commit(ungroup(getGroupsState(), groupId));
}

/** #258: every site with two or more ungrouped tabs becomes a group (normal tabs only). */
export function groupTabsBySite(): void {
  const tabs = useBrowserStore.getState().tabs.map((t) => ({ id: t.id, url: t.url, incognito: isIncognitoTabId(t.id) }));
  commit(groupBySitePlan(getGroupsState(), tabs, () => Crypto.randomUUID()));
}

// ---- #288 group history ----

let closedGroups: ClosedGroup[] = [];
let closedVersion = 0;
const closedListeners = new Set<() => void>();

const historyKey = () => profileScopedKey(mmkvKeys.browserClosedGroups);

function loadClosedGroups(): void {
  closedGroups = closedGroupsFromSave(mmkvGetObject<unknown>(historyKey()));
  closedVersion += 1;
  for (const l of closedListeners) l();
}

function saveClosedGroups(next: ClosedGroup[]): void {
  closedGroups = next;
  mmkvSetObject(historyKey(), next);
  closedVersion += 1;
  for (const l of closedListeners) l();
}

export function useClosedGroups(): ClosedGroup[] {
  useSyncExternalStore(
    (l) => {
      closedListeners.add(l);
      return () => closedListeners.delete(l);
    },
    () => closedVersion,
    () => closedVersion,
  );
  return closedGroups;
}

/** Closes the group's tabs; a normal group goes to group history first (an incognito one never does). */
export function closeGroup(groupId: string): void {
  const state = getGroupsState();
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;
  const store = useBrowserStore.getState();
  const ids = tabIdsOf(state, groupId, orderedIds());
  if (!group.incognito) {
    const tabs = ids
      .map((id) => store.tabs.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => t != null && !isBrowserHomeUrl(t.url))
      .map((t) => ({ url: t.url, title: t.title }));
    saveClosedGroups(pushClosedGroup(closedGroups, { id: group.id, name: group.name, color: group.color, tabs, closedAt: Date.now() }));
  }
  for (const id of ids) useBrowserStore.getState().closeTab(id);
}

/** Opens what fits at the tab limit as a group again, and says when some didn't fit. */
export function restoreClosedGroup(groupId: string): void {
  const entry = closedGroups.find((g) => g.id === groupId);
  if (!entry) return;
  const plan = restorePlan(entry, useBrowserStore.getState().tabs.length, MAX_OPEN_TABS);
  if (!plan.open.length) {
    announceTabsLimitReached();
    return;
  }
  const created: string[] = [];
  for (const tab of plan.open) {
    const outcome = useBrowserStore.getState().openTabInBackground(tab.url, { title: tab.title });
    if (outcome.status !== 'CREATED') break;
    created.push(outcome.tabId);
  }
  if (created.length) {
    const state = getGroupsState();
    commit(createGroup(state, { id: Crypto.randomUUID(), name: entry.name, color: entry.color, tabIds: created, incognito: false }, () => false));
  }
  saveClosedGroups(closedGroups.filter((g) => g.id !== groupId));
  const skipped = entry.tabs.length - created.length;
  if (skipped > 0) notify(translate('browserTabGroups.restoredSome', { restored: created.length, total: entry.tabs.length }));
}

// ---- keeping groups in step with the tab list ----

let stop: (() => void) | null = null;

/** Idempotent; the browser screen starts it. */
export function ensureTabGroups(): () => void {
  if (stop) return stop;
  loadClosedGroups();
  let previous = useBrowserStore.getState();
  const unsubscribeStore = useBrowserStore.subscribe((next) => {
    const before = previous;
    previous = next;
    if (next.tabs === before.tabs) return;
    const open = new Set(next.tabs.map((t) => t.id));
    let state = pruneTabs(getGroupsState(), open);
    // #258 option: a page's new tab (a link, not a new start page) joins the page's group — same kind only.
    if (useSettingsStore.getState().groupTabsFromOpener === true) {
      const known = new Set(before.tabs.map((t) => t.id));
      const openerGroup = state.membership[before.activeTabId];
      if (openerGroup) {
        for (const tab of next.tabs) {
          if (known.has(tab.id) || isBrowserHomeUrl(tab.url)) continue;
          state = addToGroup(state, tab.id, openerGroup, isIncognitoTabId);
        }
      }
    }
    if (state !== getGroupsState()) commit(state);
  });
  const unsubscribeProfile = subscribeActiveProfile(() => loadClosedGroups());
  stop = () => {
    unsubscribeStore();
    unsubscribeProfile();
    stop = null;
  };
  return stop;
}
