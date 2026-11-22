import { useEffect, useMemo, useState } from 'react';

import type { MediaLibraryItem } from '@/library';
import {
  playlistsRepository,
  type Playlist,
  type PlaylistItem,
} from '@/storage/repositories/playlists.repository';

import { usePlaylistRevision } from './playlist-changes';
import { resolvePlaylistEntries, type PlaylistEntryView } from './playlist-entries';
import { deviceLookup, listUnknownDeviceVideos, loadLibraryIndex } from './playlist-library';

export type PlaylistsState = { status: 'loading' | 'ready' | 'error'; playlists: Playlist[] };

/** P7: every playlist (recently changed first), read again after any playlist change. `enabled: false` reads nothing. */
export function usePlaylists(enabled = true): PlaylistsState {
  const revision = usePlaylistRevision((state) => state.revision);
  const [state, setState] = useState<PlaylistsState>({ status: 'loading', playlists: [] });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let alive = true;
    playlistsRepository.list().then(
      (playlists) => {
        if (alive) setState({ status: 'ready', playlists });
      },
      () => {
        if (alive) setState((previous) => ({ status: 'error', playlists: previous.playlists }));
      },
    );
    return () => {
      alive = false;
    };
  }, [enabled, revision]);
  return state;
}

/** P7: the playlists that already have this video (the add sheet ticks them); empty for none or several videos. */
export function usePlaylistsWithMedia(mediaId: string | null, enabled: boolean): ReadonlySet<string> {
  const revision = usePlaylistRevision((state) => state.revision);
  const [found, setFound] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: '', ids: new Set() });
  const key = `${mediaId ?? ''}:${revision}`;
  useEffect(() => {
    if (!enabled || !mediaId) {
      return;
    }
    let alive = true;
    playlistsRepository.playlistIdsWith(mediaId).then(
      (ids) => {
        if (alive) setFound({ key, ids: new Set(ids) });
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [enabled, key, mediaId]);
  return enabled && mediaId && found.key === key ? found.ids : EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set();

export type PlaylistDetail = {
  status: 'loading' | 'ready' | 'missing' | 'error';
  playlist: Playlist | null;
  entries: PlaylistEntryView[];
};

/**
 * P7 #618: one playlist and its entries as they are now (live names, missing files, phone videos). The library is
 * read again each time `focusKey` changes (the screen coming back to the front); the entries after every change.
 */
export function usePlaylistDetail(id: string | null, focusKey: number): PlaylistDetail {
  const revision = usePlaylistRevision((state) => state.revision);
  const [loaded, setLoaded] = useState<{
    status: 'loading' | 'ready' | 'missing' | 'error';
    playlist: Playlist | null;
    items: PlaylistItem[];
  }>({ status: 'loading', playlist: null, items: [] });
  const [library, setLibrary] = useState<Map<string, MediaLibraryItem> | null>(null);
  const [deviceTick, setDeviceTick] = useState(0);

  useEffect(() => {
    let alive = true;
    loadLibraryIndex().then(
      (index) => {
        if (alive) setLibrary(index);
      },
      () => {
        if (alive) setLibrary(new Map());
      },
    );
    return () => {
      alive = false;
    };
  }, [focusKey]);

  useEffect(() => {
    if (!id) {
      return;
    }
    let alive = true;
    Promise.all([playlistsRepository.get(id), playlistsRepository.items(id)]).then(
      ([playlist, items]) => {
        if (!alive) return;
        setLoaded({ status: playlist ? 'ready' : 'missing', playlist, items: playlist ? items : [] });
        // Phone videos play once VidoraX has listed them in this run.
        void listUnknownDeviceVideos(items.map((item) => item.mediaId)).then((changed) => {
          if (alive && changed) setDeviceTick((tick) => tick + 1);
        });
      },
      () => {
        if (alive) setLoaded((previous) => ({ ...previous, status: 'error' }));
      },
    );
    return () => {
      alive = false;
    };
  }, [focusKey, id, revision]);

  const entries = useMemo(() => {
    void deviceTick;
    return library ? resolvePlaylistEntries(loaded.items, { library, device: deviceLookup }) : [];
  }, [deviceTick, library, loaded.items]);

  if (!id) {
    return { status: 'missing', playlist: null, entries: [] };
  }
  return {
    status: loaded.status === 'ready' && !library ? 'loading' : loaded.status,
    playlist: loaded.playlist,
    entries,
  };
}
