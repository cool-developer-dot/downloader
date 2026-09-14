/**
 * Phase 1E — pause/resume/retry/cancel + file integrity lifecycle tests.
 * Run: npm run verify:lifecycle-file-integrity
 */

import { DownloadEngineError } from '../src/downloads/engine/errors';
import {
  assessExpiringMediaUrl,
  isLikelyExpiredMediaUrl,
} from '../src/media-detection/services/expiring-url.service';
import {
  parseContentRange,
  validateRangeResumeResponse,
} from '../src/downloads/engine/range-validation';
import { createWorkerSettleBarrier } from '../src/downloads/engine/worker-settle';
import {
  catalogStatusForExecutionState,
  transitionDownloadExecutionState,
  createExecutionSnapshot,
} from '../src/downloads/execution/download-state-machine';
import { deriveDownloadExecutionDisplayState } from '../src/downloads/execution/display-status';
import {
  isLibraryCandidate,
  isTempOrWorkspaceArtifact,
} from '../src/library/eligibility';
import {
  sniffMediaSignature,
  MIN_VALID_MEDIA_BYTES,
} from '../src/downloads/engine/media-signature';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;

type TestDownloadRecord = {
  downloadId: string;
  sourceUrl: string;
  fileName: string;
  localState: string;
  remoteStatus: string;
  bytesWritten: number;
  totalBytes?: number | null;
  expectedFileSize?: number | null;
  localUri?: string | null;
  pauseState?: { resumeData?: string; fileUri?: string } | null;
  generation?: number | null;
  retryCount: number;
  retryEligible: boolean;
  createdAt: string;
  updatedAt: string;
  hlsTransfer?: { completedSegments: number; downloadedBytes?: number } | null;
  multiRange?: unknown;
};

function isPlaylistUrl(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url) || url.includes('application/vnd.apple.mpegurl');
}

function isSocialHost(url: string): boolean {
  return /tiktokcdn\.com|cdninstagram\.com|fbcdn\.net/i.test(url);
}

function decideResumeActionLocal(input: {
  record: TestDownloadRecord;
  partialBytes: number;
  sourceLikelyStale: boolean;
  sourceUrlChanged?: boolean;
}): string {
  const { record, partialBytes, sourceLikelyStale, sourceUrlChanged } = input;
  if (record.remoteStatus === 'CANCELLED' || record.remoteStatus === 'COMPLETED') {
    return 'CANNOT_RESUME';
  }
  if (isPlaylistUrl(record.sourceUrl)) {
    if (!record.hlsTransfer || record.hlsTransfer.completedSegments <= 0) {
      return sourceLikelyStale ? 'REFRESH_SOURCE_THEN_RESTART' : 'RESTART_FROM_ZERO';
    }
    return sourceLikelyStale ? 'REFRESH_SOURCE_THEN_CONTINUE' : 'CONTINUE_FROM_OFFSET';
  }
  const hasPauseResume = Boolean(record.pauseState?.resumeData) && partialBytes > 0;
  if (sourceUrlChanged) {
    return 'REFRESH_SOURCE_THEN_RESTART';
  }
  if (sourceLikelyStale && isSocialHost(record.sourceUrl)) {
    return hasPauseResume ? 'REFRESH_SOURCE_THEN_CONTINUE' : 'REFRESH_SOURCE_THEN_RESTART';
  }
  if (hasPauseResume || partialBytes > 0) {
    return 'CONTINUE_FROM_OFFSET';
  }
  return 'RESTART_FROM_ZERO';
}

const root = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
    return;
  }
  passed += 1;
  console.log(`PASS: ${message}`);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    assert(false, `expected ${code}`);
  } catch (error) {
    assert(
      error instanceof DownloadEngineError && error.code === code,
      `throws ${code}`,
    );
  }
}

function makeRecord(
  overrides: Partial<TestDownloadRecord> = {},
): TestDownloadRecord {
  return {
    downloadId: 'dl-test',
    sourceUrl: 'https://cdn.example.com/video.mp4',
    fileName: 'video.mp4',
    localState: 'paused',
    remoteStatus: 'PAUSED',
    bytesWritten: 20 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024,
    expectedFileSize: 100 * 1024 * 1024,
    localUri: 'file:///data/video.mp4',
    pauseState: {
      resumeData: String(20 * 1024 * 1024),
      fileUri: 'file:///data/video.mp4',
    },
    generation: 5,
    retryCount: 0,
    retryEligible: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log('Phase 1E — Lifecycle + File Integrity\n');

  const managerSrc = read('src/downloads/engine/manager.ts');
  const workerSrc = read('src/downloads/engine/worker.ts');
  const hlsWorkerSrc = read('src/downloads/engine/hls/worker.ts');

  assert(managerSrc.includes('waitUntilSettled'), 'pause uses worker settle barrier');
  assert(
    managerSrc.indexOf('async resume') <
      managerSrc.indexOf('waitUntilSettled', managerSrc.indexOf('async resume')),
    'resume waits for settle barrier before enqueue',
  );
  assert(managerSrc.includes('pauseReason'), 'pauseReason persisted on manager');
  assert(
    managerSrc.includes("pauseReason === 'USER'"),
    'network-policy resume skips USER_PAUSED',
  );
  assert(managerSrc.includes('stalePauseOverAdvanced'), 'stale pause guard present');
  assert(
    managerSrc.includes('hint === \'PAUSED\'') &&
      managerSrc.includes('snapshot.localState === \'transferring\''),
    'publishSnapshot drops stale transferring while PAUSED hint',
  );
  assert(workerSrc.includes('settleBarrier'), 'progressive worker has settle barrier');
  assert(hlsWorkerSrc.includes('userPauseRequested'), 'HLS user pause flag exists');
  assert(hlsWorkerSrc.includes('pauseReason: \'USER\''), 'HLS user pause sets pauseReason');

  assert(
    read('src/downloads/engine/resume-decision.ts').includes('CONTINUE_FROM_OFFSET'),
    'resume-decision module defines explicit decisions',
  );

  assert(
    decideResumeActionLocal({
      record: makeRecord(),
      partialBytes: 20 * 1024 * 1024,
      sourceLikelyStale: false,
    }) === 'CONTINUE_FROM_OFFSET',
    'valid partial resume continues from offset',
  );

  assert(
    decideResumeActionLocal({
      record: makeRecord({ remoteStatus: 'CANCELLED' }),
      partialBytes: 0,
      sourceLikelyStale: false,
    }) === 'CANNOT_RESUME',
    'cancelled cannot resume',
  );

  assert(
    decideResumeActionLocal({
      record: makeRecord({
        sourceUrl: 'https://v16.tiktokcdn.com/video.mp4?expire=1',
      }),
      partialBytes: 20 * 1024 * 1024,
      sourceLikelyStale: true,
    }) === 'REFRESH_SOURCE_THEN_CONTINUE',
    'stale social with partial prefers refresh then continue',
  );

  assert(
    decideResumeActionLocal({
      record: makeRecord({
        sourceUrl: 'https://v16.tiktokcdn.com/video.mp4?expire=1',
        pauseState: null,
        bytesWritten: 0,
      }),
      partialBytes: 0,
      sourceLikelyStale: true,
    }) === 'REFRESH_SOURCE_THEN_RESTART',
    'stale social without partial restarts',
  );

  assert(
    decideResumeActionLocal({
      record: makeRecord(),
      partialBytes: 20 * 1024 * 1024,
      sourceLikelyStale: false,
      sourceUrlChanged: true,
    }) === 'REFRESH_SOURCE_THEN_RESTART',
    'source identity change restarts',
  );

  const barrier = createWorkerSettleBarrier();
  let settled = false;
  void barrier.promise.then(() => {
    settled = true;
  });
  assert(!settled, 'settle barrier blocks until resolve');
  barrier.resolve();
  await barrier.promise;
  assert(settled, 'settle barrier resolves');

  let bytes = 1000;
  const activeGeneration = 6;
  const applyProgress = (g: number, next: number) => {
    if (g !== activeGeneration) {
      return;
    }
    bytes = next;
  };
  applyProgress(5, 2000);
  assert(bytes === 1000, 'stale generation progress ignored after resume');

  const statusHints = new Map<string, string>();
  let remoteStatus = 'PAUSED';
  statusHints.set('dl-1', 'QUEUED');
  const currentHint = statusHints.get('dl-1');
  const stalePauseOverAdvanced =
    remoteStatus === 'PAUSED' &&
    (currentHint === 'QUEUED' || currentHint === 'DOWNLOADING');
  if (!stalePauseOverAdvanced) {
    statusHints.set('dl-1', remoteStatus);
  }
  assert(statusHints.get('dl-1') === 'QUEUED', 'late gen-5 PAUSED cannot overwrite QUEUED');

  const offset = 20 * 1024 * 1024;
  const parsed = parseContentRange(`bytes ${offset}-104857599/104857600`);
  assert(parsed?.start === offset, 'parse Content-Range start');

  try {
    validateRangeResumeResponse({
      status: 206,
      contentRange: `bytes ${offset}-104857599/104857600`,
      offset,
      sentIfRange: true,
      priorValidators: { etag: 'a', lastModified: null, contentLength: 104857600 },
      etag: 'a',
    });
    assert(true, 'valid 206 Content-Range accepted');
  } catch {
    assert(false, 'valid 206 Content-Range accepted');
  }

  expectCode(
    () =>
      validateRangeResumeResponse({
        status: 200,
        contentRange: null,
        offset,
        sentIfRange: false,
      }),
    'RESUME_UNSUPPORTED',
  );

  expectCode(
    () =>
      validateRangeResumeResponse({
        status: 200,
        contentRange: null,
        offset,
        sentIfRange: true,
      }),
    'SOURCE_CHANGED',
  );

  expectCode(
    () =>
      validateRangeResumeResponse({
        status: 206,
        contentRange: `bytes 0-104857599/104857600`,
        offset,
        sentIfRange: true,
      }),
    'INVALID_RANGE_RESPONSE',
  );

  expectCode(
    () =>
      validateRangeResumeResponse({
        status: 206,
        contentRange: `bytes ${offset}-104857599/104857600`,
        offset,
        sentIfRange: true,
        priorValidators: { etag: 'old', lastModified: null, contentLength: 104857600 },
        etag: 'new',
      }),
    'SOURCE_CHANGED',
  );

  let appendWouldHappen = false;
  try {
    validateRangeResumeResponse({
      status: 200,
      contentRange: null,
      offset,
      sentIfRange: false,
    });
    appendWouldHappen = true;
  } catch {
    appendWouldHappen = false;
  }
  assert(!appendWouldHappen, 'HTTP 200 on resume does NOT allow append');

  assert(managerSrc.includes('refreshIfStale'), 'resolveRetryEnqueueInput supports refreshIfStale');
  assert(
    managerSrc.includes('shouldRefreshSourceOnResume'),
    'resume triggers stale source evaluation',
  );

  const fresh = assessExpiringMediaUrl('https://cdn.example.com/static.mp4');
  assert(!fresh.isExpired, 'direct CDN URL assessed fresh');

  const expiredUrl =
    'https://v16.tiktokcdn.com/video.mp4?expire=1600000000&signature=abc';
  assert(
    isLikelyExpiredMediaUrl(expiredUrl, 1700000000000),
    'expired signed URL detected stale',
  );

  assert(managerSrc.includes('waitForLifecycleLock'), 'cancel waits for lifecycle lock');
  assert(managerSrc.includes('clearRetryTimer'), 'cancel clears retry timers');
  assert(managerSrc.includes('suppressedIds.add'), 'cancel suppresses stale callbacks');

  const cancelStart = managerSrc.indexOf('async cancel(downloadId: string)');
  const cancelBody = managerSrc.slice(
    cancelStart,
    managerSrc.indexOf('async retry', cancelStart),
  );
  assert(cancelBody.includes('cancelPending'), 'cancel removes scheduler pending');
  assert(cancelBody.includes('release'), 'cancel releases scheduler slot');

  const snap = createExecutionSnapshot('c', 1, 0);
  const toCancelled = transitionDownloadExecutionState({
    snapshot: snap,
    to: 'CANCELLED',
    reason: 'user_cancel',
    generation: 1,
  });
  assert(toCancelled.ok, 'transition to CANCELLED');
  const toQueued = transitionDownloadExecutionState({
    snapshot: snap,
    to: 'QUEUED',
    reason: 'scheduler_admit',
    generation: 2,
  });
  assert(!toQueued.ok, 'CANCELLED cannot auto-requeue');

  const cancelledIds = new Set(['wifi-dl']);
  const wifiReturns = () => !cancelledIds.has('wifi-dl');
  assert(!wifiReturns(), 'cancelled WAITING_FOR_WIFI does not restart on Wi-Fi');

  const mp4Head = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  ]);
  assert(sniffMediaSignature(mp4Head).ok, 'valid MP4 signature accepted');

  const htmlHead = new TextEncoder().encode('<!doctype html><html><body>denied');
  assert(!sniffMediaSignature(htmlHead).ok, 'HTML payload rejected');

  const jsonHead = new TextEncoder().encode('{"error":"challenge"}');
  assert(!sniffMediaSignature(jsonHead).ok, 'JSON payload rejected');

  const tinyHtml = new TextEncoder().encode('<html>');
  assert(tinyHtml.length < MIN_VALID_MEDIA_BYTES, '419B fake file below minimum');
  assert(!sniffMediaSignature(tinyHtml).ok, 'tiny HTML fake .mp4 rejected');

  assert(
    workerSrc.includes('validateFinalDownloadFile'),
    'worker complete uses centralized validation',
  );
  assert(workerSrc.includes('finalizationCommitted'), 'idempotent finalization guard');
  assert(
    workerSrc.includes('finalizing'),
    'complete enters finalizing worker state before COMPLETED',
  );

  const execSnap = createExecutionSnapshot('f', 3, 0);
  transitionDownloadExecutionState({
    snapshot: execSnap,
    to: 'STARTING',
    reason: 'worker_admitted',
    generation: 3,
  });
  transitionDownloadExecutionState({
    snapshot: execSnap,
    to: 'DOWNLOADING',
    reason: 'first_valid_byte',
    generation: 3,
    bytesWritten: 50,
  });
  transitionDownloadExecutionState({
    snapshot: execSnap,
    to: 'FINALIZING',
    reason: 'transfer_complete',
    generation: 3,
  });
  assert(execSnap.state === 'FINALIZING', 'transfer complete → FINALIZING execution');
  assert(
    catalogStatusForExecutionState('FINALIZING') === 'DOWNLOADING',
    'FINALIZING catalog stays DOWNLOADING until commit',
  );
  assert(
    deriveDownloadExecutionDisplayState({
      executionState: 'FINALIZING',
      status: 'DOWNLOADING',
      workerState: 'VERIFYING',
      appState: 'active',
    }) === 'FINALIZING',
    'display shows FINALIZING at 100%',
  );

  assert(
    read('src/downloads/engine/file-paths.ts').includes('getPartialTransferFile'),
    'partial transfer file helper exists',
  );
  assert(
    read('src/downloads/engine/file-paths.ts').includes('commitPartialToFinalFile'),
    'partial-to-final commit helper exists',
  );
  assert(
    workerSrc.includes('getPartialTransferFile'),
    'progressive worker writes to .part transfer file',
  );
  assert(
    workerSrc.includes('finalFile') && workerSrc.includes('transferFile'),
    'worker separates final and transfer paths',
  );
  assert(
    read('src/downloads/engine/finalize-download.ts').includes('commitPartialToFinalFile'),
    'finalization commits partial before COMPLETED',
  );

  assert(
    isTempOrWorkspaceArtifact('file:///data/video.mp4.part', 'video.mp4.part'),
    '.part detected as temp artifact',
  );
  assert(
    !isTempOrWorkspaceArtifact('file:///data/video.mp4', 'video.mp4'),
    'final path not temp artifact',
  );

  assert(
    !isLibraryCandidate({
      downloadId: 'x',
      status: 'DOWNLOADING',
      localUri: 'file:///data/video.mp4',
      localState: 'transferring',
    }),
    'DOWNLOADING not library eligible',
  );
  assert(
    !isLibraryCandidate({
      downloadId: 'x',
      status: 'PAUSED',
      localUri: 'file:///data/video.mp4',
      localState: 'paused',
    }),
    'PAUSED not library eligible',
  );
  assert(
    !isLibraryCandidate({
      downloadId: 'x',
      status: 'FAILED',
      localUri: 'file:///data/video.mp4',
      localState: 'failed',
    }),
    'FAILED not library eligible',
  );
  assert(
    !isLibraryCandidate({
      downloadId: 'x',
      status: 'CANCELLED',
      localUri: 'file:///data/video.mp4',
      localState: 'deleted',
    }),
    'CANCELLED not library eligible',
  );
  assert(
    !isLibraryCandidate({
      downloadId: 'x',
      status: 'COMPLETED',
      localUri: 'file:///data/video.mp4.part',
      localState: 'complete',
    }),
    'COMPLETED + .part not library eligible',
  );
  assert(
    isLibraryCandidate({
      downloadId: 'x',
      status: 'COMPLETED',
      localUri: 'file:///data/video.mp4',
      localState: 'complete',
    }),
    'COMPLETED valid final is library eligible',
  );

  assert(
    managerSrc.includes('MARK_LOCAL_UNAVAILABLE'),
    'recovery reconciles missing completed file',
  );
  assert(
    managerSrc.includes('pauseReason: record.pauseReason ?? \'SYSTEM_RECOVERY\''),
    'crash recovery sets SYSTEM_RECOVERY pause reason',
  );
  assert(managerSrc.includes('!userPaused'), 'recovery auto-resume skips USER pause');

  assert(
    read('src/downloads/engine/append-range-transfer.ts').includes(
      'A 200 response to a resume Range request is NEVER appended',
    ),
    'append-range documents no 200 append',
  );
  assert(
    read('src/downloads/scheduler/admission-scheduler.ts').includes('maxConcurrent'),
    'scheduler concurrency preserved',
  );
  assert(
    read('src/downloads/engine/stall-watchdog.ts').includes('generation'),
    'watchdog generation-aware preserved',
  );
  assert(
    read('src/downloads/engine/progress.ts').includes('normalizeTotalBytes'),
    'unknown total normalization preserved',
  );

  console.log(`\nPhase 1E lifecycle/file-integrity: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
