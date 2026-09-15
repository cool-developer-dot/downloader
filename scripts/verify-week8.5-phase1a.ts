/**
 * Week 8.5 Phase 1A — Home dashboard derivation & contracts.
 * Pure logic / static file checks. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8.5-phase1a.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DownloadItem } from '../src/api/types';
import { PLAYBACK_MIN_RESUME_SECONDS } from '../src/playback/constants';
import {
  HOME_COPY,
  HOME_DESTINATIONS,
  HOME_SECTION_LIMIT,
} from '../src/screens/home/constants/home.constants';
import {
  buildHomeGreeting,
  deriveContinueWatchingTiles,
  deriveManagedStorageBytes,
  deriveRecentDownloadTiles,
  deriveRecentlyWatchedTiles,
  homeMediaIdsAreStable,
  type HomeLocalFileMeta,
} from '../src/screens/home/utils/home-derive';
import {
  deriveDownloadActivitySummary,
  selectCompletedCatalogSignature,
  selectDownloadActivitySignature,
} from '../src/store/downloads/selectors';
import type { DownloadsStore } from '../src/store/downloads/types';
import { routePaths } from '../src/navigation/constants/route-paths';
import type { PlaybackSummary } from '../src/playback/domain/merge';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
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

function readSrc(relFromMobile: string): string {
  return readFileSync(join(ROOT, relFromMobile), 'utf8');
}

function download(
  id: string,
  overrides: Partial<DownloadItem> = {},
): DownloadItem {
  return {
    id,
    userId: 'user-1',
    title: `Video ${id}`,
    sourceUrl: `https://cdn.example.com/${id}.mp4`,
    platform: 'OTHER',
    thumbnailUrl: `https://cdn.example.com/${id}.jpg`,
    fileName: `${id}.mp4`,
    folderId: null,
    fileSize: '1048576',
    status: 'COMPLETED',
    progress: 100,
    quality: '1080p',
    resolution: '1920x1080',
    bitrate: 5_000_000,
    retryCount: 0,
    workerState: null,
    errorCode: null,
    errorMessage: null,
    downloadedAt: '2026-08-20T12:00:00.000Z',
    createdAt: '2026-08-20T11:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

function summary(
  mediaId: string,
  overrides: Partial<PlaybackSummary> = {},
): PlaybackSummary {
  return {
    mediaId,
    positionSeconds: 40,
    durationSeconds: 200,
    progressPercent: 20,
    lastPlayedAt: '2026-08-21T10:00:00.000Z',
    completed: false,
    updatedAt: '2026-08-21T10:00:00.000Z',
    pendingSync: false,
    clientRevision: 1,
    ...overrides,
  };
}

function fakeStore(
  items: DownloadItem[],
): Pick<DownloadsStore, 'orderedIds' | 'itemsById' | 'transferById'> {
  const itemsById: Record<string, DownloadItem> = {};
  for (const item of items) {
    itemsById[item.id] = item;
  }
  return {
    orderedIds: items.map((item) => item.id),
    itemsById,
    transferById: {},
  };
}

async function main(): Promise<void> {
await test('placeholder Home copy is removed', () => {
  const screen = readSrc('src/screens/home/HomeScreen.tsx');
  assert(
    !screen.includes('Your VidoraX dashboard. Main features will be linked here.'),
    'placeholder dashboard copy is still present',
  );
  assert(!screen.includes('Home icon'), 'placeholder Home icon copy is still present');
});

await test('Home does not create a parallel data model', () => {
  const homeDir = readSrc('src/screens/home/HomeScreen.tsx');
  assert(!homeDir.includes('HomeHistory'), 'HomeHistory store must not exist');
  assert(!homeDir.includes('RecentHomeVideos'), 'RecentHomeVideos must not exist');
  const derive = readSrc('src/screens/home/utils/home-derive.ts');
  assert(
    derive.includes('isContinueWatchingEligible'),
    'Continue Watching must reuse playback eligibility',
  );
});

await test('Home reuses production download + playback + navigation contracts', () => {
  const screen = readSrc('src/screens/home/HomeScreen.tsx');
  assert(
    screen.includes('useQualitySelection'),
    'Paste link must use existing quality selection',
  );
  const recent = readSrc('src/screens/home/components/HomeRecentDownloads.tsx');
  assert(recent.includes('openPlayer'), 'Recent downloads must open Player');
  assert(recent.includes('routePaths.library'), 'View All must go to Library');
  const browser = readSrc('src/screens/home/components/HomePrimaryActions.tsx');
  assert(browser.includes('routePaths.browser'), 'Open Browser must use routePaths');
  const active = readSrc('src/screens/home/components/HomeActiveDownloads.tsx');
  assert(active.includes('routePaths.downloads'), 'Active summary must open Downloads');
  const header = readSrc('src/screens/home/components/HomeHeader.tsx');
  assert(header.includes('routePaths.settings'), 'Header must open Settings');
  assert(!header.includes('routePaths.profile'), 'Header must not open Profile');
  const watching = readSrc('src/screens/home/components/HomeContinueWatching.tsx');
  assert(watching.includes('openPlayer'), 'Continue Watching must open Player');
  const history = readSrc('src/screens/home/components/HomeRecentlyWatched.tsx');
  assert(history.includes('openPlayer'), 'Recently Watched must open Player');
  const storage = readSrc('src/screens/home/components/HomeStorageSummary.tsx');
  assert(
    storage.includes('routePaths.storage'),
    'Storage must open the existing Storage screen',
  );
});

await test('Home destinations match centralized routePaths', () => {
  assert(HOME_DESTINATIONS.browser === routePaths.browser, 'browser path mismatch');
  assert(HOME_DESTINATIONS.downloads === routePaths.downloads, 'downloads path mismatch');
  assert(HOME_DESTINATIONS.library === routePaths.library, 'library path mismatch');
  assert(HOME_DESTINATIONS.settings === routePaths.settings, 'settings path mismatch');
  assert(
    HOME_DESTINATIONS.downloadSettings === routePaths.downloadSettings,
    'download settings path mismatch',
  );
  assert(
    HOME_DESTINATIONS.watchHistory === routePaths.watchHistory,
    'watch history path mismatch',
  );
});

await test('Home does not subscribe to transfer ticks or scan files on render', () => {
  const hooks = readSrc('src/screens/home/hooks/useHomeDashboard.ts');
  assert(!hooks.includes('transferById'), 'Home must not subscribe to transferById');
  assert(!hooks.includes('reconcileAvailability'), 'Home must not reconcile files');
  assert(!hooks.includes('assessLocalFile'), 'Home must not stat files');
  const derive = readSrc('src/screens/home/utils/home-derive.ts');
  assert(!derive.includes('assessLocalFile'), 'derive must not stat files');
});

await test('greeting is account-free', () => {
  assert(buildHomeGreeting().headline === HOME_COPY.greetingWelcome, 'neutral welcome');
  assert(HOME_COPY.greetingWelcome.includes('VidoraX'), 'branded welcome');
});

await test('recent downloads are bounded and stable by mediaId', () => {
  const completed = Array.from({ length: 12 }, (_, index) =>
    download(`d${index}`, {
      downloadedAt: `2026-08-${String(10 + index).padStart(2, '0')}T12:00:00.000Z`,
    }),
  );
  const tiles = deriveRecentDownloadTiles(completed, {}, HOME_SECTION_LIMIT);
  assert(tiles.length === HOME_SECTION_LIMIT, `expected ${HOME_SECTION_LIMIT}, got ${tiles.length}`);
  assert(homeMediaIdsAreStable(tiles), 'duplicate or empty mediaId');
  assert(tiles[0]?.mediaId === 'd11', 'must sort newest completed first');
});

await test('recent downloads use local engine metadata when store is empty (offline)', () => {
  const local: Record<string, HomeLocalFileMeta> = {
    'local-a': {
      mediaId: 'local-a',
      fileName: 'offline.mp4',
      fileSize: '2048',
      updatedAt: '2026-08-22T09:00:00.000Z',
    },
  };
  const tiles = deriveRecentDownloadTiles([], local, 5);
  assert(tiles.length === 1, 'offline local complete file should appear');
  assert(tiles[0]?.mediaId === 'local-a', 'stable mediaId from local record');
  assert(tiles[0]?.title === 'offline.mp4', 'fileName is the offline title fallback');
});

await test('continue watching reuses eligibility and stays bounded', () => {
  const downloads = {
    a: download('a'),
    b: download('b'),
    done: download('done'),
    early: download('early'),
  };
  const summaries = [
    summary('early', { positionSeconds: PLAYBACK_MIN_RESUME_SECONDS - 1 }),
    summary('done', { completed: true, progressPercent: 100, positionSeconds: 190 }),
    summary('a', { lastPlayedAt: '2026-08-22T12:00:00.000Z' }),
    summary('b', { lastPlayedAt: '2026-08-22T11:00:00.000Z' }),
    summary('missing', { lastPlayedAt: '2026-08-22T13:00:00.000Z' }),
  ];
  const tiles = deriveContinueWatchingTiles(summaries, downloads, {}, 5);
  assert(tiles.every((tile) => tile.mediaId === 'a' || tile.mediaId === 'b'), 'ineligible rows leaked');
  assert(tiles.length === 2, `expected 2 continue tiles, got ${tiles.length}`);
  assert(homeMediaIdsAreStable(tiles), 'continue watching ids must be unique');
  assert(!tiles.some((tile) => tile.completed), 'completed titles are not continue watching');
});

await test('recently watched preserves completed history and bounds the row', () => {
  const downloads = {
    a: download('a'),
    b: download('b'),
    c: download('c'),
    d: download('d'),
    e: download('e'),
    f: download('f'),
  };
  const summaries = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) =>
    summary(id, {
      completed: id === 'a',
      lastPlayedAt: `2026-08-22T${String(15 - index).padStart(2, '0')}:00:00.000Z`,
    }),
  );
  const tiles = deriveRecentlyWatchedTiles(summaries, downloads, {}, 5);
  assert(tiles.length === 5, 'recently watched must cap at 5');
  assert(tiles.some((tile) => tile.mediaId === 'a' && tile.completed), 'completed history dropped');
  assert(homeMediaIdsAreStable(tiles), 'recently watched ids must be unique');
});

await test('download activity uses status fields, not transfer ticks', () => {
  const state = fakeStore([
    download('run', { status: 'DOWNLOADING', progress: 40 }),
    download('run2', { status: 'DOWNLOADING', progress: 80 }),
    download('pause', { status: 'PAUSED', progress: 10 }),
    download('queue', { status: 'QUEUED', progress: 0 }),
    download('done'),
  ]);
  const activity = deriveDownloadActivitySummary(state);
  assert(activity.activeCount === 2, 'active count');
  assert(activity.pausedCount === 1, 'paused count');
  assert(activity.queuedCount === 1, 'queued count');
  assert(activity.averageProgress === 60, 'average of active progress only');

  const signed = selectDownloadActivitySignature(state as DownloadsStore);
  const progressed = fakeStore([
    download('run', { status: 'DOWNLOADING', progress: 41 }),
    download('run2', { status: 'DOWNLOADING', progress: 80 }),
    download('pause', { status: 'PAUSED', progress: 10 }),
    download('queue', { status: 'QUEUED', progress: 0 }),
    download('done'),
  ]);
  const next = selectDownloadActivitySignature(progressed as DownloadsStore);
  assert(signed === next, 'activity signature must ignore progress within the same 5% bucket');
  const crossedBucket = fakeStore([
    download('run', { status: 'DOWNLOADING', progress: 50 }),
    download('run2', { status: 'DOWNLOADING', progress: 80 }),
    download('pause', { status: 'PAUSED', progress: 10 }),
    download('queue', { status: 'QUEUED', progress: 0 }),
    download('done'),
  ]);
  assert(
    signed !== selectDownloadActivitySignature(crossedBucket as DownloadsStore),
    'activity signature must update when average progress crosses a 5% bucket',
  );

  const catalogBefore = selectCompletedCatalogSignature(state as DownloadsStore);
  const catalogAfter = selectCompletedCatalogSignature(progressed as DownloadsStore);
  assert(
    catalogBefore === catalogAfter,
    'completed catalog signature must ignore active progress patches',
  );
});

await test('managed storage is derived from metadata bytes, not a file walk', () => {
  const completed = [
    download('a', { fileSize: '100' }),
    download('b', { fileSize: '250' }),
  ];
  const local: Record<string, HomeLocalFileMeta> = {
    a: {
      mediaId: 'a',
      fileName: 'a.mp4',
      fileSize: '9999',
      updatedAt: '2026-08-22T00:00:00.000Z',
    },
    c: {
      mediaId: 'c',
      fileName: 'c.mp4',
      fileSize: '50',
      updatedAt: '2026-08-22T00:00:00.000Z',
    },
  };
  const total = deriveManagedStorageBytes(completed, local);
  assert(total === 400n, `expected 400 bytes (no double-count), got ${total.toString()}`);
});

await test('empty-state copy matches Phase 1A production strings', () => {
  assert(HOME_COPY.noDownloadsYet === 'No downloads yet', 'downloads empty');
  assert(
    HOME_COPY.noActiveDownloads === 'Nothing downloading right now' ||
      HOME_COPY.noActiveDownloads === 'No active downloads',
    'active empty',
  );
  assert(
    HOME_COPY.noVideosToContinue === 'Nothing playing right now' ||
      HOME_COPY.noVideosToContinue === 'No videos to continue',
    'continue empty',
  );
  assert(HOME_COPY.watchHistoryEmpty === 'Watch history is empty', 'history empty');
  assert(
    HOME_COPY.storageUnavailable === 'Storage details unavailable' ||
      HOME_COPY.storageUnavailable === 'Storage information unavailable',
    'storage empty',
  );
  assert(HOME_SECTION_LIMIT === 5, 'section limit must be 5');
});

console.log('');
console.log(`Week 8.5 Phase 1A: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
}

void main();
