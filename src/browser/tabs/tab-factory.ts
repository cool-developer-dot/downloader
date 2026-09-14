import { BROWSER_HOMEPAGE } from '@/browser/constants';
import { browserPreferencesService } from '@/browser/services/browser-preferences.service';
import { stripSensitiveAuthQueryParams } from '@/browser/session/session-url-sanitizer';
import { isBrowserHomeUrl } from '@/browser/utils';

import { createTabId } from './tab-id';
import type { BrowserTab, DesktopModeSource, PersistedTabMetadata } from './types';

export function readNewTabDesktopDefault(): {
  desktopMode: boolean;
  desktopModeSource: DesktopModeSource;
} {
  const explicit = browserPreferencesService.readDesktopModeUserExplicit();
  const preference = browserPreferencesService.readDesktopMode();
  if (explicit) {
    return { desktopMode: preference, desktopModeSource: 'user' };
  }
  return { desktopMode: preference, desktopModeSource: preference ? 'user' : 'default' };
}

export function homeTabTitle(): string {
  return 'Home';
}

export function createHomeTab(overrides?: Partial<BrowserTab>): BrowserTab {
  const now = Date.now();
  const desktop = readNewTabDesktopDefault();
  return {
    id: createTabId(),
    url: BROWSER_HOMEPAGE,
    title: homeTabTitle(),
    createdAt: now,
    lastActiveAt: now,
    desktopMode: desktop.desktopMode,
    desktopModeSource: desktop.desktopModeSource,
    loading: false,
    progress: 0,
    canGoBack: false,
    canGoForward: false,
    error: null,
    navigationEpoch: 0,
    mountState: 'EVICTED',
    lastMountedAt: null,
    ...overrides,
  };
}

export function createTabFromPersisted(meta: PersistedTabMetadata): BrowserTab {
  return {
    id: meta.id,
    url: meta.url,
    title: meta.title || (isBrowserHomeUrl(meta.url) ? homeTabTitle() : ''),
    createdAt: meta.createdAt,
    lastActiveAt: meta.lastActiveAt,
    desktopMode: Boolean(meta.desktopMode),
    desktopModeSource: meta.desktopModeSource ?? 'default',
    loading: false,
    progress: 0,
    canGoBack: false,
    canGoForward: false,
    error: null,
    navigationEpoch: 0,
    mountState: 'EVICTED',
    lastMountedAt: null,
  };
}

export function toPersistedTabMetadata(tab: BrowserTab): PersistedTabMetadata {
  const url = isBrowserHomeUrl(tab.url)
    ? tab.url
    : stripSensitiveAuthQueryParams(tab.url);
  return {
    id: tab.id,
    url,
    title: tab.title,
    createdAt: tab.createdAt,
    lastActiveAt: tab.lastActiveAt,
    desktopMode: tab.desktopMode,
    desktopModeSource: tab.desktopModeSource,
  };
}
