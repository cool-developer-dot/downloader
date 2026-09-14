/**
 * Library completion sync verifier.
 *
 * Covers COMPLETED → Library visibility races:
 * - sticky availability cache must not hide live complete
 * - completion invalidation + resolveFileAssessment
 * - offline local-complete still maps
 * - dedupe by downloadId
 *
 * Run: npx tsx scripts/verify-library-completion-sync.ts
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import {
  assembleCanonicalItems,
  resolveFileAssessment,
  type FileAssessment,
} from '../src/library/assemble';
import { applyLibraryQuery } from '../src/library/query';
import type { DownloadItem } from '../src/api';
import type {
  LocalDownloadRecord,
  TransferProgressSnapshot,
} from '../src/downloads/engine/types';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL  ${name}`);
    console.error(`      ${message}`);
  }
}

const root = path.join(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function completedRecord(id: string): LocalDownloadRecord {
  return {
    downloadId: id,
    sourceUrl: 'https://cdn.example.com/video.mp4',
    fileName: 'video.mp4',
    expectedFileSize: '104857600',
    localUri: `file:///downloads/${id}/video.mp4`,
    localState: 'complete',
    bytesWritten: 104857600,
    totalBytes: 104857600,
    pauseState: null,
    rangeValidators: null,
    generation: 1,
    errorCode: null,
    errorMessage: null,
    remoteStatus: 'COMPLETED',
    retryCount: 0,
    maxRetries: 3,
    retryEligible: true,
    lastAttemptAt: null,
    nextRetryAt: null,
    updatedAt: new Date().toISOString(),
    hlsTransfer: null,
    multiRange: null,
  };
}

function completedDownload(id: string): DownloadItem {
  return {
    id,
    userId: 'u1',
    title: 'Big Video',
    fileName: 'video.mp4',
    status: 'COMPLETED',
    progress: 100,
    fileSize: '104857600',
    sourceUrl: 'https://cdn.example.com/video.mp4',
    platform: 'OTHER',
    quality: null,
    resolution: null,
    bitrate: null,
    thumbnailUrl: '',
    folderId: null,
    downloadedAt: new Date().toISOString(),
    errorCode: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    retryCount: 0,
    workerState: 'COMPLETED',
  };
}

function queryAll() {
  return {
    search: '',
    filter: 'all' as const,
    sort: 'newest' as const,
    quality: null as string | null,
    folderId: null as string | null,
    recentDownloadWindowMs: 7 * 24 * 60 * 60 * 1000,
    nowMs: Date.now(),
  };
}

function completeTransfer(
  id: string,
  localUri: string,
): TransferProgressSnapshot {
  return {
    downloadId: id,
    bytesWritten: 104857600,
    totalBytes: 104857600,
    progress: 100,
    bytesPerSecond: null,
    etaSeconds: 0,
    localUri,
    localState: 'complete',
    errorCode: null,
    errorMessage: null,
  };
}

console.log('Library completion sync verifier\n');

test('resolveFileAssessment: live complete wins over sticky missing', () => {
  const sticky: FileAssessment = {
    availability: 'missing',
    verifiedBytes: null,
  };
  const resolved = resolveFileAssessment(
    sticky,
    completeTransfer('dl-1', 'file:///x/video.mp4'),
    null,
  );
  assert(resolved.availability === 'available', 'must be available');
});

test('resolveFileAssessment: live complete wins over sticky unverified', () => {
  const sticky: FileAssessment = {
    availability: 'unverified',
    verifiedBytes: null,
  };
  const resolved = resolveFileAssessment(sticky, null, completedRecord('dl-2'));
  assert(resolved.availability === 'available', 'record complete → available');
});

test('resolveFileAssessment: live missing wins over stale available', () => {
  const sticky: FileAssessment = {
    availability: 'available',
    verifiedBytes: 10,
  };
  const resolved = resolveFileAssessment(
    sticky,
    {
      downloadId: 'dl-3',
      bytesWritten: 0,
      totalBytes: null,
      progress: 0,
      bytesPerSecond: null,
      etaSeconds: null,
      localUri: null,
      localState: 'missing',
      errorCode: null,
      errorMessage: null,
    },
    null,
  );
  assert(resolved.availability === 'missing', 'deleted file stays missing');
});

test('DOWNLOADING → COMPLETED assemble yields one playable item', () => {
  const id = 'vid-100';
  const record = completedRecord(id);
  const stickyAssessments = {
    [id]: { availability: 'missing' as const, verifiedBytes: null },
  };

  const items = assembleCanonicalItems({
    downloads: [completedDownload(id)],
    records: [record],
    transfers: { [id]: completeTransfer(id, record.localUri!) },
    remoteById: {},
    favoriteKeys: new Set(),
    assessments: stickyAssessments,
  });

  const playable = applyLibraryQuery(items, queryAll());

  assert(playable.items.length === 1, 'exactly one playable item');
  assert(playable.items[0]!.id === id, 'stable downloadId identity');
  assert(
    playable.items[0]!.localAvailability === 'available',
    'availability available',
  );
});

test('Library loaded empty then completion event yields one item', () => {
  const id = 'live-1';
  const empty = assembleCanonicalItems({
    downloads: [],
    records: [],
    transfers: {},
    remoteById: {},
    favoriteKeys: new Set(),
    assessments: {},
  });
  assert(empty.length === 0, 'starts empty');

  const record = completedRecord(id);
  const after = assembleCanonicalItems({
    downloads: [completedDownload(id)],
    records: [record],
    transfers: { [id]: completeTransfer(id, record.localUri!) },
    remoteById: {},
    favoriteKeys: new Set(),
    assessments: {
      [id]: { availability: 'missing', verifiedBytes: null },
    },
  });
  const playable = applyLibraryQuery(after, queryAll());
  assert(playable.items.length === 1, 'appears without refresh after complete');
});

test('offline: local complete without remote still appears', () => {
  const id = 'offline-1';
  const record = completedRecord(id);
  const items = assembleCanonicalItems({
    downloads: [],
    records: [record],
    transfers: {},
    remoteById: {},
    favoriteKeys: new Set(),
    assessments: {},
  });
  const playable = applyLibraryQuery(items, queryAll());
  assert(playable.items.length === 1, 'offline local complete visible');
});

test('local + remote + repeated complete does not duplicate', () => {
  const id = 'dup-1';
  const record = completedRecord(id);
  const remote = {
    id,
    downloadId: id,
    displayName: 'Remote Title',
    fileName: 'video.mp4',
    fileSize: '104857600',
    quality: '1080p',
    resolution: null,
    bitrate: null,
    duration: null,
    mimeType: 'video/mp4',
    downloadedAt: new Date().toISOString(),
    thumbnailUrl: null,
    folderId: null,
    folderName: null,
    favorite: false,
  };
  const items = assembleCanonicalItems({
    downloads: [completedDownload(id)],
    records: [record],
    transfers: { [id]: completeTransfer(id, record.localUri!) },
    remoteById: { [id]: remote },
    favoriteKeys: new Set(),
    assessments: {
      [id]: { availability: 'available', verifiedBytes: 100 },
    },
  });
  assert(items.length === 1, 'one canonical item');
});

test('availability cache race: missing then complete → available', () => {
  let cached: FileAssessment | undefined = {
    availability: 'missing',
    verifiedBytes: null,
  };
  assert(cached.availability === 'missing', 'cached missing');

  cached = undefined;
  const after = resolveFileAssessment(
    cached,
    completeTransfer('race-1', 'file:///final.mp4'),
    null,
  );
  assert(after.availability === 'available', 'post-completion available');
});

test('bridge + bootstrap wiring present', () => {
  const bridge = read('src/library/ensure-completion-bridge.ts');
  assert(
    bridge.includes("event.type === 'completed'") ||
      bridge.includes("event.type !== 'completed'"),
    'listens completed',
  );
  assert(bridge.includes("event.type === 'removed'"), 'listens removed');
  assert(bridge.includes('notifyLibraryDownloadRemoved'), 'removal notify');
  assert(bridge.includes('invalidateLibraryAvailability'), 'invalidates cache');
  assert(bridge.includes('bumpSourceRevision'), 'bumps revision');
  assert(
    bridge.includes('invalidatePlaybackUiQueries'),
    'invalidates local playback UI queries',
  );

  const boot = read('src/bootstrap/app-initializer.ts');
  assert(
    boot.includes('ensureLibraryCompletionBridge'),
    'bootstrap wires bridge',
  );

  const screen = read('src/screens/library/hooks/useLibraryScreen.ts');
  assert(screen.includes('sourceRevision'), 'screen watches revision');

  const engineTypes = read('src/downloads/engine/types.ts');
  assert(engineTypes.includes("type: 'removed'"), 'engine emits removed');
});

test('thumbnail absence does not exclude completed media', () => {
  const id = 'no-thumb';
  const record = completedRecord(id);
  const items = assembleCanonicalItems({
    downloads: [],
    records: [record],
    transfers: {},
    remoteById: {},
    favoriteKeys: new Set(),
    assessments: {
      [id]: { availability: 'available', verifiedBytes: 10 },
    },
  });
  assert(items.length === 1, 'mapped without thumbnail');
  assert(items[0]!.thumbnailUri == null, 'placeholder allowed');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
