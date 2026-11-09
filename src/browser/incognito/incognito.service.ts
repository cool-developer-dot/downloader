import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState, Platform, ToastAndroid, type NativeEventSubscription } from 'react-native';
import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import { deleteIncognitoWebProfile, sweepOrphanWebProfiles } from '@/browser/profiles/profile-service';
import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { useBrowserStore } from '@/browser/stores';
import { isBrowserRouteVisible, subscribeBrowserRouteVisible } from '@/browser/webview/webview-activity';
import { translate } from '@/localization';
import { useAppLockStore } from '@/security/app-lock/app-lock.store';

import {
  bindIncognitoDownloadNotifier,
  bindIncognitoEnder,
  isIncognitoTabId,
  liveIncognitoProfile,
  newIncognitoProfileName,
  setIncognitoInFront,
  setLiveIncognitoProfile,
} from './incognito-state';

/**
 * B11 Incognito (Faran's rules) — the session's runtime:
 *
 * - **Profile:** the first incognito tab starts a session with a new temporary WebView profile
 *   (`vidorax-incog<session>`): VidoraWeb creates it (never active — `setActive` is global) and vidorax-media gets its
 *   cookie jar for downloads from incognito tabs. An incognito tab's WebView mounts with the `webProfile` prop and joins
 *   it in beforeWebViewSetup. **Fail closed:** the tab shows nothing but a blank page until VidoraWeb confirms its
 *   WebView is in the session's profile (`getWebViewProfileName`); otherwise the tab is closed and incognito is refused.
 *   Without WebView profiles there is no incognito (never RN WebView's `incognito` prop).
 * - **Wipe (#109):** when the last incognito tab closes (or a profile switch / guest mode replaces the tabs) the
 *   session ends: no jar for downloads, then the profile is deleted once its WebViews are gone
 *   (`deleteIncognitoWebProfile`) — its cookies, storage, cache and service workers with it. Tabs are never saved, so a
 *   killed app restores none; the leftover profile goes at the next sweep (the next session's start, or Profiles).
 * - **#106:** FLAG_SECURE while an incognito tab is on screen (in front, or listed in the open tab switcher), the
 *   browser shown and the app in front.
 * - **#105:** App Lock (PIN or fingerprint) when coming back to an incognito tab after the app was left — at once, no
 *   grace period. Without App Lock set up there is nothing to ask.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
const verified = new Set<string>();
let sweptThisRun = false;
let starting: Promise<string | null> | null = null;
let switcherOpen = false;
let needsUnlock = false;
let lastSecure: boolean | null = null;
// An incognito tab is being opened: the session exists before its first tab, so it must not end in between.
let opening = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function web() {
  return isVidoraWebAvailable() ? getVidoraWeb() : null;
}

function media() {
  return isVidoraMediaAvailable() ? getVidoraMedia() : null;
}

function announce(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.LONG);
  AccessibilityInfo.announceForAccessibility(message);
}

/** #104: incognito needs WebView profiles (its own cookies, storage and cache). */
export function isIncognitoAvailable(): boolean {
  return web()?.isIncognitoSupported?.() === true;
}

async function startSession(): Promise<string | null> {
  const live = liveIncognitoProfile();
  if (live) return live;
  if (!starting) {
    starting = (async () => {
      const api = web();
      if (!api?.isIncognitoSupported?.() || !api.startIncognitoProfile) return null;
      const name = newIncognitoProfileName();
      const ok = await api.startIncognitoProfile(name).catch(() => false);
      if (!ok) return null;
      await media()
        ?.setIncognitoCookieProfile?.(name)
        .catch(() => false);
      setLiveIncognitoProfile(name);
      if (!sweptThisRun) {
        // WebView is loaded now: earlier sessions' leftovers (the app was killed) go; the live name is never touched.
        sweptThisRun = true;
        setTimeout(() => void sweepOrphanWebProfiles().catch(() => undefined), 2000);
      }
      emit();
      return name;
    })().finally(() => {
      starting = null;
    });
  }
  return starting;
}

export type OpenIncognitoOutcome = 'opened' | 'unavailable' | 'limit';

/** #104 / #52: a new incognito tab in front, on the start page or `url`. */
export async function openIncognitoTab(url?: string): Promise<OpenIncognitoOutcome> {
  opening += 1;
  try {
    return await openIncognitoTabNow(url);
  } finally {
    opening -= 1;
  }
}

async function openIncognitoTabNow(url?: string): Promise<OpenIncognitoOutcome> {
  const name = await startSession();
  if (!name) {
    announce(translate('browserIncognito.unavailable'));
    return 'unavailable';
  }
  const result = useBrowserStore.getState().createTab({ ...(url ? { url } : {}), incognito: true });
  if (result.status === 'LIMIT_REACHED') {
    announceTabsLimitReached();
    if (!hasIncognitoTabs()) await endSession(name);
    return 'limit';
  }
  if (result.status !== 'CREATED') {
    if (!hasIncognitoTabs()) await endSession(name);
    return 'unavailable';
  }
  return 'opened';
}

function hasIncognitoTabs(): boolean {
  return useBrowserStore.getState().tabs.some((tab) => isIncognitoTabId(tab.id));
}

/**
 * BrowserWebView, once an incognito tab's WebView exists: true when it is in the session's profile (then its page may
 * load). Anything else closes the tab and refuses incognito.
 */
export async function verifyIncognitoWebView(tabId: string, viewTag: number): Promise<boolean> {
  if (verified.has(tabId)) return true;
  const live = liveIncognitoProfile();
  const name = live
    ? await web()
        ?.getWebViewProfileName?.(viewTag)
        .catch(() => null)
    : null;
  if (live && name === live && liveIncognitoProfile() === live) {
    verified.add(tabId);
    emit();
    return true;
  }
  if (name == null && live) return false; // The view went away (or isn't there yet): a later bind asks again.
  useBrowserStore.getState().closeTab(tabId, { record: false });
  announce(translate('browserIncognito.unavailable'));
  return false;
}

/** Whether an incognito tab's WebView was confirmed in the session's profile (always true for a normal tab). */
export function useIncognitoVerified(tabId: string | undefined): boolean {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return !tabId || !isIncognitoTabId(tabId) || verified.has(tabId);
}

/** Ends the session: no more jar for downloads, then the profile goes once its WebViews have unmounted. */
async function endSession(name: string): Promise<void> {
  if (liveIncognitoProfile() !== name) return;
  setLiveIncognitoProfile(null);
  verified.clear();
  emit();
  await media()
    ?.setIncognitoCookieProfile?.(null)
    .catch(() => false);
  await web()
    ?.endIncognitoProfile?.(name)
    .catch(() => false);
  void deleteIncognitoWebProfile(name).catch(() => false);
}

/** Closes every incognito tab and ends the session (a profile switch, guest mode). */
export async function closeAllIncognitoTabs(): Promise<void> {
  const store = useBrowserStore.getState();
  for (const tab of store.tabs.filter((t) => isIncognitoTabId(t.id))) {
    useBrowserStore.getState().closeTab(tab.id, { record: false });
  }
  const live = liveIncognitoProfile();
  if (live) await endSession(live);
}

/** BrowserScreen: the tab switcher (which lists incognito tabs) opened or closed. */
export function setTabSwitcherOpen(open: boolean): void {
  switcherOpen = open;
  applySecure();
}

function applySecure(): void {
  const state = useBrowserStore.getState();
  const inFront = isIncognitoTabId(state.activeTabId);
  const secure =
    AppState.currentState === 'active' &&
    isBrowserRouteVisible() &&
    (inFront || (switcherOpen && state.tabs.some((tab) => isIncognitoTabId(tab.id))));
  if (secure === lastSecure) return;
  lastSecure = secure;
  void web()
    ?.setWindowSecure?.(secure)
    .catch(() => false);
}

function lockIfReturning(): void {
  if (!needsUnlock || !isIncognitoTabId(useBrowserStore.getState().activeTabId)) return;
  needsUnlock = false;
  useAppLockStore.getState().lock();
}

/** #107: the download stays in the library after incognito closes. */
export function announceIncognitoDownload(): void {
  announce(translate('browserIncognito.downloadNotice'));
}

let stop: (() => void) | null = null;

/** Idempotent; the browser screen starts it. */
export function ensureIncognito(): () => void {
  if (stop) return stop;
  bindIncognitoEnder(closeAllIncognitoTabs);
  bindIncognitoDownloadNotifier(announceIncognitoDownload);
  const syncFront = () => setIncognitoInFront(isIncognitoTabId(useBrowserStore.getState().activeTabId));
  syncFront();
  const unsubscribeTabs = useBrowserStore.subscribe((next, previous) => {
    if (next.activeTabId !== previous.activeTabId || next.tabs !== previous.tabs) {
      syncFront();
      applySecure();
      if (next.activeTabId !== previous.activeTabId) lockIfReturning();
      const live = liveIncognitoProfile();
      if (live && opening === 0 && !next.tabs.some((tab) => isIncognitoTabId(tab.id))) void endSession(live);
    }
  });
  const unsubscribeRoute = subscribeBrowserRouteVisible(applySecure);
  const appState: NativeEventSubscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active' && hasIncognitoTabs()) needsUnlock = true;
    applySecure();
    if (state === 'active') lockIfReturning();
  });
  const downloads = web()?.addListener?.('onIncognitoDownload', (event) => {
    if (event.started) announceIncognitoDownload();
  });
  applySecure();
  stop = () => {
    unsubscribeTabs();
    unsubscribeRoute();
    appState.remove();
    downloads?.remove();
    bindIncognitoEnder(null);
    bindIncognitoDownloadNotifier(null);
    stop = null;
  };
  return stop;
}
