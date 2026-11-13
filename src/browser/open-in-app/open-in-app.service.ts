import { useSyncExternalStore } from 'react';
import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { useBrowserStore } from '@/browser/stores';
import { useSettingsStore } from '@/store/settings';

import {
  openInAppSite,
  parseNeverSites,
  serializeNeverSites,
  shouldOfferOpenInApp,
  type OpenInAppId,
} from './open-in-app';

/**
 * B22 #273 — the "Open in <app>" chip: once per site per app session, while the setting is on, the app is installed
 * (VidoraWeb, `<queries>` package entries) and the site isn't on the "Don't ask" list. Not offered in incognito tabs
 * (opening an app would hand it the page outside incognito).
 */

export type OpenInAppOffer = { tabId: string; app: OpenInAppId; url: string; site: string } | null;

let offer: OpenInAppOffer = null;
let version = 0;
const listeners = new Set<() => void>();
const shownThisSession = new Set<string>();
const installed = new Map<OpenInAppId, boolean>();

function setOffer(next: OpenInAppOffer): void {
  offer = next;
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useOpenInAppOffer(): OpenInAppOffer {
  useSyncExternalStore(subscribe, () => version, () => version);
  return offer;
}

function isInstalled(app: OpenInAppId): boolean {
  const cached = installed.get(app);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    value = isVidoraWebAvailable() && getVidoraWeb().isAppInstalled?.(app) === true;
  } catch {
    value = false;
  }
  installed.set(app, value);
  return value;
}

function check(): void {
  const state = useBrowserStore.getState();
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (offer && offer.tabId !== state.activeTabId) setOffer(null);
  if (!tab || isIncognitoTabId(tab.id)) return;
  const settings = useSettingsStore.getState();
  const app = shouldOfferOpenInApp({
    url: tab.url,
    enabled: settings.openInAppPrompt !== false,
    neverSites: parseNeverSites(settings.openInAppNever),
    shownThisSession,
    isInstalled,
  });
  const site = openInAppSite(tab.url);
  if (!app || !site) return;
  shownThisSession.add(site);
  setOffer({ tabId: tab.id, app, url: tab.url, site });
}

export function dismissOpenInApp(): void {
  setOffer(null);
}

export async function openOfferInApp(): Promise<void> {
  const current = offer;
  setOffer(null);
  if (!current || !isVidoraWebAvailable()) return;
  await getVidoraWeb().openInApp?.(current.app, current.url).catch(() => false);
}

export function neverAskForOfferSite(): void {
  const current = offer;
  setOffer(null);
  if (!current) return;
  const settings = useSettingsStore.getState();
  const list = parseNeverSites(settings.openInAppNever);
  settings.updateSetting('openInAppNever', serializeNeverSites([...list, current.site]));
}

let stop: (() => void) | null = null;

/** Idempotent; the browser screen starts it. */
export function ensureOpenInApp(): () => void {
  if (stop) return stop;
  const unsubscribe = useBrowserStore.subscribe((next, previous) => {
    if (next.activeTabId !== previous.activeTabId || next.currentUrl !== previous.currentUrl) check();
  });
  stop = () => {
    unsubscribe();
    stop = null;
  };
  return stop;
}
