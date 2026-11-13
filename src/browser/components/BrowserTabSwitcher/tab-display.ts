import { registrableDomain } from '@/browser/address-bar/domain';
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

/**
 * What "Sort by: Site" groups on: the registrable domain (B4), so `en.wikipedia.org`, `ur.m.wikipedia.org` and
 * `wikipedia.org` sort together and `bbc.co.uk` is not `co.uk`. A host the Public Suffix List can't place (an IP,
 * `localhost`) groups on itself.
 */
export function tabSiteKey(url: string): string {
  if (isBrowserHomeUrl(url)) return '';
  const host = extractPageHostname(url).toLowerCase();
  return registrableDomain(host) ?? host.replace(/^(www|m|mobile)\./, '');
}

/** Percent-encoded paths (Urdu Wikipedia titles) as the letters they stand for, for display and search. */
export function readableTabUrl(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}
