/**
 * The list the Player steps through with Previous / Next: the list the video was opened from (the library as shown,
 * the device videos, watch history). Opening from a single place (a download's details, a shelf) leaves no queue, so
 * the buttons stay hidden.
 *
 * P6 (#619 Play Queue, #620 Play Next, #542 Shuffle) extends it; everything that was here works as before (Faran's
 * headset keys call it):
 * - `ids` is still the play order, so `queueNeighbours(ids, …)` and `usePlayQueueNeighbours` follow shuffle, Play next
 *   and reordering by themselves.
 * - `setPlayQueue(x)` still leaves `ids` equal to `x` (or empty); it also ends a shuffle, since the list is a new one.
 * - New: `original` (the order before Shuffle), `shuffled`, `seed`, and `currentId` (the video playing, so a restored
 *   queue and the mini player find their place). Saved across restarts by `play-queue-persistence.ts`, which keeps
 *   this file free of storage, so it loads in unit tests.
 */

import { createStore } from '@/store/shared/create-store';

type PlayQueueState = {
  ids: readonly string[];
  /** P6 #542: the order before Shuffle, restored when it is turned off; null when not shuffled. */
  original: readonly string[] | null;
  shuffled: boolean;
  /** The seed of the last shuffle (tests pass a fixed one). */
  seed: number;
  /** P6: the video playing (set by the Player); null before any. */
  currentId: string | null;
};

export const usePlayQueueStore = createStore<PlayQueueState>()(() => ({
  ids: [],
  original: null,
  shuffled: false,
  seed: 0,
  currentId: null,
}));

export function setPlayQueue(ids: readonly string[] | undefined): void {
  usePlayQueueStore.setState({ ids: ids ? [...ids] : [], original: null, shuffled: false });
}

export type PlayQueueNeighbours = { previousId: string | null; nextId: string | null };

export function queueNeighbours(ids: readonly string[], mediaId: string | null): PlayQueueNeighbours {
  const index = mediaId ? ids.indexOf(mediaId) : -1;
  if (index < 0) {
    return { previousId: null, nextId: null };
  }
  return {
    previousId: index > 0 ? ids[index - 1]! : null,
    nextId: index < ids.length - 1 ? ids[index + 1]! : null,
  };
}

export function usePlayQueueNeighbours(mediaId: string | null): PlayQueueNeighbours {
  const ids = usePlayQueueStore((s) => s.ids);
  return queueNeighbours(ids, mediaId);
}

// ── P6 Queue & auto-next ─────────────────────────────────────────────────────────────────────────────────────────

/** A small fast PRNG (mulberry32): the same seed gives the same shuffle, so tests can fix it. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ids in a random order fixed by the seed (Fisher–Yates). */
export function seededShuffle(ids: readonly string[], seed: number): string[] {
  const out = [...ids];
  const random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** #542: the video playing first (it keeps playing), then all the others shuffled. */
export function shuffleAroundCurrent(ids: readonly string[], currentId: string | null, seed: number): string[] {
  if (currentId == null || !ids.includes(currentId)) {
    return seededShuffle(ids, seed);
  }
  return [currentId, ...seededShuffle(ids.filter((id) => id !== currentId), seed)];
}

/**
 * The original order back after a shuffle: the original's videos still in the queue, in their old order; videos
 * added while shuffled (and not placed in the original by Play next / Add to queue) follow at the end.
 */
export function unshuffledOrder(original: readonly string[], ids: readonly string[]): string[] {
  const present = new Set(ids);
  const kept = original.filter((id) => present.has(id));
  const known = new Set(kept);
  return [...kept, ...ids.filter((id) => !known.has(id))];
}

/**
 * #620 Play next: the video right after the one playing (moved there if already queued). With no queue yet, the
 * video playing starts one. The video playing itself stays where it is.
 */
export function insertAfterCurrent(ids: readonly string[], id: string, currentId: string | null): string[] {
  if (id === currentId) {
    return [...ids];
  }
  const rest = ids.filter((entry) => entry !== id);
  const base = currentId != null && !rest.includes(currentId) && rest.length === 0 ? [currentId] : rest;
  const index = currentId != null ? base.indexOf(currentId) : -1;
  return index < 0 ? [id, ...base] : [...base.slice(0, index + 1), id, ...base.slice(index + 1)];
}

/** Add to queue: at the end, unless it is already queued (then nothing changes). */
export function appendToQueue(ids: readonly string[], id: string, currentId: string | null): string[] {
  if (ids.includes(id)) {
    return [...ids];
  }
  if (ids.length === 0 && currentId != null && currentId !== id) {
    return [currentId, id];
  }
  return [...ids, id];
}

/** Removes a video from the queue; the one playing can't be removed. */
export function removeFromQueueIds(ids: readonly string[], id: string, currentId: string | null): string[] {
  return id === currentId ? [...ids] : ids.filter((entry) => entry !== id);
}

/** Moves a video one place up (-1) or down (+1); nothing at either end. */
export function moveQueueItem(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const out = [...ids];
  const from = out.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= out.length) {
    return out;
  }
  [out[from], out[to]] = [out[to]!, out[from]!];
  return out;
}

export type QueueEditResult = 'added' | 'moved' | 'already' | 'unchanged';

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Records the video playing (the Player calls it as videos change). */
export function setPlayQueueCurrent(mediaId: string | null): void {
  if (usePlayQueueStore.getState().currentId !== mediaId) {
    usePlayQueueStore.setState({ currentId: mediaId });
  }
}

/** #620 Play next, for the video playing now (`currentId`, the session's media). */
export function playNextInQueue(id: string, currentId: string | null): QueueEditResult {
  const state = usePlayQueueStore.getState();
  const ids = insertAfterCurrent(state.ids, id, currentId);
  if (sameOrder(ids, state.ids)) {
    return 'unchanged';
  }
  const wasQueued = state.ids.includes(id);
  usePlayQueueStore.setState({
    ids,
    original: state.original ? insertAfterCurrent(state.original, id, currentId) : null,
    currentId: currentId ?? state.currentId,
  });
  return wasQueued ? 'moved' : 'added';
}

/** Add to queue (at the end). */
export function addToPlayQueue(id: string, currentId: string | null): QueueEditResult {
  const state = usePlayQueueStore.getState();
  if (state.ids.includes(id)) {
    return 'already';
  }
  const ids = appendToQueue(state.ids, id, currentId);
  usePlayQueueStore.setState({
    ids,
    original: state.original ? appendToQueue(state.original, id, currentId) : null,
    currentId: currentId ?? state.currentId,
  });
  return 'added';
}

/** #619: removes a video from the queue (not the one playing). */
export function removeFromPlayQueue(id: string): void {
  const state = usePlayQueueStore.getState();
  const ids = removeFromQueueIds(state.ids, id, state.currentId);
  if (!sameOrder(ids, state.ids)) {
    usePlayQueueStore.setState({
      ids,
      original: state.original ? state.original.filter((entry) => entry !== id) : null,
    });
  }
}

/** #619: moves a video one place up or down in the play order. */
export function movePlayQueueItem(id: string, delta: -1 | 1): void {
  const state = usePlayQueueStore.getState();
  const ids = moveQueueItem(state.ids, id, delta);
  if (!sameOrder(ids, state.ids)) {
    usePlayQueueStore.setState({ ids });
  }
}

/** A seed for a shuffle the user asked for. */
export function newShuffleSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

/**
 * #542 Shuffle on: the video playing keeps playing and comes first, the rest are shuffled (`seed` fixes the order).
 * Off: the original order comes back.
 */
export function setPlayQueueShuffle(on: boolean, seed: number = newShuffleSeed()): void {
  const state = usePlayQueueStore.getState();
  if (on) {
    const original = state.shuffled && state.original ? state.original : state.ids;
    usePlayQueueStore.setState({
      ids: shuffleAroundCurrent(original, state.currentId, seed),
      original: [...original],
      shuffled: true,
      seed,
    });
    return;
  }
  if (!state.shuffled) {
    return;
  }
  usePlayQueueStore.setState({
    ids: state.original ? unshuffledOrder(state.original, state.ids) : [...state.ids],
    original: null,
    shuffled: false,
  });
}

/**
 * Opening the Player: a given list becomes the queue (as before). With no list, the queue is kept only when the video
 * is the one it was playing (the mini player reopened, or the last video after a restart); otherwise there is none,
 * as before.
 */
export function playQueueOnOpen(
  state: Pick<PlayQueueState, 'ids' | 'currentId'>,
  mediaId: string,
  queue: readonly string[] | undefined,
): 'replace' | 'keep' {
  if (queue) {
    return 'replace';
  }
  return state.currentId === mediaId && state.ids.includes(mediaId) ? 'keep' : 'replace';
}

export type StoredPlayQueue = Pick<PlayQueueState, 'ids' | 'original' | 'shuffled' | 'currentId'>;

/** The longest queue saved across restarts (the rest of a very long list is dropped from the saved copy). */
export const MAX_STORED_QUEUE = 2000;

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry && !seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  }
  return out.slice(0, MAX_STORED_QUEUE);
}

/** What is saved across restarts. */
export function toStoredPlayQueue(state: StoredPlayQueue): StoredPlayQueue {
  return {
    ids: state.ids.slice(0, MAX_STORED_QUEUE),
    original: state.original ? state.original.slice(0, MAX_STORED_QUEUE) : null,
    shuffled: state.shuffled,
    currentId: state.currentId,
  };
}

/** The saved queue read back tolerantly; null when there is nothing usable. */
export function readStoredPlayQueue(raw: unknown): StoredPlayQueue | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const ids = stringList(value.ids);
  if (!ids || ids.length === 0) {
    return null;
  }
  const original = stringList(value.original);
  const shuffled = value.shuffled === true && original != null;
  return {
    ids,
    original: shuffled ? original : null,
    shuffled,
    currentId: typeof value.currentId === 'string' && ids.includes(value.currentId) ? value.currentId : null,
  };
}
