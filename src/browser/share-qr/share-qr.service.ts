import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, ToastAndroid } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { getSearchEngine } from '@/browser/search/search-engines';
import { loadUrlActiveTab } from '@/browser/services';
import { translate } from '@/localization';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

import { classifyScan, qrRows, type ScanResult } from './qr-code';

/**
 * B22 #249 / #30 — the QR sheet (this page as a QR code: share as an image, save to the gallery on Android 10+) and
 * scanning (the Google code scanner; a URL asks "Open <host>?" first, other addresses are text only, plain text can be
 * searched or copied).
 */

export type QrSheetState = { url: string; title: string; rows: string[] } | null;
type State = { qr: QrSheetState; scan: ScanResult | null };

let state: State = { qr: null, scan: null };
let version = 0;
const listeners = new Set<() => void>();

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useShareQrState(): State {
  useSyncExternalStore(subscribe, () => version, () => version);
  return state;
}

function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
  AccessibilityInfo.announceForAccessibility(message);
}

function web() {
  return isVidoraWebAvailable() ? getVidoraWeb() : null;
}

/** #249: Menu → QR code. */
export function openQrSheet(url: string, title: string): void {
  const rows = qrRows(url);
  if (!rows) {
    notify(translate('browserShare.qrTooLong'));
    return;
  }
  set({ qr: { url, title, rows } });
}

export function closeQrSheet(): void {
  set({ qr: null });
}

export function canSaveQrToGallery(): boolean {
  try {
    return web()?.canSaveQrToGallery?.() === true;
  } catch {
    return false;
  }
}

export async function shareQrImage(): Promise<void> {
  const qr = state.qr;
  if (!qr) return;
  // The share sheet is a system screen VidoraX opened: App Lock (and incognito's lock) don't relock for it.
  const ok = await withExpectedSystemScreen(async () => {
    const shared = await web()?.shareQrImage?.(qr.rows, qr.title || qr.url).catch(() => false);
    // The native call returns as the sheet opens; the app leaves just after.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return shared;
  });
  if (!ok) notify(translate('browserShare.qrShareFailed'));
}

export async function saveQrImage(): Promise<void> {
  const qr = state.qr;
  if (!qr) return;
  const ok = await web()?.saveQrImage?.(qr.rows, `VidoraX QR ${new Date().toISOString().slice(0, 10)}`).catch(() => false);
  notify(translate(ok ? 'browserShare.qrSaved' : 'browserShare.qrSaveFailed'));
}

/** #30: scan, then decide what the code is. */
export async function scanQrCode(): Promise<void> {
  const api = web();
  const result = api?.scanQrCode
    ? await withExpectedSystemScreen(() => api.scanQrCode!().catch(() => null))
    : null;
  if (!result || result.status === 'unavailable') {
    notify(translate('browserShare.scanUnavailable'));
    return;
  }
  if (result.status !== 'scanned') return;
  const scan = classifyScan(result.text);
  if (scan.kind !== 'empty') set({ scan });
}

export function closeScanResult(): void {
  set({ scan: null });
}

export function openScannedUrl(url: string): void {
  closeScanResult();
  loadUrlActiveTab(url);
}

export function searchScannedText(text: string): void {
  closeScanResult();
  loadUrlActiveTab(getSearchEngine().buildSearchUrl(text.slice(0, 300)));
}

export async function copyScannedText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
  notify(translate('browserShare.copied'));
}
