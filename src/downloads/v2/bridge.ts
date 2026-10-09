import type {
  DownloadProgressEvent,
  DownloadRecord,
  LibraryItem,
} from '@modules/vidorax-media/src/VidoraMedia.types';

import type { DownloadItem } from '@/api/types';

import { createCompletionNotifier } from './completion-notice';
import { logV2Download } from './diagnostics';
import type { V2EnginePort } from './engine-port';
import { createDownloadProgressCoalescer } from './progress-coalescer';
import { projectV2Download, projectV2LibraryItem, type V2DownloadEntry } from './projection';

export type V2BridgeSink = {
  applyEntries: (entries: V2DownloadEntry[]) => void;
  applyProgress: (event: DownloadProgressEvent) => void;
  removeEntries: (ids: string[]) => void;
  /** Tells the user a download finished ("Video downloaded") without leaving the current screen. */
  announceCompleted?: (downloadId: string) => void;
  /**
   * Tells the user a finished download turned out to be a video they already have ("Video already downloaded"): the
   * engine discarded the copy (DUPLICATE). Same rules as `announceCompleted`: once, only while the app is in front.
   */
  announceDuplicate?: (downloadId: string) => void;
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
 * A download the engine discarded because its finished file was a video the user already has (`DUPLICATE`). Not a
 * failure and not a new video: it gets no row — the user was told "Video already downloaded" — and its record is
 * removed from the engine.
 */
export function isDiscardedDuplicate(record: Pick<DownloadRecord, 'state' | 'errorCode'>): boolean {
  return record.state === 'failed' && record.errorCode === 'DUPLICATE';
}

/** Removes the engine records of discarded duplicates; never throws. */
function forgetDiscardedDuplicates(engine: V2EnginePort, downloads: DownloadRecord[]): void {
  for (const record of downloads) {
    if (isDiscardedDuplicate(record)) {
      void engine.removeDownload(record.id).catch(() => {
        // Already gone, or the engine refused: the row is filtered out on every hydration anyway.
      });
    }
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
    if (entries.has(record.id) || isDiscardedDuplicate(record)) {
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

/**
 * The download records alone — active ones and those finished in the last day — with the library items of the
 * finished ones: all Downloads, notifications and in-app review need right after launch. Independent of how large
 * the library is, so it can run on the startup path.
 */
export async function hydrateV2ActiveDownloads(engine: V2EnginePort, sink: V2BridgeSink): Promise<number> {
  const downloads = await engine.listDownloads();
  forgetDiscardedDuplicates(engine, downloads);
  const completedIds = downloads.filter((record) => record.state === 'completed').map((record) => record.id);
  const library = completedIds.length > 0 ? await engine.getLibraryItems(completedIds) : [];
  const entries = collectV2Entries(downloads, library);
  sink.applyEntries(entries);
  return entries.length;
}

/** Every download record and every library item (the Player tab's library). */
export async function hydrateV2Downloads(engine: V2EnginePort, sink: V2BridgeSink): Promise<number> {
  const [downloads, library] = await Promise.all([engine.listDownloads(), listWholeLibrary(engine)]);
  forgetDiscardedDuplicates(engine, downloads);
  const entries = collectV2Entries(downloads, library);
  sink.applyEntries(entries);
  return entries.length;
}

/**
 * Subscribes to the engine's persisted-state events. Returns the unsubscribe. Records are the only authority:
 * nothing here invents a state, a progress value or a library item.
 */
export function subscribeV2Downloads(
  engine: V2EnginePort,
  sink: V2BridgeSink,
  options: { now?: () => number; appState?: () => string } = {},
): () => void {
  const now = options.now ?? Date.now;
  const appState = options.appState ?? currentAppState;
  const notifier = createCompletionNotifier();
  const duplicates = createCompletionNotifier();
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
      if (isDiscardedDuplicate(record)) {
        // The user already has this video: say so, and keep no failed row for a copy that was discarded.
        sink.removeEntries([record.id]);
        forgetDiscardedDuplicates(engine, [record]);
        const announce = duplicates.claim({ downloadId: record.id, appState: appState(), playable: true, now: now() });
        if (announce && sink.announceDuplicate) {
          try {
            sink.announceDuplicate(record.id);
          } catch {
            // A notice must never disturb the download bridge.
          }
        }
        return;
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
          if (!item || !sink.announceCompleted) {
            return;
          }
          // Never navigates or plays: the user stays on the screen they are using.
          const announce = notifier.claim({
            downloadId: record.id,
            appState: appState(),
            playable: Boolean(item.fileUri),
            now: now(),
          });
          if (announce) {
            try {
              sink.announceCompleted(record.id);
            } catch {
              // A notice must never disturb the download bridge.
            }
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
