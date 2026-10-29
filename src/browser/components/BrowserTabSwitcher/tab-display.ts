import type { BrowserTab } from '@/browser/tabs/types';
import { extractPageHostname, formatDisplayUrl, isBrowserHomeUrl } from '@/browser/utils';
import type { TranslateFn } from '@/localization';

export function tabDisplayTitle(tab: BrowserTab, t: TranslateFn): string {
  if (isBrowserHomeUrl(tab.url)) {
    return t('browserTabs.startPage');
  }
  if (tab.title?.trim()) {
    return tab.title.trim();
  }
  return extractPageHostname(tab.url) || t('browserTabs.untitled');
}

export function tabDisplaySite(tab: BrowserTab, t: TranslateFn): string {
  if (isBrowserHomeUrl(tab.url)) {
    return t('browserTabs.startPage');
  }
  return extractPageHostname(tab.url) || formatDisplayUrl(tab.url) || tab.url;
}

/** What "Sort by: Site" groups on, until B4's registrable-domain helper: the host without `www.` / `m.`. */
export function tabSiteKey(url: string): string {
  if (isBrowserHomeUrl(url)) return '';
  const host = extractPageHostname(url).toLowerCase();
  return host.replace(/^(www|m|mobile)\./, '');
}

/** Percent-encoded paths (Urdu Wikipedia titles) as the letters they stand for, for display and search. */
export function readableTabUrl(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}
