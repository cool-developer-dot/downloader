import { useBrowserStore } from '@/browser/stores';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';

import { tabAudioScript } from './tab-audio-script';

/**
 * B3 #8 / #220 — each tab's mute and volume (in memory, for this app run). A change is applied in the tab's page at
 * once (`tabAudioScript`); the tab's WebView also puts the script in its document-start scripts while the tab isn't at
 * the default (unmuted, 100 %), so the next pages in that tab follow it.
 */

export type TabAudio = { muted: boolean; volume: number };

export const DEFAULT_TAB_AUDIO: TabAudio = { muted: false, volume: 100 };

type Listener = () => void;

const audio = new Map<string, TabAudio>();
const listeners = new Set<Listener>();
let version = 0;
let pruning = false;

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function prune(): void {
  if (pruning) return;
  pruning = true;
  // A closed tab's settings go with it.
  useBrowserStore.subscribe((state) => {
    let changed = false;
    for (const id of [...audio.keys()]) {
      if (!state.tabs.some((tab) => tab.id === id)) {
        audio.delete(id);
        changed = true;
      }
    }
    if (changed) emit();
  });
}

function apply(tabId: string, next: TabAudio): void {
  prune();
  if (next.muted === DEFAULT_TAB_AUDIO.muted && next.volume === DEFAULT_TAB_AUDIO.volume) audio.delete(tabId);
  else audio.set(tabId, next);
  emit();
  try {
    tabControllerRegistry.get(tabId)?.webViewRef.current?.injectJavaScript(tabAudioScript(next.muted, next.volume));
  } catch {
    // The tab has no live page: its next page gets the document-start script.
  }
}

export const tabAudio = {
  get(tabId: string): TabAudio {
    return audio.get(tabId) ?? DEFAULT_TAB_AUDIO;
  },

  /** True while the tab isn't at the default (its pages need the script). */
  isAdjusted(tabId: string): boolean {
    return audio.has(tabId);
  },

  setMuted(tabId: string, muted: boolean): void {
    apply(tabId, { ...tabAudio.get(tabId), muted });
  },

  /** 0–100 %. */
  setVolume(tabId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(Number.isFinite(volume) ? volume : 100)));
    apply(tabId, { ...tabAudio.get(tabId), volume: clamped });
  },

  getVersion(): number {
    return version;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
