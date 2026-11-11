import { persist } from 'zustand/middleware';

import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import { normalizeArtistTags, withArtist, withoutArtists, type ArtistTags } from './media-tags';

/** App-level tags (MMKV key `vidorax.mediaTags.v1`): the artist of each library item. Written on Save only. */
type MediaTagsState = {
  artists: ArtistTags;
  setArtist: (id: string, artist: string) => void;
  forget: (ids: readonly string[]) => void;
};

export const useMediaTagsStore = createStore<MediaTagsState>()(
  persist(
    (set) => ({
      artists: {},
      setArtist: (id, artist) =>
        set((state) => {
          const artists = withArtist(state.artists, id, artist);
          return artists === state.artists ? state : { artists };
        }),
      forget: (ids) =>
        set((state) => {
          const artists = withoutArtists(state.artists, ids);
          return artists === state.artists ? state : { artists };
        }),
    }),
    {
      name: 'vidorax.mediaTags.v1',
      storage: createPersistStorage<Pick<MediaTagsState, 'artists'>>(),
      partialize: (state) => ({ artists: state.artists }),
      merge: (persisted, current) => ({
        ...current,
        artists: normalizeArtistTags((persisted as { artists?: unknown } | null)?.artists),
      }),
    },
  ),
);

/** The artist VidoraX keeps for a library item, or null. */
export function useMediaArtist(id: string | null | undefined): string | null {
  return useMediaTagsStore((state) => (id ? (state.artists[id] ?? null) : null));
}
