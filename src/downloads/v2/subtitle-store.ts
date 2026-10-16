import type { EnqueueRequest } from '@modules/vidorax-media/src/VidoraMedia.types';
import type { DownloadSubtitles } from '@modules/vidorax-media/src/subtitles.types';
import { persist } from 'zustand/middleware';

import { getActiveLanguage } from '@/localization/translate';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import { getV2Engine, type V2EnginePort } from './engine-port';
import { DEFAULT_SUBTITLE_MODE, normalizeSubtitleMode, selectSubtitleTracks, type SubtitleMode } from './subtitles';

/** Download Settings → "Download subtitles when available" (H19), on this device (MMKV `vidorax.subtitles.v1`). Off by default. */
type SubtitleSettingsState = {
  enabled: boolean;
  mode: SubtitleMode;
  setEnabled: (enabled: boolean) => void;
  setMode: (mode: SubtitleMode) => void;
};

export const useSubtitleSettingsStore = createStore<SubtitleSettingsState>()(
  persist(
    (set) => ({
      enabled: false,
      mode: DEFAULT_SUBTITLE_MODE,
      setEnabled: (enabled) => set((state) => (state.enabled === enabled ? state : { enabled })),
      setMode: (mode) => set((state) => (state.mode === mode ? state : { mode })),
    }),
    {
      name: 'vidorax.subtitles.v1',
      storage: createPersistStorage<{ enabled: boolean; mode: SubtitleMode }>(),
      partialize: (state) => ({ enabled: state.enabled, mode: state.mode }),
      merge: (persisted, current) => {
        const raw = (persisted ?? {}) as { enabled?: unknown; mode?: unknown };
        return { ...current, enabled: raw.enabled === true, mode: normalizeSubtitleMode(raw.mode) };
      },
    },
  ),
);

type SubtitlePort = Required<Pick<V2EnginePort, 'probeSubtitles' | 'setDownloadSubtitles'>>;

/**
 * Right after a stream download was enqueued: the tracks it offers, chosen by the setting, are handed to the native
 * side, which fetches them once the video completed. Does nothing while the setting is off, for files, or on builds
 * without subtitles. Never throws, never delays the download.
 */
export async function attachSubtitleChoice(
  engine: V2EnginePort | null,
  downloadId: string,
  request: Pick<EnqueueRequest, 'url' | 'kind' | 'request'>,
  settings: Pick<SubtitleSettingsState, 'enabled' | 'mode'> = useSubtitleSettingsStore.getState(),
  appLanguage: string = getActiveLanguage(),
): Promise<string[]> {
  if (!settings.enabled || (request.kind !== 'hls' && request.kind !== 'dash')) {
    return [];
  }
  if (!engine?.probeSubtitles || !engine.setDownloadSubtitles) {
    return [];
  }
  const port = engine as V2EnginePort & SubtitlePort;
  try {
    const tracks = await port.probeSubtitles({ url: request.url, kind: request.kind, request: request.request });
    const ids = selectSubtitleTracks(tracks, settings.mode, appLanguage);
    if (ids.length > 0) {
      await port.setDownloadSubtitles(downloadId, ids);
    }
    return ids;
  } catch {
    return [];
  }
}

/** Download Details' view of each download's saved subtitles (this session; the native side is the record). */
type SubtitleRecordsState = { byId: Record<string, DownloadSubtitles | null> };

export const useSubtitleRecordsStore = createStore<SubtitleRecordsState>()(() => ({ byId: {} }));

export async function refreshSubtitleRecord(id: string, engine: V2EnginePort | null = getV2Engine()): Promise<DownloadSubtitles | null> {
  if (!engine?.getDownloadSubtitles) {
    return null;
  }
  try {
    const record = await engine.getDownloadSubtitles(id);
    useSubtitleRecordsStore.setState((state) => ({ byId: { ...state.byId, [id]: record } }));
    return record;
  } catch {
    return null;
  }
}

/** Deleted videos' entries are dropped (their files went with them on the native side). */
export function forgetSubtitleRecords(ids: readonly string[]): void {
  useSubtitleRecordsStore.setState((state) => {
    if (!ids.some((id) => id in state.byId)) {
      return state;
    }
    const byId = { ...state.byId };
    for (const id of ids) {
      delete byId[id];
    }
    return { byId };
  });
}

const LISTENER_KEY = '__vidoraxSubtitleRecordsCleanup';

/** Deleted library items leave the cache. One listener, kept on `globalThis`: calling again replaces it. */
export function ensureSubtitleRecordsCleanup(engine: V2EnginePort | null = getV2Engine()): void {
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
      forgetSubtitleRecords(ids);
    }
  });
}
