import { persist } from 'zustand/middleware';

import { getV2Engine } from '@/downloads/v2/engine-port';
import { normalizeHiddenIds } from '@/files/organize/hidden-items';
import type { SwatchId } from '@/files/organize/swatches';
import { clearTagColor, normalizeTagColors, renameTagColor, setTagColor } from '@/files/organize/tag-colors';
import { mmkvKeys } from '@/storage/constants';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import {
  cleanNote,
  cleanTag,
  hasTag,
  normalizeSizeBucket,
  normalizeTags,
  tagProblem,
  type SizeBucket,
} from './item-organize';

/**
 * H12: tags (#387) and notes (#495) of saved videos, on this device only (MMKV `vidorax.itemTags.v1` and
 * `vidorax.itemNotes.v1`). They go with their item: deleting it forgets them ([ensureItemOrganizeCleanup]).
 */
type TagsState = {
  tagsById: Record<string, string[]>;
  /** False when the tag could not be added (see `tagProblem`). */
  addTag: (id: string, tag: string) => boolean;
  removeTag: (id: string, tag: string) => void;
  forget: (ids: readonly string[]) => void;
};

export const useItemTagsStore = createStore<TagsState>()(
  persist(
    (set, get) => ({
      tagsById: {},
      addTag: (id, raw) => {
        const current = get().tagsById[id] ?? [];
        if (!id || tagProblem(current, raw) !== null) {
          return false;
        }
        set((state) => ({ tagsById: { ...state.tagsById, [id]: [...current, cleanTag(raw)] } }));
        return true;
      },
      removeTag: (id, tag) =>
        set((state) => {
          const current = state.tagsById[id];
          if (!current || !hasTag(current, tag)) {
            return state;
          }
          const next = current.filter((value) => value.toLocaleLowerCase() !== tag.toLocaleLowerCase());
          const tagsById = { ...state.tagsById };
          if (next.length > 0) {
            tagsById[id] = next;
          } else {
            delete tagsById[id];
          }
          return { tagsById };
        }),
      forget: (ids) =>
        set((state) => {
          if (!ids.some((id) => state.tagsById[id])) {
            return state;
          }
          const tagsById = { ...state.tagsById };
          for (const id of ids) {
            delete tagsById[id];
          }
          return { tagsById };
        }),
    }),
    {
      name: 'vidorax.itemTags.v1',
      storage: createPersistStorage<{ tagsById: Record<string, string[]> }>(),
      partialize: (state) => ({ tagsById: state.tagsById }),
      merge: (persisted, current) => {
        const raw = (persisted as { tagsById?: unknown } | null)?.tagsById;
        const tagsById: Record<string, string[]> = {};
        if (raw && typeof raw === 'object') {
          for (const [id, tags] of Object.entries(raw as Record<string, unknown>)) {
            const clean = normalizeTags(tags);
            if (clean.length > 0) {
              tagsById[id] = clean;
            }
          }
        }
        return { ...current, tagsById };
      },
    },
  ),
);

type NotesState = {
  notesById: Record<string, string>;
  /** Saves the note (trimmed, at most 1,000 characters); an empty note removes it. */
  setNote: (id: string, note: string) => void;
  forget: (ids: readonly string[]) => void;
};

export const useItemNotesStore = createStore<NotesState>()(
  persist(
    (set) => ({
      notesById: {},
      setNote: (id, raw) =>
        set((state) => {
          const note = cleanNote(raw);
          if (!id || (state.notesById[id] ?? '') === note) {
            return state;
          }
          const notesById = { ...state.notesById };
          if (note) {
            notesById[id] = note;
          } else {
            delete notesById[id];
          }
          return { notesById };
        }),
      forget: (ids) =>
        set((state) => {
          if (!ids.some((id) => id in state.notesById)) {
            return state;
          }
          const notesById = { ...state.notesById };
          for (const id of ids) {
            delete notesById[id];
          }
          return { notesById };
        }),
    }),
    {
      name: 'vidorax.itemNotes.v1',
      storage: createPersistStorage<{ notesById: Record<string, string> }>(),
      partialize: (state) => ({ notesById: state.notesById }),
      merge: (persisted, current) => {
        const raw = (persisted as { notesById?: unknown } | null)?.notesById;
        const notesById: Record<string, string> = {};
        if (raw && typeof raw === 'object') {
          for (const [id, note] of Object.entries(raw as Record<string, unknown>)) {
            const clean = typeof note === 'string' ? cleanNote(note) : '';
            if (clean) {
              notesById[id] = clean;
            }
          }
        }
        return { ...current, notesById };
      },
    },
  ),
);

/**
 * The Tag and Size filters of the Downloads list (#387, #396) and the Tag filter of Player. This session only; nothing
 * chosen (the default) shows every item, as before.
 */
type OrganizeFiltersState = {
  downloadsTag: string | null;
  downloadsSize: SizeBucket;
  playerTag: string | null;
  setDownloadsTag: (tag: string | null) => void;
  setDownloadsSize: (size: SizeBucket) => void;
  setPlayerTag: (tag: string | null) => void;
};

export const useOrganizeFiltersStore = createStore<OrganizeFiltersState>()((set) => ({
  downloadsTag: null,
  downloadsSize: 'all',
  playerTag: null,
  setDownloadsTag: (tag) => set({ downloadsTag: tag }),
  setDownloadsSize: (size) => set({ downloadsSize: normalizeSizeBucket(size) }),
  setPlayerTag: (tag) => set({ playerTag: tag }),
}));

/**
 * Files F7 #911 Hide file: the hidden items (MMKV `vidorax.files.hidden.v1`). A hidden file leaves Files, the Player
 * tab, Downloads and search until "Show hidden files" (File manager settings) is on. Not encryption.
 */
type HiddenState = {
  hiddenIds: string[];
  setHidden: (ids: readonly string[], hidden: boolean) => void;
  forget: (ids: readonly string[]) => void;
};

export const useItemHiddenStore = createStore<HiddenState>()(
  persist(
    (set) => ({
      hiddenIds: [],
      setHidden: (ids, hidden) =>
        set((state) => {
          const next = new Set(state.hiddenIds);
          let changed = false;
          for (const id of ids) {
            if (hidden && !next.has(id)) {
              next.add(id);
              changed = true;
            } else if (!hidden && next.has(id)) {
              next.delete(id);
              changed = true;
            }
          }
          return changed ? { hiddenIds: [...next] } : state;
        }),
      forget: (ids) =>
        set((state) => (ids.some((id) => state.hiddenIds.includes(id)) ? { hiddenIds: state.hiddenIds.filter((id) => !ids.includes(id)) } : state)),
    }),
    {
      name: mmkvKeys.filesHidden,
      storage: createPersistStorage<{ hiddenIds: string[] }>(),
      partialize: (state) => ({ hiddenIds: state.hiddenIds }),
      merge: (persisted, current) => ({ ...current, hiddenIds: normalizeHiddenIds((persisted as { hiddenIds?: unknown } | null)?.hiddenIds) }),
    },
  ),
);

/** Files F7 #977 Color tags: each tag's colour (MMKV `vidorax.files.tagColors.v1`), by tag, ignoring case. */
type TagColorsState = {
  colors: Record<string, SwatchId>;
  setColor: (tag: string, color: SwatchId | null) => void;
  renameTag: (from: string, to: string) => void;
};

export const useTagColorsStore = createStore<TagColorsState>()(
  persist(
    (set) => ({
      colors: {},
      setColor: (tag, color) => set((state) => ({ colors: color ? setTagColor(state.colors, tag, color) : clearTagColor(state.colors, tag) })),
      renameTag: (from, to) => set((state) => ({ colors: renameTagColor(state.colors, from, to) })),
    }),
    {
      name: mmkvKeys.filesTagColors,
      storage: createPersistStorage<{ colors: Record<string, SwatchId> }>(),
      partialize: (state) => ({ colors: state.colors }),
      merge: (persisted, current) => ({ ...current, colors: normalizeTagColors((persisted as { colors?: unknown } | null)?.colors) }),
    },
  ),
);

/** Tags, notes and the hidden mark (F7) of items that were deleted are forgotten too. */
export function forgetItemOrganize(ids: readonly string[]): void {
  if (ids.length === 0) {
    return;
  }
  useItemTagsStore.getState().forget(ids);
  useItemNotesStore.getState().forget(ids);
  useItemHiddenStore.getState().forget(ids);
}

/**
 * Replace (#386): the new copy takes over the old one's tags (merged with any it already has) and its note (unless it
 * has one), before the old one is deleted.
 */
export function carryItemOrganize(fromId: string, toId: string): void {
  if (!fromId || !toId || fromId === toId) {
    return;
  }
  const tagsStore = useItemTagsStore.getState();
  for (const tag of tagsStore.tagsById[fromId] ?? []) {
    useItemTagsStore.getState().addTag(toId, tag);
  }
  const notes = useItemNotesStore.getState();
  const note = notes.notesById[fromId];
  if (note && !notes.notesById[toId]) {
    notes.setNote(toId, note);
  }
}

const LISTENER_KEY = '__vidoraxItemOrganizeCleanup';

/**
 * An item's tags and note go with it: when library items are deleted (from VidoraX, or found missing), theirs are
 * forgotten. Kept on `globalThis`, so a Fast Refresh replaces the listener instead of adding a second one.
 */
export function ensureItemOrganizeCleanup(): void {
  const engine = getV2Engine();
  if (!engine) {
    return;
  }
  const slot = globalThis as unknown as Record<string, { remove(): void } | undefined>;
  try {
    slot[LISTENER_KEY]?.remove();
  } catch {
    // already gone
  }
  slot[LISTENER_KEY] = engine.addListener('onLibraryChange', ({ reason, ids }) => {
    if (reason === 'deleted') {
      forgetItemOrganize(ids);
    }
  });
}
