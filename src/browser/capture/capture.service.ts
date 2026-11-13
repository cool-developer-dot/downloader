import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { useBrowserStore } from '@/browser/stores';
import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';
import { translate } from '@/localization';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

/**
 * B17 #174 / #175 / #176 / #177 — the page as a picture (the visible part through B1's `snapshotWebView`, or the whole
 * page through VidoraWeb's stitched capture), saved to Pictures/VidoraX (MediaStore, Android 10+, no permission) or
 * shared — both through B23's `exportDrawing` with no strokes; and Android's print dialog (a printer, or Save as
 * PDF). Never from an incognito tab (no copies out of incognito).
 */

export type Capture = { uri: string; width: number; height: number; kind: 'screenshot' | 'fullPage' };

let pending: Capture | null = null;
let busy = false;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

export function useCapture(): { capture: Capture | null; busy: boolean } {
  'use no memo'; // Reads external state each render (subscribed above): compiled, the React Compiler cached the first read.
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => version,
  );
  return { capture: pending, busy };
}

export function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.LONG);
  AccessibilityInfo.announceForAccessibility(message);
}

function web() {
  return isVidoraWebAvailable() ? getVidoraWeb() : null;
}

function tabOf(tabId?: string | null) {
  const state = useBrowserStore.getState();
  return state.tabs.find((t) => t.id === (tabId ?? state.activeTabId)) ?? null;
}

/** False (with the notice) for an incognito tab. */
export function allowedForTab(tabId: string): boolean {
  if (!isIncognitoTabId(tabId)) return true;
  notify(translate('browserCapture.notInIncognito'));
  return false;
}

function drawingsDir(): Directory {
  const dir = new Directory(Paths.cache, 'drawings');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** #174: the visible page. */
export async function captureScreenshot(tabId?: string | null): Promise<void> {
  const tab = tabOf(tabId);
  if (!tab || !allowedForTab(tab.id)) return;
  const tag = getTabWebViewTag(tab.id);
  const api = web();
  if (tag == null || !api?.snapshotWebView || !api.exportDrawing) return notify(translate('browserCapture.captureFailed'));
  const shot = await api.snapshotWebView(tag, 1440, 'vidorax-capture').catch(() => null);
  if (!shot || shot.width <= 0) return notify(translate('browserCapture.captureFailed'));
  try {
    const dir = drawingsDir();
    for (const entry of dir.list()) if (entry instanceof File && entry.name.startsWith('shot-')) entry.delete();
    const copy = new File(dir, `shot-${Date.now()}.jpg`);
    new File(shot.uri).copy(copy);
    pending = { uri: copy.uri, width: shot.width, height: shot.height, kind: 'screenshot' };
    emit();
  } catch {
    notify(translate('browserCapture.captureFailed'));
  }
}

/** #175: the whole page (stitched); too long → a clear message; a page scrolling inside itself → only the visible part. */
export async function captureFullPage(tabId?: string | null): Promise<void> {
  const tab = tabOf(tabId);
  if (!tab || !allowedForTab(tab.id) || busy) return;
  const tag = getTabWebViewTag(tab.id);
  const api = web();
  if (tag == null || !api?.captureFullPage) return notify(translate('browserCapture.captureFailed'));
  busy = true;
  emit();
  notify(translate('browserCapture.capturing'));
  const result = await api.captureFullPage(tag, 720).catch(() => ({ status: 'failed' as const }));
  busy = false;
  if (result.status === 'tooLong') notify(translate('browserCapture.tooLong'));
  else if ((result.status === 'ok' || result.status === 'single') && result.uri) {
    if (result.status === 'single') notify(translate('browserCapture.onlyVisible'));
    pending = { uri: result.uri, width: result.width ?? 0, height: result.height ?? 0, kind: 'fullPage' };
  } else notify(translate('browserCapture.captureFailed'));
  emit();
}

export function closeCapture(): void {
  pending = null;
  emit();
}

export function canSaveToPictures(): boolean {
  return web()?.canSaveQrToGallery?.() === true;
}

export async function exportCapture(mode: 'save' | 'share'): Promise<void> {
  const capture = pending;
  const api = web();
  if (!capture || !api?.exportDrawing) return;
  const name = `VidoraX ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
  if (mode === 'save') {
    const ok = await api.exportDrawing(capture.uri, '[]', 'save', name).catch(() => false);
    notify(translate(ok ? 'browserCapture.savedToPictures' : 'browserCapture.saveFailed'));
    return;
  }
  // The share sheet is a system screen of this action: App Lock doesn't relock for it.
  const ok = await withExpectedSystemScreen(async () => {
    const shared = await api.exportDrawing!(capture.uri, '[]', 'share', name).catch(() => false);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return shared;
  });
  if (!ok) notify(translate('browserCapture.shareFailed'));
}

/** #176 / #177: Android's print dialog (printers and Save as PDF). */
export async function printPage(tabId?: string | null): Promise<void> {
  const tab = tabOf(tabId);
  if (!tab || !allowedForTab(tab.id)) return;
  const tag = getTabWebViewTag(tab.id);
  const api = web();
  if (tag == null || !api?.printPage) return notify(translate('browserCapture.printFailed'));
  const ok = await withExpectedSystemScreen(async () => {
    const opened = await api.printPage!(tag, tab.title, tab.url).catch(() => false);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return opened;
  });
  if (!ok) notify(translate('browserCapture.printFailed'));
}
