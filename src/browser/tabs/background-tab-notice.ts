import { tabUndo } from './tab-undo';

/**
 * B6 #51 — the "Opened in background · Switch" bar's state: the last link opened in a background tab, offered for at
 * least 4 seconds. Drawn by `BackgroundTabSnackbar` where the Undo bar sits; the newer of the two bars wins (a close
 * after it hides it, and offering it hides the Undo bar).
 */

export const BACKGROUND_TAB_NOTICE_MS = 4_000;

export type BackgroundTabNotice = { tabId: string; shownAt: number };

type Listener = () => void;

let current: BackgroundTabNotice | null = null;
const listeners = new Set<Listener>();
let watchingUndo = false;

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function watchUndo(): void {
  if (watchingUndo) return;
  watchingUndo = true;
  tabUndo.subscribe(() => {
    if (tabUndo.get() && current) {
      current = null;
      emit();
    }
  });
}

export const backgroundTabNotice = {
  get(): BackgroundTabNotice | null {
    return current;
  },
  offer(tabId: string): void {
    watchUndo();
    tabUndo.dismiss();
    current = { tabId, shownAt: Date.now() };
    emit();
  },
  dismiss(tabId?: string): void {
    if (!current || (tabId && current.tabId !== tabId)) return;
    current = null;
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
