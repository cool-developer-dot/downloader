/**
 * B20 #16 Move tab to new window: the tab's page opens in a window of its own (VidoraWeb's BrowserWindowActivity,
 * a separate task that can sit next to the app in split screen), in the tab's profile, and the tab leaves the main
 * window. What happens in the window comes back here:
 *
 * - each page it finishes is recorded in history, like a tab's;
 * - closing it keeps the page for Reopen closed tab;
 * - "Move to main window" (or App Lock closing it when the user leaves) opens the page in a tab again;
 * - links and downloads it doesn't handle open in a new tab, where every browser rule applies.
 *
 * Everything is for the profile the window belongs to: an event for another profile than the active one waits until
 * that profile is active again (or, for "Move to main window", switches to it).
 */
import { getVidoraWeb, isVidoraWebAvailable, type BrowserWindowEvent } from '@modules/vidorax-web';

import { buildBrowserUserAgent } from '@/browser/constants/user-agent';
import { recordSuccessfulVisit } from '@/browser/services/history-recording.service';
import { useBrowserStore } from '@/browser/stores';
import { closedTabsService } from '@/browser/tabs/closed-tabs.service';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';
import { shouldPersistForTab } from '@/browser/tabs/tab-privacy';
import type { BrowserTab } from '@/browser/tabs/types';
import { isBrowserHomeUrl } from '@/browser/utils';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';
import {
  getActiveProfileId,
  GUEST_PROFILE_ID,
  subscribeActiveProfile,
  webProfileName,
} from '@/storage/profile/active-profile';

import { switchProfile, useProfilesStore } from './profile-service';

export type BrowserWindowAppearance = {
  rtl: boolean;
  dark: boolean;
  colors: { background: string; surface: string; text: string; textSecondary: string; accent: string };
  labels: { back: string; forward: string; reload: string; stop: string; moveBack: string; close: string };
};

function isWebPage(url: string): boolean {
  return /^https?:\/\//i.test(url.trim()) && !isBrowserHomeUrl(url);
}

export function isBrowserWindowAvailable(): boolean {
  if (!isVidoraWebAvailable()) return false;
  return typeof getVidoraWeb().openBrowserWindow === 'function';
}

/** A tab can move to a window when it shows a web page and may be kept (not a private tab). */
export function canMoveTabToWindow(tab: Pick<BrowserTab, 'id' | 'url'> | null | undefined): boolean {
  return tab != null && isWebPage(tab.url) && shouldPersistForTab(tab) && isBrowserWindowAvailable();
}

export type MoveTabOutcome = 'moved' | 'unavailable' | 'failed';

export async function moveTabToWindow(tabId: string, appearance: BrowserWindowAppearance): Promise<MoveTabOutcome> {
  const tab = useBrowserStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab || !canMoveTabToWindow(tab)) return 'unavailable';
  let opened = false;
  try {
    opened =
      (await getVidoraWeb().openBrowserWindow?.({
        windowId: tab.id,
        url: tab.url,
        title: tab.title ?? '',
        profile: webProfileName(getActiveProfileId()),
        userAgent: tab.desktopMode ? buildBrowserUserAgent({ desktop: true }) : null,
        lockOnLeave: useAppLockStore.getState().isEnabled,
        rtl: appearance.rtl,
        dark: appearance.dark,
        colors: appearance.colors,
        labels: appearance.labels,
      })) === true;
  } catch {
    opened = false;
  }
  if (!opened) return 'failed';
  // The page lives on in the window; closing the window is what puts it in Reopen closed tab.
  useBrowserStore.getState().closeTab(tab.id, { record: false });
  return 'moved';
}

/** Events for a profile that isn't active, kept (in memory) until it is. */
const waiting = new Map<string, BrowserWindowEvent[]>();

function openTab(url: string, title: string, foreground: boolean): void {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return;
  const store = useBrowserStore.getState();
  const active = store.tabs.find((t) => t.id === store.activeTabId);
  const controller = active && isBrowserHomeUrl(active.url) ? tabControllerRegistry.get(active.id) : null;
  if (foreground && controller && /^https?:\/\//i.test(url)) {
    // The start page the move left behind (or any empty tab in front) takes the page back instead of a second tab.
    controller.loadUrl(url);
  } else if (foreground) {
    store.createTab({ url, title });
  } else {
    store.openTabInBackground(url, { title });
  }
}

function apply(event: BrowserWindowEvent): void {
  switch (event.type) {
    case 'visit':
      void recordSuccessfulVisit({ url: event.url, title: event.title });
      return;
    case 'closed':
      if (!isWebPage(event.url)) return;
      closedTabsService.record([
        {
          id: event.windowId,
          url: event.url,
          title: event.title,
          index: useBrowserStore.getState().tabs.length,
          pinned: false,
          desktopMode: false,
          desktopModeSource: 'default',
          createdAt: Date.now(),
          closedAt: Date.now(),
          batchId: `window-${event.windowId}`,
          persist: true,
        },
      ]);
      return;
    case 'returned':
      if (isWebPage(event.url)) openTab(event.url, event.title, event.foreground);
      return;
    case 'openInApp':
      openTab(event.url, '', true);
      return;
  }
}

/** The browser profile a window's WebView profile belongs to; null for one that no longer exists. */
function profileIdOf(webProfile: string): string | null {
  const ids = [GUEST_PROFILE_ID, ...useProfilesStore.getState().profiles.map((p) => p.id)];
  return ids.find((id) => webProfileName(id) === webProfile) ?? null;
}

export function handleBrowserWindowEvent(event: BrowserWindowEvent): void {
  const profileId = profileIdOf(event.profile);
  // A profile deleted (or a guest session ended) since the window opened: nothing of it may come back.
  if (!profileId) return;
  if (profileId === getActiveProfileId()) {
    apply(event);
    return;
  }
  if ((event.type === 'returned' && event.foreground) || event.type === 'openInApp') {
    // The user asked for this page in the main window: go to its profile, then open it there.
    void switchProfile(profileId).then((outcome) => {
      if (outcome === 'switched' || outcome === 'same') apply(event);
    });
    return;
  }
  const list = waiting.get(profileId) ?? [];
  list.push(event);
  waiting.set(profileId, list.slice(-20));
}

let attached = false;

/** Idempotent; app start. */
export function ensureBrowserWindowEvents(): void {
  if (attached || !isVidoraWebAvailable()) return;
  attached = true;
  try {
    getVidoraWeb().addListener('onBrowserWindow', handleBrowserWindowEvent);
  } catch {
    // Older native build: no windows to hear from.
  }
  subscribeActiveProfile(() => {
    const id = getActiveProfileId();
    const list = waiting.get(id);
    if (!list) return;
    waiting.delete(id);
    // After the profile's tabs are in place.
    setTimeout(() => list.forEach(apply), 0);
  });
}
