/**
 * Week 8 Day 1 Phase 2 — Folder UX verification (mobile).
 *
 * Pure logic / fixtures. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week8-day1-phase2.ts
 */
import { assembleCanonicalItems } from '../src/library/assemble';
import { applyProductFilter, isRecentlyDownloaded } from '../src/library/query';
import { UNFILED_FOLDER_SELECTION_ID } from '../src/library/constants';
import type { MediaLibraryItem, MediaLibraryRemoteItem } from '../src/library/types';
import type { FileAssessment } from '../src/library/assemble';

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

function remoteItem(input: {
  id: string;
  folderId: string | null;
  folderName: string | null;
  downloadedAt: string | null;
}): MediaLibraryRemoteItem {
  return {
    id: input.id,
    downloadId: input.id,
    displayName: `Item ${input.id}`,
    fileName: `item-${input.id}.mp4`,
    mimeType: 'video/mp4',
    fileSize: '1000',
    quality: '1080p',
    resolution: '1920x1080',
    bitrate: 1_000_000,
    duration: null,
    downloadedAt: input.downloadedAt,
    favorite: false,
    folderId: input.folderId,
    folderName: input.folderName,
    thumbnailUrl: null,
  };
}

function findById(items: readonly MediaLibraryItem[], id: string): MediaLibraryItem {
  const found = items.find((x) => x.id === id);
  if (!found) {
    throw new Error(`Missing item ${id}`);
  }
  return found;
}

async function main(): Promise<void> {
  console.log('Week 8 Day 1 Phase 2 — mobile folder verifier\n');

  const nowMs = Date.parse('2026-08-19T00:00:00.000Z');
  const recentWindowMs = 7 * 24 * 60 * 60 * 1000;

  const folderA = '11111111-1111-1111-1111-111111111111';
  const folderAName = 'My Folder';
  const folderOther = '22222222-2222-2222-2222-222222222222';

  await test('folder override null => unfiled folderName', () => {
    const items = assembleCanonicalItems({
      downloads: [],
      records: [],
      transfers: {},
      favoriteKeys: new Set(),
      assessments: {
        m1: { availability: 'available', verifiedBytes: null },
      } satisfies Record<string, FileAssessment>,
      remoteById: {
        m1: remoteItem({
          id: 'm1',
          folderId: folderOther,
          folderName: null, // important: lets override drive folderName
          downloadedAt: null,
        }),
      } satisfies Record<string, MediaLibraryRemoteItem>,
      folderIdByMediaId: {
        m1: null,
      },
      folderNameByFolderId: {
        [folderOther]: 'Other Folder',
        [folderA]: folderAName,
      },
    });

    const item = findById(items, 'm1');
    assert(item.folderId === null, 'folderId null');
    assert(item.folderName === 'Downloads / Unfiled', 'folderName defaults');
  });

  await test('folder override id => folderName from cached map', () => {
    const items = assembleCanonicalItems({
      downloads: [],
      records: [],
      transfers: {},
      favoriteKeys: new Set(),
      assessments: {
        m2: { availability: 'available', verifiedBytes: null },
      } satisfies Record<string, FileAssessment>,
      remoteById: {
        m2: remoteItem({
          id: 'm2',
          folderId: folderOther,
          folderName: null, // important: lets override drive folderName
          downloadedAt: null,
        }),
      } satisfies Record<string, MediaLibraryRemoteItem>,
      folderIdByMediaId: {
        m2: folderA,
      },
      folderNameByFolderId: {
        [folderA]: folderAName,
      },
    });

    const item = findById(items, 'm2');
    assert(item.folderId === folderA, 'folderId matches override');
    assert(item.folderName === folderAName, 'folderName from map');
  });

  await test('applyProductFilter: folder sentinel unfiled', () => {
    const items = [
      {
        id: 'x1',
        downloadId: 'x1',
        displayName: 'x1',
        fileName: 'x1.mp4',
        mimeType: null,
        fileSize: '100',
        quality: '1080p',
        resolution: '1920x1080',
        bitrate: 1,
        duration: null,
        downloadedAt: null,
        favorite: false,
        folderId: null,
        folderName: 'Downloads / Unfiled',
        thumbnailUri: null,
        lastPlayedAt: null,
        progressPercent: null,
        positionSeconds: null,
        completed: false,
        localAvailability: 'available',
      },
      {
        id: 'x2',
        downloadId: 'x2',
        displayName: 'x2',
        fileName: 'x2.mp4',
        mimeType: null,
        fileSize: '100',
        quality: '1080p',
        resolution: '1920x1080',
        bitrate: 1,
        duration: null,
        downloadedAt: null,
        favorite: false,
        folderId: folderA,
        folderName: folderAName,
        thumbnailUri: null,
        lastPlayedAt: null,
        progressPercent: null,
        positionSeconds: null,
        completed: false,
        localAvailability: 'available',
      },
    ] satisfies MediaLibraryItem[];

    const filtered = applyProductFilter(items, {
      filter: 'folder',
      quality: null,
      folderId: UNFILED_FOLDER_SELECTION_ID,
      recentDownloadWindowMs: recentWindowMs,
      nowMs,
    });

    assert(filtered.length === 1, 'keeps only unfiled');
    assert(filtered[0].id === 'x1', 'kept item');
  });

  await test('applyProductFilter: folder custom id', () => {
    const items = [
      {
        id: 'y1',
        downloadId: 'y1',
        displayName: 'y1',
        fileName: 'y1.mp4',
        mimeType: null,
        fileSize: '100',
        quality: '1080p',
        resolution: '1920x1080',
        bitrate: 1,
        duration: null,
        downloadedAt: null,
        favorite: false,
        folderId: folderA,
        folderName: folderAName,
        thumbnailUri: null,
        lastPlayedAt: null,
        progressPercent: null,
        positionSeconds: null,
        completed: false,
        localAvailability: 'available',
      },
      {
        id: 'y2',
        downloadId: 'y2',
        displayName: 'y2',
        fileName: 'y2.mp4',
        mimeType: null,
        fileSize: '100',
        quality: '1080p',
        resolution: '1920x1080',
        bitrate: 1,
        duration: null,
        downloadedAt: null,
        favorite: false,
        folderId: null,
        folderName: 'Downloads / Unfiled',
        thumbnailUri: null,
        lastPlayedAt: null,
        progressPercent: null,
        positionSeconds: null,
        completed: false,
        localAvailability: 'available',
      },
    ] satisfies MediaLibraryItem[];

    const filtered = applyProductFilter(items, {
      filter: 'folder',
      quality: null,
      folderId: folderA,
      recentDownloadWindowMs: recentWindowMs,
      nowMs,
    });

    assert(filtered.length === 1, 'keeps only matching folder');
    assert(filtered[0].id === 'y1', 'kept item');
  });

  await test('isRecentlyDownloaded: invalid/missing date => false', () => {
    const valid: MediaLibraryItem = {
      id: 'r1',
      downloadId: 'r1',
      displayName: 'r1',
      fileName: 'r1.mp4',
      mimeType: null,
      fileSize: '100',
      quality: '1080p',
      resolution: '1920x1080',
      bitrate: 1,
      duration: null,
      downloadedAt: '2026-08-18T00:00:00.000Z',
      favorite: false,
      folderId: null,
      folderName: 'Downloads / Unfiled',
      thumbnailUri: null,
      lastPlayedAt: null,
      progressPercent: null,
      positionSeconds: null,
      completed: false,
      localAvailability: 'available',
    };

    const invalid: MediaLibraryItem = {
      ...valid,
      id: 'r2',
      downloadId: 'r2',
      downloadedAt: 'not-a-date',
    };

    const missing: MediaLibraryItem = { ...valid, id: 'r3', downloadId: 'r3', downloadedAt: null };

    assert(
      isRecentlyDownloaded(valid, nowMs, recentWindowMs) === true,
      'valid included',
    );
    assert(
      isRecentlyDownloaded(invalid, nowMs, recentWindowMs) === false,
      'invalid excluded',
    );
    assert(
      isRecentlyDownloaded(missing, nowMs, recentWindowMs) === false,
      'missing excluded',
    );
  });

  await test('applyProductFilter: recently_downloaded uses downloadedAt only', () => {
    const items: MediaLibraryItem[] = [
      {
        id: 'd1',
        downloadId: 'd1',
        displayName: 'd1',
        fileName: 'd1.mp4',
        mimeType: null,
        fileSize: '100',
        quality: '1080p',
        resolution: '1920x1080',
        bitrate: 1,
        duration: null,
        downloadedAt: '2026-08-18T00:00:00.000Z',
        favorite: false,
        folderId: null,
        folderName: 'Downloads / Unfiled',
        thumbnailUri: null,
        lastPlayedAt: null,
        progressPercent: null,
        positionSeconds: null,
        completed: false,
        localAvailability: 'available',
      },
      {
        id: 'd2',
        downloadId: 'd2',
        displayName: 'd2',
        fileName: 'd2.mp4',
        mimeType: null,
        fileSize: '100',
        quality: '1080p',
        resolution: '1920x1080',
        bitrate: 1,
        duration: null,
        downloadedAt: '2026-07-01T00:00:00.000Z', // outside window
        favorite: false,
        folderId: null,
        folderName: 'Downloads / Unfiled',
        thumbnailUri: null,
        lastPlayedAt: null,
        progressPercent: null,
        positionSeconds: null,
        completed: false,
        localAvailability: 'available',
      },
    ];

    const filtered = applyProductFilter(items, {
      filter: 'recently_downloaded',
      quality: null,
      folderId: null,
      recentDownloadWindowMs: recentWindowMs,
      nowMs,
    });

    assert(filtered.map((x) => x.id).join(',') === 'd1', 'keeps only recent');
  });

  console.log('\n------------------------------------------');
  console.log(`Week 8 Day 1 Phase 2 (mobile) — passed ${passed}, failed ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();

