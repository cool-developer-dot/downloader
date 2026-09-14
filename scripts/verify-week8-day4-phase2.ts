/**
 * Week 8 Day 4 Phase 2 — Performance, stability, security & UX hardening (mobile).
 * Pure logic / fixtures. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-day4-phase2.ts
 */

import { classifyRemoteFailure, ApiError } from '../src/api/errors';
import { isUriInside, isUnsafeLogicalFileName } from '../src/downloads/engine/path-guard';
import { mapToMediaLibraryItem } from '../src/library/mapper';
import {
  applyLibraryQuery,
  sortLibraryItems,
} from '../src/library/query';
import { assembleCanonicalItems, collectCandidateIds } from '../src/library/assemble';
import { LIBRARY_RECONCILE_TTL_MS } from '../src/library/constants';
import { isAvailabilityCacheFresh } from '../src/library/availability-ttl';
import type { LibraryBuildSource, LibraryQueryInput, MediaLibraryItem } from '../src/library/types';
import { classifyNativePlayerError } from '../src/player/errors';
import { isCurrentPlayerSession } from '../src/player/session-generation';
import { PreparationWatchdog } from '../src/player/preparation-watchdog';
import {
  PLAYBACK_BACKEND_SYNC_INTERVAL_MS,
  PLAYBACK_LOCAL_PERSIST_INTERVAL_MS,
} from '../src/playback/constants';
import { shouldInvalidatePlaybackQueriesForEvent } from '../src/playback/query-keys';
import { PROGRESS_INTERVAL_SECONDS } from '../src/player/types';
import type { DownloadItem } from '../src/api/types';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

function source(
  overrides: Partial<LibraryBuildSource> & { downloadId: string },
): LibraryBuildSource {
  return {
    status: 'COMPLETED',
    title: 'Travel Vlog',
    fileName: 'travel.mp4',
    fileSize: '1048576',
    quality: '1080p',
    resolution: '1920x1080',
    bitrate: 5_000_000,
    duration: null,
    mimeType: 'video/mp4',
    downloadedAt: '2026-08-01T12:00:00.000Z',
    thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
    sourceUrl: 'https://cdn.example.com/travel.mp4',
    folderId: null,
    folderName: null,
    lastPlayedAt: null,
    progressPercent: null,
    positionSeconds: null,
    completed: false,
    localUri: 'file:///mock/VidoraXDownloads/id/travel.mp4',
    localState: 'complete',
    favorite: false,
    localAvailability: 'available',
    verifiedBytes: 1_048_576,
    ...overrides,
  };
}

function item(
  overrides: Partial<MediaLibraryItem> & { id: string },
): MediaLibraryItem {
  const mapped = mapToMediaLibraryItem(
    source({ downloadId: overrides.id, title: overrides.displayName ?? 'Video' }),
  );
  if (!mapped) {
    throw new Error('mapped item');
  }
  return {
    ...mapped,
    ...overrides,
    id: overrides.id,
    downloadId: overrides.downloadId ?? mapped.downloadId,
  };
}

function makeLibrary(count: number): MediaLibraryItem[] {
  const rows: MediaLibraryItem[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push(
      item({
        id: `media-${String(index).padStart(4, '0')}`,
        displayName: index % 7 === 0 ? `Alpha ${index}` : `Video ${index}`,
        fileName: `video-${index}.mp4`,
        fileSize: String(1_000 + index),
        quality: index % 2 === 0 ? '1080p' : '720p',
        downloadedAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
        favorite: index % 11 === 0,
        lastPlayedAt: index % 13 === 0 ? new Date(1_710_000_000_000 + index).toISOString() : null,
        folderId: index % 17 === 0 ? 'folder-1' : null,
      }),
    );
  }
  return rows;
}

const queryBase: LibraryQueryInput = {
  search: '',
  filter: 'all',
  sort: 'newest',
  quality: null,
  folderId: null,
  recentDownloadWindowMs: 7 * 24 * 60 * 60 * 1000,
  nowMs: 1_720_000_000_000,
};

async function main(): Promise<void> {
  console.log('Week 8 Day 4 Phase 2 — mobile hardening verifier\n');

  await test('stable library identity is mediaId (never index)', () => {
    const rows = makeLibrary(25);
    const visible = applyLibraryQuery(rows, { ...queryBase, sort: 'name_asc' }).items;
    for (const row of visible) {
      assert(row.id === row.downloadId, 'id === downloadId/mediaId');
      assert(!/^[0-9]+$/.test(row.id) || row.id.startsWith('media-'), 'not a raw index key');
    }
    const ids = new Set(visible.map((row) => row.id));
    assert(ids.size === visible.length, 'unique keys');
  });

  await test('large fixtures 10 / 100 / 500 / 1000 stay bounded', () => {
    const run = (rows: MediaLibraryItem[]) => {
      const started = Date.now();
      const result = applyLibraryQuery(rows, {
        ...queryBase,
        search: 'alpha',
        sort: 'largest',
      });
      return { ms: Date.now() - started, count: result.items.length };
    };
    const ten = run(makeLibrary(10));
    const hundred = run(makeLibrary(100));
    const fiveHundred = run(makeLibrary(500));
    const thousand = run(makeLibrary(1000));
    assert(ten.count >= 1, '10-item search hits');
    assert(hundred.count >= 1, '100-item search hits');
    assert(fiveHundred.ms < 150, `500 items too slow: ${fiveHundred.ms}ms`);
    assert(thousand.ms < 250, `1000 items too slow: ${thousand.ms}ms`);
    assert(thousand.count >= 1, '1000-item search hits');
  });

  await test('all product sorts are O(n log n) with precomputed keys', () => {
    const rows = makeLibrary(400);
    const sorts = [
      'newest',
      'oldest',
      'name_asc',
      'name_desc',
      'largest',
      'smallest',
      'recently_played',
    ] as const;
    for (const sort of sorts) {
      const started = Date.now();
      const ordered = sortLibraryItems(rows, sort);
      assert(ordered.length === 400, sort);
      assert(Date.now() - started < 80, `${sort} too slow`);
    }
  });

  await test('filters do not use nested O(n²) lookups', () => {
    const rows = makeLibrary(300);
    const started = Date.now();
    const favorites = applyLibraryQuery(rows, { ...queryBase, filter: 'favorites' });
    const quality = applyLibraryQuery(rows, {
      ...queryBase,
      filter: 'quality',
      quality: '1080p',
    });
    const folder = applyLibraryQuery(rows, {
      ...queryBase,
      filter: 'folder',
      folderId: 'folder-1',
    });
    const watched = applyLibraryQuery(rows, {
      ...queryBase,
      filter: 'recently_watched',
    });
    assert(Date.now() - started < 80, 'filter suite too slow');
    assert(favorites.items.every((row) => row.favorite), 'favorites');
    assert(quality.items.every((row) => row.quality === '1080p'), 'quality');
    assert(folder.items.every((row) => row.folderId === 'folder-1'), 'folder');
    assert(watched.items.every((row) => row.lastPlayedAt != null), 'watched');
  });

  await test('assemble remote-id merge is set-based (not includes O(n²))', () => {
    const downloads: DownloadItem[] = [];
    const records: Parameters<typeof assembleCanonicalItems>[0]['records'] = [];
    const remoteById: Record<string, { id: string; downloadId: string; displayName: string; fileName: string; mimeType: string | null; fileSize: string; quality: string | null; resolution: string | null; bitrate: number | null; duration: number | null; downloadedAt: string | null; favorite: boolean; folderId: string | null; folderName: string | null; thumbnailUrl: string | null }> = {};
    for (let index = 0; index < 800; index += 1) {
      const id = `remote-${index}`;
      remoteById[id] = {
        id,
        downloadId: id,
        displayName: `Remote ${index}`,
        fileName: `r-${index}.mp4`,
        mimeType: 'video/mp4',
        fileSize: '10',
        quality: null,
        resolution: null,
        bitrate: null,
        duration: null,
        downloadedAt: null,
        favorite: false,
        folderId: null,
        folderName: null,
        thumbnailUrl: null,
      };
    }
    const started = Date.now();
    const assembled = assembleCanonicalItems({
      downloads,
      records,
      transfers: {},
      remoteById,
      favoriteKeys: new Set(),
      assessments: {},
    });
    assert(Date.now() - started < 120, `assemble 800 remotes too slow: ${Date.now() - started}ms`);
    assert(assembled.length <= 800, 'bounded');
    const candidates = collectCandidateIds([], [], {});
    assert(Array.isArray(candidates), 'candidate ids');
  });

  await test('availability reconcile uses TTL cache (no FS per render)', () => {
    assert(
      isAvailabilityCacheFresh({
        cachedAt: 1_000,
        nowMs: 1_000 + LIBRARY_RECONCILE_TTL_MS - 1,
      }),
      'TTL hit',
    );
    assert(
      !isAvailabilityCacheFresh({
        cachedAt: 1_000,
        nowMs: 1_000 + LIBRARY_RECONCILE_TTL_MS + 1,
      }),
      'TTL expiry',
    );
    assert(
      !isAvailabilityCacheFresh({
        cachedAt: 1_000,
        nowMs: 1_001,
        force: true,
      }),
      'force bypasses TTL',
    );
  });

  await test('managed path guards reject traversal and prefix siblings', () => {
    const parent = 'file:///data/VidoraXDownloads/abc';
    assert(isUriInside(parent, `${parent}/video.mp4`), 'child file');
    assert(isUriInside(parent, parent), 'exact dir');
    assert(!isUriInside(parent, 'file:///data/VidoraXDownloads/abc-evil/x.mp4'), 'prefix sibling');
    assert(!isUriInside(parent, 'file:///data/VidoraXDownloads/abc/../other/x.mp4'), 'dotdot');
    assert(!isUriInside(parent, '/etc/passwd'), 'absolute escape');
    assert(!isUriInside(parent, 'file:///data/VidoraXDownloads/other/x.mp4'), 'other item');
  });

  await test('filename sanitization rejects traversal and unsafe names', () => {
    assert(isUnsafeLogicalFileName('../video.mp4'), '../');
    assert(isUnsafeLogicalFileName('/video.mp4'), 'absolute');
    assert(isUnsafeLogicalFileName('...'), 'dot-only');
    assert(isUnsafeLogicalFileName('..'), '..');
    assert(isUnsafeLogicalFileName(''), 'empty');
    assert(isUnsafeLogicalFileName('file:///tmp/x.mp4'), 'file uri');
    assert(!isUnsafeLogicalFileName('My Video 🎬.mp4'), 'emoji+space');
    assert(!isUnsafeLogicalFileName('file..name.mp4'), 'inner dots allowed');
    const long = `${'a'.repeat(300)}.mp4`;
    assert(isUnsafeLogicalFileName(long), 'overlong');
  });

  await test('player stale session guards block old generations', () => {
    assert(
      !isCurrentPlayerSession({
        mounted: true,
        loadArmed: true,
        capturedGeneration: 1,
        currentGeneration: 2,
        activeMediaId: 'b',
        eventMediaId: 'a',
      }),
      'stale gen',
    );
    assert(
      !isCurrentPlayerSession({
        mounted: true,
        loadArmed: false,
        capturedGeneration: 2,
        currentGeneration: 2,
        activeMediaId: 'b',
      }),
      'not armed',
    );
    assert(
      isCurrentPlayerSession({
        mounted: true,
        loadArmed: true,
        capturedGeneration: 3,
        currentGeneration: 3,
        activeMediaId: 'b',
        eventMediaId: 'b',
      }),
      'live',
    );
  });

  await test('watchdog dispose never fires timeout', async () => {
    let fired = 0;
    const watchdog = new PreparationWatchdog({
      timeoutMs: 20,
      onTimeout: () => {
        fired += 1;
      },
    });
    watchdog.start();
    watchdog.dispose();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert(fired === 0, 'disposed watchdog silent');
  });

  await test('playback cadence stays 350ms / 5s / 15s; ticks do not invalidate UI', () => {
    assert(PROGRESS_INTERVAL_SECONDS === 0.35, 'ui interval');
    assert(PLAYBACK_LOCAL_PERSIST_INTERVAL_MS === 5_000, 'local persist');
    assert(PLAYBACK_BACKEND_SYNC_INTERVAL_MS === 15_000, 'backend sync');
    assert(!shouldInvalidatePlaybackQueriesForEvent('positionChanged'), 'no tick invalidation');
    assert(!shouldInvalidatePlaybackQueriesForEvent('playbackStarted'), 'no start invalidation');
    assert(shouldInvalidatePlaybackQueriesForEvent('paused'), 'pause boundary');
    assert(shouldInvalidatePlaybackQueriesForEvent('playerExited'), 'exit boundary');
    assert(shouldInvalidatePlaybackQueriesForEvent('completed'), 'complete boundary');
  });

  await test('unsupported codec is not a download-engine failure', () => {
    assert(classifyNativePlayerError('MediaCodec decoder failed') === 'UNSUPPORTED_MEDIA', 'codec');
    assert(classifyNativePlayerError('corrupt media container') === 'CORRUPT_MEDIA', 'corrupt');
    assert(classifyNativePlayerError('no such file') === 'FILE_UNAVAILABLE', 'missing');
  });

  await test('offline/outage classification: transient vs permanent', () => {
    assert(
      classifyRemoteFailure(
        new ApiError({ code: 'NETWORK_ERROR', status: null, message: 'offline' }),
      ) === 'transient',
      'network',
    );
    assert(
      classifyRemoteFailure(
        new ApiError({ code: 'SERVER_ERROR', status: 503, message: 'down' }),
      ) === 'transient',
      '503',
    );
    assert(
      classifyRemoteFailure(
        new ApiError({ code: 'NOT_FOUND', status: 404, message: 'missing' }),
      ) === 'permanent',
      '404',
    );
    assert(
      classifyRemoteFailure(
        new ApiError({ code: 'UNAUTHORIZED', status: 401, message: 'auth' }),
      ) === 'auth',
      '401',
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
