import { createStore } from '@/store/shared/create-store';

/**
 * P7 — bumped after every playlist change (create, add, reorder, remove, rename, delete, import), so open screens
 * and sheets read the database again. The playlists themselves live in SQLite, not here.
 */
export const usePlaylistRevision = createStore<{ revision: number }>()(() => ({ revision: 0 }));

export function notifyPlaylistsChanged(): void {
  usePlaylistRevision.setState((state) => ({ revision: state.revision + 1 }));
}
