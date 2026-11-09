import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';
import * as Crypto from 'expo-crypto';

import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { useBrowserStore } from '@/browser/stores';
import { isValidBrowserPageUrl } from '@/browser/utils';
import { translate } from '@/localization';
import { annotateRepository, type Highlight } from '@/storage/repositories/annotate.repository';

import {
  pageKey,
  removeHighlightScript,
  restoreHighlightsScript,
  type HighlightAnchor,
  type HighlightColor,
} from './highlights-core';

/**
 * B23 #261 — highlights: the selection menu's Highlight brings the selection's anchor, the sheet picks a
 * colour and an optional note, the highlight is saved in the profile's database and marked on the page. Restored on
 * the next visit (load end). Never saved for, nor restored in, an incognito tab.
 */

export type PendingHighlight = { tabId: string; anchor: HighlightAnchor; url: string; title: string };

let pending: PendingHighlight | null = null;
let pageSheetTabId: string | null = null;
let version = 0;
const listeners = new Set<() => void>();
const injectors = new Map<string, (script: string) => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHighlightsVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

function tabOf(tabId: string | null | undefined) {
  const state = useBrowserStore.getState();
  return state.tabs.find((t) => t.id === (tabId ?? state.activeTabId)) ?? null;
}

/** BrowserWebView: lets highlights run their page scripts in this tab. */
export function bindHighlightsInjector(tabId: string, inject: (script: string) => void): () => void {
  injectors.set(tabId, inject);
  return () => {
    if (injectors.get(tabId) === inject) injectors.delete(tabId);
  };
}

/**
 * Selection menu → Highlight (B8 item 'highlight'), from the tab with this text selected. The anchor came with the
 * selection (B8's read script); a text field's selection has none: the text alone.
 */
export function startHighlight(tabId: string | null | undefined, selectedText: string, anchor?: HighlightAnchor | null): void {
  const tab = tabOf(tabId);
  if (!tab) return;
  if (isIncognitoTabId(tab.id)) {
    notify(translate('browserAnnotate.notSavedIncognito'));
    return;
  }
  if (!isValidBrowserPageUrl(tab.url)) return;
  pending = {
    tabId: tab.id,
    anchor: anchor ?? { exact: selectedText.slice(0, 2000), prefix: '', suffix: '' },
    url: tab.url,
    title: tab.title,
  };
  emit();
}

export function usePendingHighlight(): PendingHighlight | null {
  useHighlightsVersion();
  return pending;
}

export function cancelHighlight(): void {
  pending = null;
  emit();
}

export async function savePendingHighlight(color: HighlightColor, note: string): Promise<void> {
  const p = pending;
  pending = null;
  emit();
  if (!p || isIncognitoTabId(p.tabId)) return;
  const highlight: Highlight = {
    id: Crypto.randomUUID(),
    pageUrl: pageKey(p.url),
    pageTitle: p.title,
    text: p.anchor.exact,
    prefix: p.anchor.prefix,
    suffix: p.anchor.suffix,
    color,
    note: note.trim(),
    createdAt: new Date().toISOString(),
  };
  try {
    await annotateRepository.addHighlight(highlight);
    notify(translate('browserAnnotate.saved'));
    injectors.get(p.tabId)?.(restoreHighlightsScript([{ ...highlight, exact: highlight.text }]));
    emit();
  } catch {
    // The database refused: nothing was saved.
  }
}

/** Load end of a page in a tab: its highlights are marked again (never in incognito). */
export async function restoreHighlights(tabId: string, url: string): Promise<void> {
  if (isIncognitoTabId(tabId) || !isValidBrowserPageUrl(url)) return;
  const inject = injectors.get(tabId);
  if (!inject) return;
  const list = await annotateRepository.highlightsForPage(pageKey(url)).catch(() => [] as Highlight[]);
  if (!list.length) return;
  inject(restoreHighlightsScript(list.map((h) => ({ ...h, exact: h.text }))));
}

let restoredReport: { tabId: string; found: number; of: number } | null = null;

/** The page's count after restoring: kept for the "Highlights on this page" sheet. */
export function onRestored(tabId: string | undefined, found: number, of: number): void {
  if (!tabId) return;
  restoredReport = { tabId, found, of };
  emit();
}

export function restoredFor(tabId: string | null): { found: number; of: number } | null {
  return restoredReport && restoredReport.tabId === tabId ? restoredReport : null;
}

export function listPageHighlights(url: string): Promise<Highlight[]> {
  return annotateRepository.highlightsForPage(pageKey(url)).catch(() => [] as Highlight[]);
}

export function listAllHighlights(): Promise<Highlight[]> {
  return annotateRepository.allHighlights().catch(() => [] as Highlight[]);
}

export async function deleteHighlight(h: Highlight): Promise<void> {
  await annotateRepository.deleteHighlight(h.id).catch(() => false);
  // Off any open tab showing that page.
  for (const tab of useBrowserStore.getState().tabs) {
    if (pageKey(tab.url) === h.pageUrl) injectors.get(tab.id)?.(removeHighlightScript(h.id));
  }
  emit();
}

export function openPageHighlights(tabId: string | null): void {
  pageSheetTabId = tabId;
  emit();
}

export function closePageHighlights(): void {
  pageSheetTabId = null;
  emit();
}

export function usePageHighlightsTab(): string | null {
  useHighlightsVersion();
  return pageSheetTabId;
}
