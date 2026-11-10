import { useSyncExternalStore } from 'react';
import { Directory, Paths } from 'expo-file-system';
import { getVidoraWeb, isVidoraWebAvailable, type WebDownloadEvent } from '@modules/vidorax-web';

import { translate } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';
import { useSettingsStore } from '@/store/settings';

import { isPdfChoice, pdfFailureKey, type PdfChoice } from './capture-core';
import { notify } from './capture.service';

/**
 * B17 #264 / #265 — a PDF link (VidoraWeb sends the WebView's PDF downloads with hint `pdf` while this is on): Open in
 * VidoraX (fetched with the tab's own cookies — incognito included — into the cache, the in-app viewer), Download (the
 * existing system-download path, unchanged), or Open with another app; "Remember my choice" stores it
 * (`pdfOpenChoice`, default 'ask').
 */

type Pending = { event: WebDownloadEvent; download: () => Promise<void> };

let pending: Pending | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

export function usePdfChoice(): WebDownloadEvent | null {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => version,
  );
  return pending?.event ?? null;
}

function web() {
  return isVidoraWebAvailable() ? getVidoraWeb() : null;
}

/** Called by the web-download handler for hint `pdf`. */
export async function routePdfDownload(event: WebDownloadEvent, download: () => Promise<void>): Promise<void> {
  const choice = useSettingsStore.getState().pdfOpenChoice;
  // An incognito PDF never opens in the in-app viewer (its screen isn't the incognito browser: no FLAG_SECURE, and a
  // cached copy): a remembered "Open in VidoraX" asks instead, without that option.
  if (!isPdfChoice(choice) || choice === 'ask' || (choice === 'viewer' && event.webProfile)) {
    pending = { event, download };
    emit();
    return;
  }
  await act(choice, { event, download });
}

export function cancelPdfChoice(): void {
  pending = null;
  emit();
}

export async function choosePdf(choice: Exclude<PdfChoice, 'ask'>, remember: boolean): Promise<void> {
  const current = pending;
  pending = null;
  emit();
  if (!current) return;
  if (remember) useSettingsStore.getState().updateSetting('pdfOpenChoice', choice);
  await act(choice, current);
}

async function act(choice: Exclude<PdfChoice, 'ask'>, { event, download }: Pending): Promise<void> {
  if (choice === 'download') return download();
  if (choice === 'viewer' && event.webProfile) return download();
  const api = web();
  if (choice === 'external') {
    const opened = await withExpectedSystemScreen(async () => {
      const ok = api?.openPdfExternally?.(event.url) === true;
      if (ok) await new Promise((resolve) => setTimeout(resolve, 1500));
      return ok;
    });
    if (!opened) {
      notify(translate('browserCapture.pdfNoApp'));
      await download();
    }
    return;
  }
  if (!api?.fetchPdf) return download();
  notify(translate('browserCapture.pdfLoading'));
  const fetched = await api.fetchPdf(event.viewTag, event.url, event.userAgent || null).catch((): { status: string; path?: string } => ({ status: 'failed' }));
  if (fetched.status !== 'ok' || !fetched.path) {
    notify(translate(pdfFailureKey(fetched.status)));
    return;
  }
  const name = decodeURIComponent(event.url.split(/[?#]/)[0].split('/').pop() || 'PDF');
  navigation.push(`${routePaths.pdfViewer}?path=${encodeURIComponent(fetched.path)}&title=${encodeURIComponent(name.slice(0, 120))}`);
}

/** Idempotent; the browser screen starts it: PDF downloads come to the choice. */
export function ensurePdfChoice(): void {
  // Left from a viewer the app was killed in: cached PDFs and page pictures go.
  for (const name of ['pdf', 'pdf-pages']) {
    try {
      const dir = new Directory(Paths.cache, name);
      if (dir.exists) dir.delete();
    } catch {
      // nothing to clear
    }
  }
  try {
    web()?.setPdfChoiceEnabled?.(true);
  } catch {
    // older native build: PDFs download as before
  }
}
