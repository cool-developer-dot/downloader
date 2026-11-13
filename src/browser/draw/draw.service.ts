import { useSyncExternalStore } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { getTabWebViewTag } from '@/browser/webview/webview-view-tags';
import { withExpectedSystemScreen } from '@/security/app-lock/expected-system-screen';

/**
 * B23 #279 — Draw on page. Built on B1's page picture (`snapshotWebView`, the visible part of the page): B17's
 * full-page screenshot was never built. The picture is copied at once into `<cache>/drawings/` (the tab-preview folder
 * is cleaned by its own owner), drawn on in the app, and exported natively (Pictures/VidoraX or the share sheet).
 * Not in incognito tabs (no copies out of incognito).
 */

export type DrawSession = { tabId: string; uri: string; width: number; height: number; title: string };

const MAX_WIDTH = 1440;
let session: DrawSession | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function useDrawSession(): DrawSession | null {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => version,
  );
  return session;
}

function folder(): Directory {
  const dir = new Directory(Paths.cache, 'drawings');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Takes the page picture and opens the drawing screen; false when no picture could be taken. */
export async function startDrawing(tabId: string, title: string): Promise<boolean> {
  if (isIncognitoTabId(tabId)) return false;
  const tag = getTabWebViewTag(tabId);
  if (tag == null || !isVidoraWebAvailable()) return false;
  const web = getVidoraWeb();
  if (typeof web.snapshotWebView !== 'function' || typeof web.exportDrawing !== 'function') return false;
  const shot = await web.snapshotWebView(tag, MAX_WIDTH, 'vidorax-draw').catch(() => null);
  if (!shot || shot.width <= 0 || shot.height <= 0) return false;
  try {
    const dir = folder();
    for (const entry of dir.list()) if (entry instanceof File && entry.name.startsWith('page-')) entry.delete();
    const copy = new File(dir, `page-${Date.now()}.jpg`);
    new File(shot.uri).copy(copy);
    session = { tabId, uri: copy.uri, width: shot.width, height: shot.height, title };
    emit();
    return true;
  } catch {
    return false;
  }
}

export function closeDrawing(): void {
  if (session) {
    try {
      new File(session.uri).delete();
    } catch {
      // already gone
    }
  }
  session = null;
  emit();
}

export async function exportDrawing(mode: 'save' | 'share', strokes: string): Promise<boolean> {
  const s = session;
  if (!s || !isVidoraWebAvailable()) return false;
  const web = getVidoraWeb();
  const name = `VidoraX ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
  const run = () => web.exportDrawing?.(s.uri, strokes, mode, name).catch(() => false) ?? Promise.resolve(false);
  if (mode === 'save') return run();
  // The share sheet is a system screen of this action: App Lock doesn't relock for it (as B22's QR share).
  return withExpectedSystemScreen(async () => {
    const shared = await run();
    // The native call returns as the sheet opens; the app leaves just after.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return shared;
  });
}

export function canSaveDrawingToPictures(): boolean {
  if (!isVidoraWebAvailable()) return false;
  return getVidoraWeb().canSaveQrToGallery?.() === true;
}
