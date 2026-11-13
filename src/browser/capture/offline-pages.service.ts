import { useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';
import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { loadUrlActiveTab } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { isValidBrowserPageUrl } from '@/browser/utils';
import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';
import { translate } from '@/localization';
import { getActiveProfileId } from '@/storage/profile/active-profile';
import { bookmarkOrganizerRepository } from '@/storage/repositories/bookmark-organizer.repository';
import { savedPagesRepository, type SavedPage } from '@/storage/repositories/saved-pages.repository';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

import { offlineMarker, offlineProfileKey, savedPageIdOf } from './capture-core';
import { allowedForTab, notify } from './capture.service';

/**
 * B17 #178 — Save page offline: a web archive in the app's storage for the active browser profile, listed in "Saved
 * pages" (table `saved_pages`), opened read-only (no JavaScript, no network) in VidoraWeb's viewer, deleted with the
 * row. Never from an incognito tab. B9's reading list gets the copy through its hook `setReadingOfflineCopy`
 * (`vidorax://offline/<id>`), and a reading-list row then opens it here.
 */

let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

export function useSavedPagesVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => version,
  );
}

function web() {
  return isVidoraWebAvailable() ? getVidoraWeb() : null;
}

const profileKey = () => offlineProfileKey(getActiveProfileId());

export async function saveOffline(tabId?: string | null): Promise<void> {
  const state = useBrowserStore.getState();
  const tab = state.tabs.find((t) => t.id === (tabId ?? state.activeTabId));
  if (!tab || !allowedForTab(tab.id) || !isValidBrowserPageUrl(tab.url)) return;
  const tag = getTabWebViewTag(tab.id);
  const api = web();
  if (tag == null || !api?.saveOfflinePage) return notify(translate('browserCapture.saveOfflineFailed'));
  const id = Crypto.randomUUID();
  const size = await api.saveOfflinePage(tag, profileKey(), id).catch(() => 0);
  if (!size) return notify(translate('browserCapture.saveOfflineFailed'));
  try {
    await savedPagesRepository.add({ id, url: tab.url, title: tab.title || tab.url, size, createdAt: new Date().toISOString() });
  } catch {
    api.deleteOfflinePage?.(profileKey(), id);
    return notify(translate('browserCapture.saveOfflineFailed'));
  }
  // B9's reading list: this page's row now opens the offline copy.
  for (const read of [false, true]) {
    const items = await bookmarkOrganizerRepository.listReading(read).catch(() => []);
    for (const item of items) {
      if (item.url === tab.url) await bookmarkOrganizerRepository.setReadingOfflineCopy(item.id, offlineMarker(id)).catch(() => undefined);
    }
  }
  emit();
  notify(translate('browserCapture.savedOffline'));
}

export function listSavedPages(): Promise<SavedPage[]> {
  return savedPagesRepository.list().catch(() => [] as SavedPage[]);
}

export async function openSavedPage(page: SavedPage): Promise<boolean> {
  const api = web();
  if (!api?.openOfflinePage) return false;
  // The viewer is the app's own screen; App Lock doesn't relock while it is open (it closes when the app leaves).
  const ok = await withExpectedSystemScreen(() => api.openOfflinePage!(profileKey(), page.id, page.title).catch(() => false));
  if (!ok) notify(translate('browserCapture.openOfflineFailed'));
  return ok;
}

export async function deleteSavedPage(page: SavedPage): Promise<void> {
  web()?.deleteOfflinePage?.(profileKey(), page.id);
  await savedPagesRepository.remove(page.id).catch(() => false);
  const marker = offlineMarker(page.id);
  for (const read of [false, true]) {
    const items = await bookmarkOrganizerRepository.listReading(read).catch(() => []);
    for (const item of items) if (item.offlineUri === marker) await bookmarkOrganizerRepository.setReadingOfflineCopy(item.id, null).catch(() => undefined);
  }
  emit();
}

/**
 * A reading-list row's address: our offline copy opens in the viewer (falling back to the page online when the copy
 * is gone); anything else goes to `openOnline`.
 */
export async function openReadingListUri(uri: string, openOnline: (url: string) => void): Promise<void> {
  const id = savedPageIdOf(uri);
  if (!id) return openOnline(uri);
  const page = (await listSavedPages()).find((p) => p.id === id);
  if (page && (await openSavedPage(page))) return;
  if (page) openOnline(page.url);
}

export function openSavedPageOnline(page: SavedPage): void {
  loadUrlActiveTab(page.url);
}
