/**
 * Week 8 Day 1 Phase 1 — Media Library Core verification (mobile).
 * Pure logic / fixtures. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-day1-phase1.ts
 */

import { assembleCanonicalItems, buildCanonicalLibrary, type FileAssessment } from '../src/library/assemble';
import { LIBRARY_RECENT_DOWNLOAD_WINDOW_MS } from '../src/library/constants';
import {
  isLibraryCandidate,
  isTempOrWorkspaceArtifact,
} from '../src/library/eligibility';
import { mapToMediaLibraryItem } from '../src/library/mapper';
import {
  applyLibraryQuery,
  matchesLibrarySearch,
  normalizeSearchQuery,
  sortLibraryItems,
} from '../src/library/query';
import type { LibraryBuildSource, MediaLibraryItem } from '../src/library/types';
import type { DownloadItem } from '../src/api/types';

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
    source({
      downloadId: overrides.id,
      ...(overrides.displayName != null ? { title: overrides.displayName } : {}),
      ...(overrides.fileName != null ? { fileName: overrides.fileName } : {}),
      ...(overrides.fileSize != null ? { fileSize: overrides.fileSize } : {}),
      ...(overrides.quality !== undefined ? { quality: overrides.quality } : {}),
      ...(overrides.downloadedAt !== undefined
        ? { downloadedAt: overrides.downloadedAt }
        : {}),
      ...(overrides.favorite != null ? { favorite: overrides.favorite } : {}),
      ...(overrides.folderName !== undefined
        ? { folderName: overrides.folderName }
        : {}),
      ...(overrides.folderId !== undefined ? { folderId: overrides.folderId } : {}),
      localAvailability: overrides.localAvailability ?? 'available',
    }),
  );
  assert(mapped, 'fixture must map');
  return { ...mapped, ...overrides, downloadId: overrides.downloadId ?? overrides.id };
}

async function main(): Promise<void> {
  console.log('Week 8 Day 1 Phase 1 — mobile media library verifier\n');

  await test('completed verified file appears', () => {
    const mapped = mapToMediaLibraryItem(source({ downloadId: 'dl-ok' }));
    assert(mapped, 'mapped');
    assert(mapped.id === 'dl-ok', 'id');
    assert(mapped.downloadId === 'dl-ok', 'downloadId');
    assert(mapped.displayName === 'Travel Vlog', 'name');
    assert(mapped.localAvailability === 'available', 'available');
    assert(!('localUri' in mapped), 'no localUri on presentation item');
    assert(!('sourceUrl' in mapped), 'no sourceUrl on presentation item');
  });

  await test('queued excluded', () => {
    assert(
      mapToMediaLibraryItem(source({ downloadId: 'q', status: 'QUEUED' })) ===
        null,
      'queued',
    );
  });

  await test('downloading excluded', () => {
    assert(
      mapToMediaLibraryItem(
        source({ downloadId: 'd', status: 'DOWNLOADING', localState: 'transferring' }),
      ) === null,
      'downloading',
    );
  });

  await test('paused excluded', () => {
    assert(
      mapToMediaLibraryItem(
        source({ downloadId: 'p', status: 'PAUSED', localState: 'paused' }),
      ) === null,
      'paused',
    );
  });

  await test('failed excluded', () => {
    assert(
      mapToMediaLibraryItem(source({ downloadId: 'f', status: 'FAILED' })) ===
        null,
      'failed',
    );
  });

  await test('cancelled excluded', () => {
    assert(
      mapToMediaLibraryItem(source({ downloadId: 'c', status: 'CANCELLED' })) ===
        null,
      'cancelled',
    );
  });

  await test('RETRY_WAIT excluded', () => {
    assert(
      mapToMediaLibraryItem(source({ downloadId: 'r', status: 'RETRY_WAIT' })) ===
        null,
      'retry wait',
    );
    assert(
      isLibraryCandidate({
        downloadId: 'r',
        status: 'RETRY_WAIT',
      }) === false,
      'candidate',
    );
  });

  await test('HLS workspace excluded', () => {
    assert(
      isTempOrWorkspaceArtifact(
        'file:///mock/VidoraXDownloads/dl/.hls/segment-000001',
        'segment-000001',
      ),
      'hls marker',
    );
    assert(
      mapToMediaLibraryItem(
        source({
          downloadId: 'hls',
          localUri: 'file:///mock/VidoraXDownloads/hls/.hls/assemble.tmp',
          fileName: 'assemble.tmp',
        }),
      ) === null,
      'hls mapped',
    );
  });

  await test('multi-range part excluded', () => {
    assert(
      isTempOrWorkspaceArtifact(
        'file:///mock/VidoraXDownloads/dl/.mranges/part-000',
        'part-000',
      ),
      'mranges',
    );
    assert(
      mapToMediaLibraryItem(
        source({
          downloadId: 'mr',
          localUri: 'file:///mock/VidoraXDownloads/mr/video.mp4.rangepart',
          fileName: 'video.mp4.rangepart',
        }),
      ) === null,
      'rangepart',
    );
  });

  await test('missing final file excluded from playable query', () => {
    const canonical = buildCanonicalLibrary([
      source({
        downloadId: 'gone',
        localAvailability: 'missing',
        localState: 'complete',
      }),
    ]);
    assert(canonical.length === 1, 'kept in canonical');
    const visible = applyLibraryQuery(canonical, {
      search: '',
      filter: 'all',
      sort: 'newest',
      quality: null,
      folderId: null,
      recentDownloadWindowMs: LIBRARY_RECENT_DOWNLOAD_WINDOW_MS,
      nowMs: Date.parse('2026-08-10T00:00:00.000Z'),
    });
    assert(visible.items.length === 0, 'excluded from playable');
    assert(visible.playableCount === 0, 'playable count');
  });

  await test('duplicate metadata does not duplicate media item', () => {
    const items = buildCanonicalLibrary([
      source({ downloadId: 'dup', title: 'A', downloadedAt: '2026-08-01T00:00:00.000Z' }),
      source({ downloadId: 'dup', title: 'B', downloadedAt: '2026-08-02T00:00:00.000Z' }),
    ]);
    assert(items.length === 1, 'one item');
    assert(items[0]?.displayName === 'B', 'newer metadata wins');
  });

  await test('malformed record rejected safely', () => {
    assert(mapToMediaLibraryItem(null) === null, 'null');
    assert(mapToMediaLibraryItem({}) === null, 'empty');
    assert(
      mapToMediaLibraryItem(source({ downloadId: 'x', fileName: '', title: '' })) ===
        null,
      'no name',
    );
  });

  await test('does not invent quality duration or fake thumbnail', () => {
    const mapped = mapToMediaLibraryItem(
      source({
        downloadId: 'sparse',
        quality: null,
        resolution: 'nope',
        bitrate: 0,
        duration: null,
        thumbnailUrl: 'file:///data/user/0/thumb.jpg',
      }),
    );
    assert(mapped, 'mapped');
    assert(mapped.quality === null, 'quality');
    assert(mapped.resolution === null, 'bad resolution dropped');
    assert(mapped.bitrate === null, 'bitrate');
    assert(mapped.duration === null, 'duration');
    assert(mapped.thumbnailUri === null, 'device thumb dropped');
    assert(mapped.lastPlayedAt === null, 'no fake watch history');
  });

  await test('search title filename quality folder case and whitespace', () => {
    const rows = [
      item({
        id: '1',
        displayName: 'Travel Vlog',
        fileName: 'holiday_cut.mp4',
        quality: '1080p',
        folderName: 'Trips',
      }),
      item({
        id: '2',
        displayName: 'React Course',
        fileName: 'lesson.mp4',
        quality: '720p',
        folderName: 'Learn',
      }),
    ];
    const q = normalizeSearchQuery('  TRAVEL   ');
    assert(q === 'travel', 'normalized');
    assert(matchesLibrarySearch(rows[0]!, q), 'title');
    assert(matchesLibrarySearch(rows[0]!, 'holiday_cut'), 'filename');
    assert(matchesLibrarySearch(rows[0]!, '1080p'), 'quality');
    assert(matchesLibrarySearch(rows[0]!, 'trips'), 'folder');
    assert(!matchesLibrarySearch(rows[1]!, q), 'no false match');

    const none = applyLibraryQuery(rows, {
      search: '   xyzzy   ',
      filter: 'all',
      sort: 'newest',
      quality: null,
      folderId: null,
      recentDownloadWindowMs: LIBRARY_RECENT_DOWNLOAD_WINDOW_MS,
      nowMs: Date.parse('2026-08-10T00:00:00.000Z'),
    });
    assert(none.items.length === 0, 'no results');
  });

  await test('sort newest oldest name size', () => {
    const rows = [
      item({
        id: 'b',
        displayName: 'Beta',
        fileSize: '200',
        downloadedAt: '2026-08-02T00:00:00.000Z',
      }),
      item({
        id: 'a',
        displayName: 'Alpha',
        fileSize: '50',
        downloadedAt: '2026-08-01T00:00:00.000Z',
      }),
      item({
        id: 'c',
        displayName: 'Gamma',
        fileSize: '1000',
        downloadedAt: '2026-08-03T00:00:00.000Z',
      }),
    ];
    assert(
      sortLibraryItems(rows, 'newest').map((row) => row.id).join(',') === 'c,b,a',
      'newest',
    );
    assert(
      sortLibraryItems(rows, 'oldest').map((row) => row.id).join(',') === 'a,b,c',
      'oldest',
    );
    assert(
      sortLibraryItems(rows, 'name_asc').map((row) => row.id).join(',') === 'a,b,c',
      'az',
    );
    assert(
      sortLibraryItems(rows, 'name_desc').map((row) => row.id).join(',') === 'c,b,a',
      'za',
    );
    assert(
      sortLibraryItems(rows, 'largest').map((row) => row.id).join(',') === 'c,b,a',
      'largest',
    );
    assert(
      sortLibraryItems(rows, 'smallest').map((row) => row.id).join(',') === 'a,b,c',
      'smallest',
    );
  });

  await test('recently played unavailable falls back without fabricating', () => {
    const rows = [
      item({
        id: 'n1',
        displayName: 'New',
        downloadedAt: '2026-08-03T00:00:00.000Z',
        lastPlayedAt: null,
    progressPercent: null,
    positionSeconds: null,
    completed: false,
      }),
      item({
        id: 'n0',
        displayName: 'Old',
        downloadedAt: '2026-08-01T00:00:00.000Z',
        lastPlayedAt: null,
    progressPercent: null,
    positionSeconds: null,
    completed: false,
      }),
    ];
    const played = sortLibraryItems(rows, 'recently_played').map((row) => row.id);
    const newest = sortLibraryItems(rows, 'newest').map((row) => row.id);
    assert(played.join(',') === newest.join(','), 'fallback to newest');
    assert(rows.every((row) => row.lastPlayedAt === null), 'not fabricated');
  });

  await test('filters favorites recently downloaded quality folder recently watched', () => {
    const now = Date.parse('2026-08-10T00:00:00.000Z');
    const rows = [
      item({
        id: 'fav',
        displayName: 'Fav',
        favorite: true,
        quality: '1080p',
        downloadedAt: '2026-08-09T00:00:00.000Z',
        folderId: 'folder-1',
        folderName: 'Trips',
      }),
      item({
        id: 'old',
        displayName: 'Old',
        favorite: false,
        quality: '720p',
        downloadedAt: '2026-07-01T00:00:00.000Z',
        folderId: null,
      }),
    ];
    const query = {
      search: '',
      sort: 'newest' as const,
      quality: null as string | null,
      folderId: null as string | null,
      recentDownloadWindowMs: LIBRARY_RECENT_DOWNLOAD_WINDOW_MS,
      nowMs: now,
    };
    assert(
      applyLibraryQuery(rows, { ...query, filter: 'favorites' }).items.map((row) => row.id).join(',') ===
        'fav',
      'favorites',
    );
    assert(
      applyLibraryQuery(rows, { ...query, filter: 'recently_downloaded' }).items.map((row) => row.id).join(',') ===
        'fav',
      'recently downloaded',
    );
    assert(
      applyLibraryQuery(rows, { ...query, filter: 'quality', quality: '1080p' }).items.map((row) => row.id).join(',') ===
        'fav',
      'quality',
    );
    assert(
      applyLibraryQuery(rows, { ...query, filter: 'folder', folderId: 'folder-1' }).items.map((row) => row.id).join(',') ===
        'fav',
      'folder',
    );
    assert(
      applyLibraryQuery(rows, { ...query, filter: 'recently_watched' }).items.length === 0,
      'recently watched empty',
    );
  });

  await test('combined favorites + 1080p + search + newest is deterministic', () => {
    const rows = [
      item({
        id: 'z',
        displayName: 'Zebra 1080',
        favorite: true,
        quality: '1080p',
        downloadedAt: '2026-08-01T00:00:00.000Z',
      }),
      item({
        id: 'a',
        displayName: 'Alpha 1080',
        favorite: true,
        quality: '1080p',
        downloadedAt: '2026-08-03T00:00:00.000Z',
      }),
      item({
        id: 'skip-fav',
        displayName: 'Alpha 720',
        favorite: true,
        quality: '720p',
        downloadedAt: '2026-08-04T00:00:00.000Z',
      }),
      item({
        id: 'skip-not-fav',
        displayName: 'Alpha 1080 public',
        favorite: false,
        quality: '1080p',
        downloadedAt: '2026-08-05T00:00:00.000Z',
      }),
    ];
    const query = {
      search: '  Alpha ',
      filter: 'favorites' as const,
      quality: '1080p',
      folderId: null,
      sort: 'newest' as const,
      recentDownloadWindowMs: LIBRARY_RECENT_DOWNLOAD_WINDOW_MS,
      nowMs: Date.parse('2026-08-10T00:00:00.000Z'),
    };
    const first = applyLibraryQuery(rows, query);
    const second = applyLibraryQuery(rows, query);
    assert(first.items.map((row) => row.id).join(',') === 'a', 'composed result');
    assert(
      first.items.map((row) => row.id).join(',') ===
        second.items.map((row) => row.id).join(','),
      'deterministic',
    );
  });

  await test('assembleCanonicalItems uses download id identity and assessments', () => {
    const downloads: DownloadItem[] = [
      {
        id: 'dl-1',
        userId: 'u1',
        title: 'One',
        sourceUrl: 'https://cdn.example.com/one.mp4',
        platform: 'OTHER',
        thumbnailUrl: 'https://cdn.example.com/t.jpg',
        fileName: 'one.mp4',
        fileSize: '10',
        folderId: null,
        status: 'COMPLETED',
        progress: 100,
        quality: '720p',
        resolution: '1280x720',
        bitrate: 1000,
        retryCount: 0,
        workerState: 'COMPLETED',
        errorCode: null,
        errorMessage: null,
        downloadedAt: '2026-08-01T00:00:00.000Z',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'dl-queued',
        userId: 'u1',
        title: 'Queued',
        sourceUrl: 'https://cdn.example.com/q.mp4',
        platform: 'OTHER',
        thumbnailUrl: 'https://cdn.example.com/t.jpg',
        fileName: 'q.mp4',
        fileSize: '10',
        folderId: null,
        status: 'QUEUED',
        progress: 0,
        quality: null,
        resolution: null,
        bitrate: null,
        retryCount: 0,
        workerState: 'WAITING',
        errorCode: null,
        errorMessage: null,
        downloadedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ];
    const records: [] = [];
    const assessments: Record<string, FileAssessment> = {
      'dl-1': { availability: 'available', verifiedBytes: 10 },
    };
    const assembled = assembleCanonicalItems({
      downloads,
      records,
      transfers: {},
      remoteById: {},
      favoriteKeys: new Set(),
      assessments,
    });
    assert(assembled.length === 1, 'only completed');
    assert(assembled[0]?.id === 'dl-1', 'id');
  });

  await test('performance search/sort 100 and 500 items', () => {
    const make = (count: number): MediaLibraryItem[] =>
      Array.from({ length: count }, (_, index) =>
        item({
          id: `id-${String(index).padStart(4, '0')}`,
          displayName: `Video ${index} ${index % 2 === 0 ? 'Alpha' : 'Beta'}`,
          fileName: `file-${index}.mp4`,
          quality: index % 3 === 0 ? '1080p' : '720p',
          fileSize: String(1000 + index),
          downloadedAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
          favorite: index % 5 === 0,
        }),
      );

    const run = (rows: MediaLibraryItem[]) => {
      const start = Date.now();
      const result = applyLibraryQuery(rows, {
        search: 'alpha',
        filter: 'favorites',
        sort: 'newest',
        quality: null,
        folderId: null,
        recentDownloadWindowMs: LIBRARY_RECENT_DOWNLOAD_WINDOW_MS,
        nowMs: Date.now(),
      });
      return { ms: Date.now() - start, count: result.items.length };
    };

    const hundred = run(make(100));
    const fiveHundred = run(make(500));
    assert(hundred.ms < 50, `100 items too slow: ${hundred.ms}ms`);
    assert(fiveHundred.ms < 150, `500 items too slow: ${fiveHundred.ms}ms`);
    const ids = applyLibraryQuery(make(100), {
      search: '',
      filter: 'all',
      sort: 'newest',
      quality: null,
      folderId: null,
      recentDownloadWindowMs: LIBRARY_RECENT_DOWNLOAD_WINDOW_MS,
      nowMs: Date.now(),
    }).items.map((row) => row.id);
    assert(new Set(ids).size === ids.length, 'stable unique keys');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
