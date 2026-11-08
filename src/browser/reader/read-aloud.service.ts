import { useSyncExternalStore } from 'react';
import { AppState, Linking, type NativeEventSubscription } from 'react-native';
import * as Speech from 'expo-speech';

import { pickVoice, speechChunks, stepChunk, SPEECH_CHUNK_MAX, type SpeechChunk } from './read-aloud';
import type { ReaderArticle } from './reader-article';

/**
 * B15 #173 — Read aloud in the reader, with the phone's own text-to-speech (expo-speech; voices that need the
 * internet are never picked). Paragraph by paragraph: the one being read is highlighted, Previous / Next jump a
 * paragraph, speed changes take effect from the current paragraph. Android can't pause speech, so Pause stops and Play
 * starts that paragraph again. Leaving the app, closing the reader or another page stops it.
 *
 * For an Urdu article without an Urdu voice on the phone, `noVoice` is set: the reader offers the phone's speech
 * settings (to add one) or reading with the default voice.
 */

export type ReadAloudState = {
  status: 'idle' | 'playing' | 'paused';
  /** The article being read (its url), or null. */
  url: string | null;
  /** Index into the article's blocks of the paragraph being read; -1 = none. */
  blockIndex: number;
  /** Set when the article's language has no voice on the phone. */
  noVoice: boolean;
};

const IDLE: ReadAloudState = { status: 'idle', url: null, blockIndex: -1, noVoice: false };

let state: ReadAloudState = IDLE;
const listeners = new Set<() => void>();
let chunks: SpeechChunk[] = [];
let at = 0;
let rate = 1;
let language = '';
let voice: string | undefined;
/** Bumped on every stop / restart: callbacks of an older utterance are ignored. */
let generation = 0;
let appState: NativeEventSubscription | null = null;

function set(next: ReadAloudState): void {
  state = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function silence(): void {
  generation += 1;
  void Speech.stop().catch(() => undefined);
}

function speakCurrent(): void {
  const chunk = chunks[at];
  if (!chunk) {
    readAloud.stop();
    return;
  }
  silence();
  const mine = generation;
  set({ ...state, status: 'playing', blockIndex: chunk.blockIndex });
  const max = Speech.maxSpeechInputLength > 0 ? Math.min(Speech.maxSpeechInputLength, SPEECH_CHUNK_MAX) : SPEECH_CHUNK_MAX;
  Speech.speak(chunk.text.slice(0, max), {
    ...(language ? { language } : {}),
    ...(voice ? { voice } : {}),
    rate,
    onDone: () => {
      if (mine !== generation) return;
      at += 1;
      if (at >= chunks.length) readAloud.stop();
      else speakCurrent();
    },
    onError: () => {
      if (mine !== generation) return;
      readAloud.stop();
    },
  });
}

function watchAppState(): void {
  if (appState) return;
  appState = AppState.addEventListener('change', (next) => {
    if (next !== 'active' && state.status === 'playing') readAloud.pause();
  });
}

export const readAloud = {
  getState(): ReadAloudState {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Starts reading `article` from the first paragraph (or `fromBlock`). Checks for a voice in the article's language
   * first; with none, sets `noVoice` and waits (unless `anyVoice`).
   */
  async play(article: ReaderArticle, speed: number, options: { fromBlock?: number; anyVoice?: boolean } = {}): Promise<void> {
    chunks = speechChunks(article.blocks);
    if (!chunks.length) return;
    rate = speed;
    language = article.language;
    voice = undefined;
    if (article.language && !options.anyVoice) {
      let voices: Speech.Voice[] = [];
      try {
        voices = await Speech.getAvailableVoicesAsync();
      } catch {
        voices = [];
      }
      const picked = pickVoice(voices, article.language);
      if (!picked && article.urdu) {
        set({ status: 'idle', url: article.url, blockIndex: -1, noVoice: true });
        return;
      }
      voice = picked?.identifier;
    }
    if (options.anyVoice) language = '';
    const from = options.fromBlock ?? -1;
    const start = from >= 0 ? chunks.findIndex((c) => c.blockIndex >= from) : 0;
    at = start < 0 ? 0 : start;
    set({ status: 'playing', url: article.url, blockIndex: chunks[at].blockIndex, noVoice: false });
    watchAppState();
    speakCurrent();
  },

  pause(): void {
    if (state.status !== 'playing') return;
    silence();
    // Back to the start of the paragraph being read (Android can't resume mid-utterance).
    while (at > 0 && chunks[at - 1]?.blockIndex === chunks[at]?.blockIndex) at -= 1;
    set({ ...state, status: 'paused' });
  },

  resume(): void {
    if (state.status !== 'paused') return;
    speakCurrent();
  },

  step(direction: 1 | -1): void {
    if (state.status === 'idle') return;
    const next = stepChunk(chunks, at, direction);
    if (next >= chunks.length) {
      readAloud.stop();
      return;
    }
    at = next;
    if (state.status === 'playing') speakCurrent();
    else set({ ...state, blockIndex: chunks[at].blockIndex });
  },

  setRate(speed: number): void {
    rate = speed;
    if (state.status === 'playing') {
      while (at > 0 && chunks[at - 1]?.blockIndex === chunks[at]?.blockIndex) at -= 1;
      speakCurrent();
    }
  },

  stop(): void {
    silence();
    chunks = [];
    at = 0;
    appState?.remove();
    appState = null;
    if (state !== IDLE) set(IDLE);
  },

  dismissNoVoice(): void {
    if (state.noVoice) set(IDLE);
  },

  /** The phone's text-to-speech settings (to add an Urdu voice). */
  async openSpeechSettings(): Promise<boolean> {
    try {
      await Linking.sendIntent('com.android.settings.TTS_SETTINGS');
      return true;
    } catch {
      try {
        await Linking.openSettings();
        return true;
      } catch {
        return false;
      }
    }
  },
};

const getState = () => state;

export function useReadAloud(): ReadAloudState {
  return useSyncExternalStore(readAloud.subscribe, getState, getState);
}
