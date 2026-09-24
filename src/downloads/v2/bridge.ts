import type {
  DownloadProgressEvent,
  DownloadRecord,
  LibraryItem,
} from '@modules/vidorax-media/src/VidoraMedia.types';

import type { DownloadItem } from '@/api/types';

import { claimAutoPlay } from './autoplay';
import { logV2Download } from './diagnostics';
import type { V2EnginePort } from './engine-port';
import { createDownloadProgressCoalescer } from './progress-coalescer';
import { projectV2Download, projectV2LibraryItem, type V2DownloadEntry } from './projection';

export type V2BridgeSink = {
  applyEntries: (entries: V2DownloadEntry[]) => void;
  applyProgress: (event: DownloadProgressEvent) => void;
  removeEntries: (ids: string[]) => void;
  /** Opens the player for a download that just finished; the sink decides whether it can. */
  play?: (downloadId: string) => void;
  /** A download genuinely completed: COMPLETED with its verified library item (the in-app review counts these). */
  onCompleted?: (downloadId: string) => void;
  /** Row currently mirrored for an id, if any: keeps what only the download record knew (chosen quality, attempts). */
  rowOf: (id: string) => DownloadItem | null;
};

const LIBRARY_PAGE = 200;

/** React Native's AppState, read lazily so this module still imports under the test runner. */
function currentAppState(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require('react-native') as { AppState?: { currentState?: string | null } };
    return AppState?.currentState ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * One row per id from the engine's two persisted sources: recent/active download records and library items.
 * A completed record is shown only with its library item (the verified, finalized file); when the user deleted
 * that item the record is not resurrected.
 */
export function collectV2Entries(downloads: DownloadRecord[], library: LibraryItem[]): V2DownloadEntry[] {
  const libraryById = new Map(library.map((item) => [item.id, item]));
  const entries = new Map<string, V2DownloadEntry>();
  for (const record of downloads) {
    if (entries.has(record.id)) {
      continue;
    }
    if (record.state === 'completed') {
      const item = libraryById.get(record.id);
      if (item) {
        entries.set(record.id, projectV2Download(record, { library: item }));
      }
      continue;
    }
    entries.set(record.id, projectV2Download(record));
  }
  for (const item of library) {
    if (!entries.has(item.id)) {
      entries.set(item.id, projectV2LibraryItem(item));
    }
  }
  return [...entries.values()];
}

export async function listWholeLibrary(engine: V2EnginePort): Promise<LibraryItem[]> {
  const items: LibraryItem[] = [];
  for (let offset = 0; ; offset += LIBRARY_PAGE) {
    const page = await engine.listLibrary({ sort: 'newest', limit: LIBRARY_PAGE, offset });
    items.push(...page.items);
    if (page.items.length < LIBRARY_PAGE || items.length >= page.total) {
      return items;
    }
  }
}

export async function hydrateV2Downloads(engine: V2EnginePort, sink: V2BridgeSink): Promise<number> {
  const [downloads, library] = await Promise.all([engine.listDownloads(), listWholeLibrary(engine)]);
  const entries = collectV2Entries(downloads, library);
  sink.applyEntries(entries);
  return entries.length;
}

/**
 * Subscribes to the engine's persisted-state events. Returns the unsubscribe. Records are the only authority:
 * nothing here invents a state, a progress value or a library item.
 */
export function subscribeV2Downloads(engine: V2EnginePort, sink: V2BridgeSink): () => void {
  // Progress is the only flooding event the engine emits; everything else is
  // one event per real state change and reaches the sink untouched.
  const progress = createDownloadProgressCoalescer(sink.applyProgress);
  const subscriptions = [
    engine.addListener('onDownloadStateChange', ({ record }) => {
      logV2Download('state_event', {
        downloadId: record.id,
        state: record.state,
        bytesDone: record.bytesDone,
      });
      // The row is about to change state: never let a buffered progress event
      // land after it, and drop this id's throttle bookkeeping.
      progress.flush(record.id);
      if (record.state === 'completed' || record.state === 'failed') {
        const stats = progress.stats();
        logV2Download('progress_coalesced', {
          downloadId: record.id,
          received: stats.received,
          applied: stats.applied,
        });
      }
      if (record.state !== 'completed') {
        sink.applyEntries([projectV2Download(record)]);
        return;
      }
      // Library insert and COMPLETED are one atomic step natively; read the item it produced.
      void engine
        .getLibraryItem(record.id)
        .then((item) => {
          sink.applyEntries([projectV2Download(record, { library: item })]);
          if (item) {
            try {
              sink.onCompleted?.(record.id);
            } catch {
              // Counting a success must never disturb the download bridge.
            }
          }
          if (!item || !sink.play) {
            return;
          }
          const play = claimAutoPlay({
            downloadId: record.id,
            appState: currentAppState(),
            playable: Boolean(item.fileUri),
          });
          if (play) {
            sink.play(play);
          }
        })
        .catch(() => sink.applyEntries([projectV2Download(record)]));
    }),
    engine.addListener('onDownloadProgress', (event) => {
      progress.push(event);
    }),
    engine.addListener('onLibraryChange', ({ reason, ids }) => {
      if (ids.length === 0) {
        return;
      }
      if (reason === 'deleted') {
        sink.removeEntries(ids);
        return;
      }
      void engine
        .getLibraryItems(ids)
        .then((items) =>
          sink.applyEntries(
            items.map((item) => {
              const entry = projectV2LibraryItem(item);
              const existing = sink.rowOf(item.id);
              if (!existing) {
                return entry;
              }
              return {
                item: {
                  ...entry.item,
                  // The verified file's own resolution wins over the label the offer carried.
                  quality: entry.item.quality ?? existing.quality,
                  retryCount: existing.retryCount,
                  createdAt: existing.createdAt,
                },
                transfer: entry.transfer,
              };
            }),
          ),
        )
        .catch(() => {
          // The next hydration re-reads the library.
        });
    }),
  ];
  return () => {
    for (const subscription of subscriptions) {
      subscription.remove();
    }
    progress.dispose();
  };
}
