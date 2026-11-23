/**
 * P5: the End of Playback Action (#535, with Repeat one #539 and Repeat all #540), app-wide, and the saved A-B loops
 * (#722), per video — both in the key-value store (MMKV). Screens use `useEndOfPlaybackAction()` and
 * `useSavedLoops(mediaId)`.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvGetString, mmkvSetObject, mmkvSetString } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';
import { useShallow } from 'zustand/react/shallow';

import {
  DEFAULT_END_OF_PLAYBACK_ACTION,
  normalizeEndOfPlaybackAction,
  type EndOfPlaybackAction,
} from './end-of-playback';
import {
  addSavedLoop,
  deleteSavedLoop,
  readSavedLoopRecords,
  renameSavedLoop,
  savedLoopsFor,
  type AddSavedLoopResult,
  type SavedLoop,
  type SavedLoopRecords,
} from './saved-loops';

function readAction(): EndOfPlaybackAction {
  try {
    return normalizeEndOfPlaybackAction(mmkvGetString(mmkvKeys.playerEndOfPlayback));
  } catch {
    // Damaged or unavailable storage must not stop the Player.
    return DEFAULT_END_OF_PLAYBACK_ACTION;
  }
}

function readLoops(): SavedLoopRecords {
  try {
    return readSavedLoopRecords(mmkvGetObject<unknown>(mmkvKeys.playerSavedLoops));
  } catch {
    return [];
  }
}

type RepeatState = { endAction: EndOfPlaybackAction; loops: SavedLoopRecords };

const useRepeatStore = createStore<RepeatState>()(() => ({ endAction: readAction(), loops: readLoops() }));

export function useEndOfPlaybackAction(): EndOfPlaybackAction {
  return useRepeatStore((state) => state.endAction);
}

export function getEndOfPlaybackAction(): EndOfPlaybackAction {
  return useRepeatStore.getState().endAction;
}

export function setEndOfPlaybackAction(action: EndOfPlaybackAction): void {
  const endAction = normalizeEndOfPlaybackAction(action);
  try {
    mmkvSetString(mmkvKeys.playerEndOfPlayback, endAction);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useRepeatStore.setState({ endAction });
}

function writeLoops(loops: SavedLoopRecords): void {
  try {
    mmkvSetObject(mmkvKeys.playerSavedLoops, loops);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useRepeatStore.setState({ loops });
}

/** The saved loops of a video, in timeline order (the same array until one of them changes). */
export function useSavedLoops(mediaId: string | null): SavedLoop[] {
  return useRepeatStore(useShallow((state) => savedLoopsFor(state.loops, mediaId)));
}

let loopCounter = 0;

/** Saves the loop A–B of a video under a name. */
export function saveLoop(mediaId: string, name: string, startSeconds: number, endSeconds: number): AddSavedLoopResult {
  const now = Date.now();
  loopCounter += 1;
  const result = addSavedLoop(useRepeatStore.getState().loops, mediaId, {
    id: `${now.toString(36)}-${loopCounter.toString(36)}`,
    name,
    startMs: startSeconds * 1000,
    endMs: endSeconds * 1000,
    createdAt: now,
  });
  if (result.ok) {
    writeLoops(result.records);
  }
  return result;
}

export function renameLoop(mediaId: string, loopId: string, name: string): void {
  const before = useRepeatStore.getState().loops;
  const after = renameSavedLoop(before, mediaId, loopId, name);
  if (after !== before) {
    writeLoops(after);
  }
}

export function deleteLoop(mediaId: string, loopId: string): void {
  const before = useRepeatStore.getState().loops;
  const after = deleteSavedLoop(before, mediaId, loopId);
  if (after !== before) {
    writeLoops(after);
  }
}
