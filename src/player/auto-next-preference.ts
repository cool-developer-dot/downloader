/**
 * P6: Auto Play Next (#534, off by default: before P6 a finished video always stopped) and the Next Episode Prompt
 * (#733, on: it only shows when Auto Play Next or Repeat all is about to play the next episode). App-wide, MMKV.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvSetBoolean } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

export const DEFAULT_AUTO_PLAY_NEXT = false;
export const DEFAULT_NEXT_EPISODE_PROMPT = true;

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = mmkvGetBoolean(key);
    return typeof value === 'boolean' ? value : fallback;
  } catch {
    return fallback;
  }
}

type AutoNextState = { autoPlayNext: boolean; nextEpisodePrompt: boolean };

const useAutoNextStore = createStore<AutoNextState>()(() => ({
  autoPlayNext: readFlag(mmkvKeys.playerAutoPlayNext, DEFAULT_AUTO_PLAY_NEXT),
  nextEpisodePrompt: readFlag(mmkvKeys.playerNextEpisodePrompt, DEFAULT_NEXT_EPISODE_PROMPT),
}));

export function useAutoPlayNext(): boolean {
  return useAutoNextStore((state) => state.autoPlayNext);
}

/** For code outside React (the session runner's end of a video, in the mini player). */
export function getAutoPlayNext(): boolean {
  return useAutoNextStore.getState().autoPlayNext;
}

export function useNextEpisodePrompt(): boolean {
  return useAutoNextStore((state) => state.nextEpisodePrompt);
}

function writeFlag(key: string, value: boolean): void {
  try {
    mmkvSetBoolean(key, value);
  } catch {
    // Kept for this run even when it can't be saved.
  }
}

export function setAutoPlayNext(on: boolean): void {
  writeFlag(mmkvKeys.playerAutoPlayNext, on);
  useAutoNextStore.setState({ autoPlayNext: on });
}

export function setNextEpisodePrompt(on: boolean): void {
  writeFlag(mmkvKeys.playerNextEpisodePrompt, on);
  useAutoNextStore.setState({ nextEpisodePrompt: on });
}
