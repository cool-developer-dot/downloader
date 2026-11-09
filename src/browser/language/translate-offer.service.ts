import { useSyncExternalStore } from 'react';

import { announceTabsLimitReached } from '@/browser/services/tabs-limit-notice';
import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { buildTranslatePageUrl } from '@/browser/services/translate-page';
import { useBrowserStore } from '@/browser/stores';
import { getActiveLanguage } from '@/localization';
import { useSettingsStore } from '@/store/settings';

import { detectPageLanguage, parseStringList, shouldOfferTranslate } from './language-detect';

/**
 * B23 #263 — "Translate this page?": offered once per site per app session (the sites offered are kept in memory
 * only, so nothing about browsing is stored), never in incognito tabs, never for the app's language, nor for a
 * language or site the user said "Never" to (settings). Translate uses the existing Translate page (translate-page.ts).
 */

export type TranslateOffer = { tabId: string; host: string; language: string; url: string };

const offeredHosts = new Set<string>();
let offer: TranslateOffer | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function useTranslateOffer(): TranslateOffer | null {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => version,
  );
  const active = useBrowserStore((s) => s.activeTabId);
  return offer && offer.tabId === active ? offer : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** The language report of a page (BrowserWebView, on load end of the tab in front). */
export function onPageLanguage(tabId: string | undefined, url: string, report: { lang: string; sample: string }): void {
  if (!tabId) return;
  const settings = useSettingsStore.getState();
  const language = detectPageLanguage(report);
  const host = hostOf(url);
  if (
    !shouldOfferTranslate({
      language,
      appLanguage: getActiveLanguage(),
      host,
      offeredHosts,
      neverLanguages: parseStringList(settings.translateNeverLanguages),
      neverSites: parseStringList(settings.translateNeverSites),
      enabled: settings.offerTranslate !== false,
      incognito: isIncognitoTabId(tabId),
    })
  ) {
    return;
  }
  offeredHosts.add(host);
  offer = { tabId, host, language: language!, url };
  emit();
}

export function dismissTranslateOffer(): void {
  offer = null;
  emit();
}

export function acceptTranslateOffer(): void {
  const current = offer;
  dismissTranslateOffer();
  if (!current) return;
  const url = buildTranslatePageUrl(current.url, getActiveLanguage());
  if (!url) return;
  const result = useBrowserStore.getState().createTab({ url });
  if (result.status === 'LIMIT_REACHED') announceTabsLimitReached();
}

function addTo(key: 'translateNeverLanguages' | 'translateNeverSites', value: string): void {
  const settings = useSettingsStore.getState();
  const list = parseStringList(settings[key]);
  if (!list.includes(value)) settings.updateSetting(key, JSON.stringify([...list, value].slice(-200)));
}

export function neverForLanguage(): void {
  if (offer) addTo('translateNeverLanguages', offer.language);
  dismissTranslateOffer();
}

export function neverForSite(): void {
  if (offer) addTo('translateNeverSites', offer.host);
  dismissTranslateOffer();
}

export function resetTranslateNever(): void {
  const settings = useSettingsStore.getState();
  settings.updateSetting('translateNeverLanguages', '[]');
  settings.updateSetting('translateNeverSites', '[]');
}

/** The language's name in the app's language, from the catalog list ('ur:Urdu|…'). */
export function languageName(code: string, names: string, unknown: string): string {
  for (const pair of names.split('|')) {
    const [c, name] = pair.split(':');
    if (c === code && name) return name;
  }
  return unknown;
}
