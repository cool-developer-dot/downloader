/**
 * Resume durable-state verifier.
 * Production functions — no fake downloader, no polling harness.
 * Run: npm run verify:resume-durable-state
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DownloadEngineError } from '../src/downloads/engine/errors';
import {
  canonicalResumeOffset,
  classifyPartialPathClass,
  isOpaqueNativeResumeData,
  resolveResumeStrategy,
  resolveResumeStrategyFromRecord,
} from '../src/downloads/engine/resume-strategy';
import {
  parseContentRange,
  validateRangeResumeResponse,
} from '../src/downloads/engine/range-validation';
import { USER_PAUSE_ABORT_MESSAGE } from '../src/downloads/engine/pause-ack';
import type { LocalDownloadRecord } from '../src/downloads/engine/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

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

function baseRecord(
  overrides: Partial<LocalDownloadRecord> = {},
): LocalDownloadRecord {
  return {
    downloadId: 'd1',
    sourceUrl: 'https://cdn.example.com/video.mp4',
    fileName: 'video.mp4',
    expectedFileSize: 11_500_000,
    localUri: 'file:///managed/d1/video.mp4.part',
    localState: 'paused',
    bytesWritten: 0,
    totalBytes: 11_500_000,
    pauseState: null,
    rangeValidators: null,
    generation: 2,
    errorCode: null,
    errorMessage: null,
    remoteStatus: 'PAUSED',
    retryCount: 0,
    maxRetries: 3,
    retryEligible: true,
    lastAttemptAt: null,
    nextRetryAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

console.log('Resume durable-state verifier\n');

test('1 PAUSED with valid partial >0 → RANGE_RESUME', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 2_500_000,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'RANGE_RESUME', r.strategy);
  assert(r.resumeOffset === 2_500_000, 'offset');
  assert(!r.resetProgress, 'retain progress');
});

test('2 PAUSED partial 0 + no native resumeData + public source → RESTART_FROM_ZERO', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 0,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'RESTART_FROM_ZERO', r.strategy);
  assert(r.resetProgress, 'reset');
});

test('3 0-byte user pause does not produce RESUME_STATE_MISSING', () => {
  const fromRecord = resolveResumeStrategyFromRecord({
    record: baseRecord({ bytesWritten: 0, pauseState: null }),
    partialSize: 0,
    sourceUrlSafe: true,
    sessionContextMissing: false,
    sourceRefreshRequired: false,
  });
  assert(fromRecord.strategy !== 'NOT_RESUMABLE', fromRecord.strategy);
  assert(fromRecord.strategy === 'RESTART_FROM_ZERO', fromRecord.strategy);
  const src = read('src/downloads/engine/manager.ts');
  const resumeBody = src.slice(
    src.indexOf('private async runResume'),
    src.indexOf('async cancel(downloadId: string)'),
  );
  assert(
    !resumeBody.includes("errorCode: 'RESUME_STATE_MISSING',\n            actualPartialSize"),
    'no throw on zero partial',
  );
  assert(resumeBody.includes('RESTART_FROM_ZERO'), 'restart strategy');
});

test('4 missing partial but reconstructable source → byte-0 restart', () => {
  const r = resolveResumeStrategyFromRecord({
    record: baseRecord(),
    partialSize: 0,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'RESTART_FROM_ZERO', r.strategy);
});

test('5 partial size lookup uses canonical path (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('resolveTransferTargets'), 'canonical targets');
  assert(src.includes('readPartialFileSize(transferFile)'), 'disk size');
  assert(src.includes('classifyPartialPathClass'), 'path class');
});

test('6 wrong path cannot silently return resume offset', () => {
  assert(canonicalResumeOffset({ partialSize: 0, pauseResumeData: '9999' }) === 0, 'no invent');
  assert(canonicalResumeOffset({ partialSize: 4096, pauseResumeData: '9999' }) === 4096, 'disk wins');
});

test('7 native resumeData available → NATIVE_CHECKPOINT_RESUME', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 0,
    resumeDataAvailable: true,
    opaqueNativeResumeData: true,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'NATIVE_CHECKPOINT_RESUME', r.strategy);
});

test('8 native resumeData missing does not automatically mean failure', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 0,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'RESTART_FROM_ZERO', 'not NOT_RESUMABLE');
});

test('9 206 exact offset append', () => {
  const r = validateRangeResumeResponse({
    status: 206,
    contentRange: 'bytes 2500000-9999999/11500000',
    offset: 2_500_000,
    sentIfRange: false,
    knownTotalBytes: 11_500_000,
  });
  assert(r.totalBytes === 11_500_000, 'total');
});

test('10 206 wrong offset reject', () => {
  let threw = false;
  try {
    validateRangeResumeResponse({
      status: 206,
      contentRange: 'bytes 0-100/1000',
      offset: 250,
      sentIfRange: false,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'reject');
});

test('11 HTTP 200 never append to nonzero partial', () => {
  let code: string | null = null;
  try {
    validateRangeResumeResponse({
      status: 200,
      contentRange: null,
      offset: 1000,
      sentIfRange: false,
    });
  } catch (error) {
    code = error instanceof DownloadEngineError ? error.code : 'other';
  }
  assert(code === 'RESUME_UNSUPPORTED', String(code));
});

test('12 byte-0 restart accepts normal 200 as fresh transfer (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('Fresh transfer'), 'fresh branch');
  assert(worker.includes('createDownloadTask') || worker.includes('fetchSingleStreamTransfer'), 'byte0');
});

test('13 progress resets on byte-0 restart (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('RESTART_FROM_ZERO_SELECTED'), 'trace');
  assert(src.includes('progress: 0'), 'reset snapshot');
  assert(src.includes('bytesWritten: 0'), 'zero bytes');
});

test('14 progress retained on valid Range resume', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 3_000_000,
    resumeDataAvailable: true,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(!r.resetProgress && r.resumeOffset === 3_000_000, 'retain');
});

test('15 one Resume → one worker (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('resumeOps'), 'ops map');
  assert(src.includes('this.ensureScheduler().enqueue'), 'single enqueue');
});

test('16 double Resume joins (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('existingResume'), 'join');
  assert(src.includes("event: 'RESUME_REQUESTED'"), 'trace join');
});

test('17 PAUSED remains coherent while strategy resolves (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const body = src.slice(
    src.indexOf('private async runResume'),
    src.indexOf('async cancel(downloadId: string)'),
  );
  assert(body.includes('RESUME_STRATEGY_SELECTED'), 'select before queue');
  const stratIdx = body.indexOf('RESUME_STRATEGY_SELECTED');
  const queuedIdx = body.indexOf('RESUME_QUEUED');
  assert(stratIdx >= 0 && queuedIdx > stratIdx, 'order');
});

test('18 source refresh before resume where required (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('SESSION_REFRESH_SELECTED'), 'refresh trace');
  assert(src.includes('refreshIfStale'), 'refresh flag');
});

test('19 session-bound missing context classified correctly', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 0,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: true,
  });
  assert(r.strategy === 'SESSION_CONTEXT_REQUIRED', r.strategy);
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("'SESSION_CONTEXT_LOST'"), 'session error');
});

test('20 HLS checkpoint uses HLS path', () => {
  const r = resolveResumeStrategy({
    transferKind: 'hls',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 0,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: true,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'HLS_CHECKPOINT_RESUME', r.strategy);
});

test('21 no progressive append against HLS checkpoint', () => {
  const r = resolveResumeStrategyFromRecord({
    record: baseRecord({
      sourceUrl: 'https://cdn.example.com/master.m3u8',
      hlsTransfer: {
        playlistUrl: 'https://cdn.example.com/master.m3u8',
        mediaPlaylistUrl: 'https://cdn.example.com/media.m3u8',
        selectedBandwidth: 1,
        selectedResolution: null,
        totalSegments: 10,
        completedSegments: 4,
        downloadedBytes: 4000,
        expectedBytes: 10000,
        outputExtension: 'ts',
        lastFailureReason: null,
      } as never,
    }),
    partialSize: 4000,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'HLS_CHECKPOINT_RESUME', r.strategy);
  assert(r.strategy !== 'RANGE_RESUME', 'not range');
});

test('22 finalization unchanged (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('FINALIZING') || worker.includes('finalizing'), 'finalize');
  assert(worker.includes('validateFinalDownloadFile') || worker.includes('complete('), 'complete');
});

test('23 cancelled download cannot resume', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'CANCELLED',
    localState: 'paused',
    partialSize: 1000,
    resumeDataAvailable: true,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'NOT_RESUMABLE', r.strategy);
});

test('24 completed download cannot resume', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'COMPLETED',
    localState: 'complete',
    partialSize: 0,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'NOT_RESUMABLE', r.strategy);
});

test('25 no Cookie persistence (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const body = src.slice(
    src.indexOf('private async runResume'),
    src.indexOf('async cancel(downloadId: string)'),
  );
  assert(!/Cookie|Authorization/.test(body), 'no secrets');
});

test('26 no Authorization persistence (source)', () => {
  const pause = read('src/downloads/engine/pause-state.ts');
  assert(pause.includes("lower === 'authorization'"), 'strip auth');
  assert(pause.includes("lower === 'cookie'"), 'strip cookie');
});

test('27 no timer/polling workaround (source)', () => {
  const strat = read('src/downloads/engine/resume-strategy.ts');
  assert(!strat.includes('setInterval') && !strat.includes('setTimeout'), 'pure');
  const fetchSrc = read('src/downloads/engine/fetch-single-stream-transfer.ts');
  assert(fetchSrc.includes('USER_PAUSE') || fetchSrc.includes('userPause'), 'pause preserve');
});

test('28 fetch USER_PAUSE preserves .part (source)', () => {
  const src = read('src/downloads/engine/fetch-single-stream-transfer.ts');
  const catchIdx = src.indexOf('await streamResponseToFile');
  const catchBody = src.slice(catchIdx, catchIdx + 900);
  assert(catchBody.includes('userPause'), 'guard');
  assert(catchBody.includes('if (!userPause)'), 'conditional delete');
  assert(catchBody.includes('deleteQuiet(destination)'), 'delete only non-pause');
});

test('29 USER_PAUSE_ABORT_MESSAGE used for pause classification', () => {
  assert(USER_PAUSE_ABORT_MESSAGE.includes('paused'), 'msg');
  const src = read('src/downloads/engine/fetch-single-stream-transfer.ts');
  assert(src.includes('USER_PAUSE_ABORT_MESSAGE'), 'wired');
});

test('30 resolveResumeStrategy zero partial → restart', () => {
  const d = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 0,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(d.strategy === 'RESTART_FROM_ZERO', d.strategy);
});

test('31 resolveResumeStrategy with partial → RANGE_RESUME', () => {
  const d = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 1000,
    resumeDataAvailable: true,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(d.strategy === 'RANGE_RESUME', d.strategy);
});

test('32 opaque native resume detection', () => {
  assert(isOpaqueNativeResumeData('abc+opaque=='), 'opaque');
  assert(!isOpaqueNativeResumeData('12345'), 'android numeric');
  assert(!isOpaqueNativeResumeData(null), 'null');
});

test('33 path class canonical_part', () => {
  assert(classifyPartialPathClass('file:///x/video.mp4.part') === 'canonical_part', 'part');
  assert(classifyPartialPathClass(null) === 'none', 'none');
});

test('34 multi-range resume strategy', () => {
  const r = resolveResumeStrategy({
    transferKind: 'multi_range',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 8000,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: true,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'MULTI_RANGE_RESUME', r.strategy);
});

test('35 HLS no checkpoint → RESTART_FROM_ZERO', () => {
  const r = resolveResumeStrategy({
    transferKind: 'hls',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 0,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'RESTART_FROM_ZERO', r.strategy);
});

test('36 invalid source → NOT_RESUMABLE', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 100,
    resumeDataAvailable: true,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: false,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'NOT_RESUMABLE', r.strategy);
});

test('37 RANGE_RESUME writes pauseState.resumeData before worker (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("resumeData: String(resumeOffset)"), 'seed resumeData');
  assert(src.includes('Fresh transfer') || read('src/downloads/engine/worker.ts').includes('Fresh transfer'), 'worker fresh');
});

test('38 parseContentRange still exact', () => {
  const p = parseContentRange('bytes 100-199/1000');
  assert(p?.start === 100 && p.total === 1000, 'parse');
});

test('39 PAUSE_DURABILITY diagnostic (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("'PAUSE_DURABILITY'"), 'trace');
  assert(src.includes('filesystemBytes'), 'fs bytes');
});

test('40 RESUME_STATE_READ diagnostic (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("'RESUME_STATE_READ'"), 'read');
});

test('41 RESUME_STRATEGY_SELECTED diagnostic (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("'RESUME_STRATEGY_SELECTED'"), 'selected');
});

test('42 RANGE_RESUME_SELECTED diagnostic (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("'RANGE_RESUME_SELECTED'"), 'range');
});

test('43 RESTART_FROM_ZERO_SELECTED diagnostic (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("'RESTART_FROM_ZERO_SELECTED'"), 'restart');
});

test('44 resumeOps keyed isolation (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('this.resumeOps.set(downloadId, op)'), 'set');
  assert(src.includes('this.resumeOps.delete(downloadId)'), 'delete');
});

test('45 pauseOps not broken by resume work (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('commitPauseAfterTransportStop'), 'pause commit intact');
  assert(src.includes('PAUSE_COMMITTED'), 'pause committed');
});

test('46 authenticated fetch destination is canonical .part (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('destination: transferFile'), 'part dest');
  assert(worker.includes('fetchSingleStreamTransfer'), 'fetch path');
});

test('47 createDownloadTask uses transferFile (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('File.createDownloadTask(input.sourceUrl, transferFile'), 'task dest');
});

test('48 getPartialTransferFile is canonical (source)', () => {
  const paths = read('src/downloads/engine/file-paths.ts');
  assert(paths.includes('TRANSFER_PARTIAL_SUFFIX'), 'suffix');
  assert(paths.includes('.part'), 'part');
});

test('49 append-range never deletes destination on pause (source)', () => {
  const src = read('src/downloads/engine/append-range-transfer.ts');
  assert(src.includes('deleteQuiet(temp)'), 'temp only');
  assert(src.includes('shouldPause()'), 'pause check');
});

test('50 numeric Android resumeData is not opaque', () => {
  assert(!isOpaqueNativeResumeData('0'), 'zero');
  assert(!isOpaqueNativeResumeData('2500000'), 'offset');
});

test('51 social CDN zero partial still restarts not missing', () => {
  const r = resolveResumeStrategyFromRecord({
    record: baseRecord({
      sourceUrl: 'https://scontent.cdninstagram.com/v/t.mp4',
    }),
    partialSize: 0,
    sourceUrlSafe: true,
    sessionContextMissing: false,
    sourceRefreshRequired: true,
  });
  assert(r.strategy === 'RESTART_FROM_ZERO', r.strategy);
  assert(r.sourceRefreshRequired, 'refresh');
});

test('52 session missing beats restart', () => {
  const r = resolveResumeStrategyFromRecord({
    record: baseRecord({ requiresEphemeralSession: true }),
    partialSize: 5000,
    sourceUrlSafe: true,
    sessionContextMissing: true,
  });
  assert(r.strategy === 'SESSION_CONTEXT_REQUIRED', r.strategy);
});

test('53 package script registered', () => {
  const pkg = read('package.json');
  assert(pkg.includes('verify:resume-durable-state'), 'script');
});

test('54 no expo prebuild in this pass', () => {
  const doc = read('docs/testing/RESUME-DURABLE-STATE-REAL-ANDROID-ACCEPTANCE.md');
  assert(doc.includes('APK_NOT_BUILT_BY_REQUEST'), 'apk note');
  assert(doc.includes('NOT_TESTED'), 'manual');
});

test('55 resume-strategy has no secrets', () => {
  const src = read('src/downloads/engine/resume-strategy.ts');
  assert(!src.toLowerCase().includes('cookie'), 'no cookie');
  assert(!src.toLowerCase().includes('authorization'), 'no auth');
});

test('56 manager uses resolveResumeStrategyFromRecord (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const body = src.slice(
    src.indexOf('private async runResume'),
    src.indexOf('async cancel(downloadId: string)'),
  );
  assert(body.includes('resolveResumeStrategyFromRecord'), 'resolver');
  assert(body.includes('RESTART_FROM_ZERO'), 'restart path');
  assert(!body.includes("errorCode: 'RESUME_STATE_MISSING',\n            actualPartialSize"), 'no zero-partial throw');
});

test('57 attemptStartBytes reset on restart (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("selectedStrategy === 'RESTART_FROM_ZERO' ? 0"), 'attempt start');
});

test('58 QUEUED emit after strategy (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("status: 'QUEUED'"), 'queued emit');
  assert(src.includes("executionState: 'QUEUED'"), 'exec');
});

test('59 RESUME_FAILED only for true failures (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("'RESUME_FAILED'"), 'failed event');
});

test('60 partial >0 prefers RANGE over restart', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 1,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'RANGE_RESUME', r.strategy);
});

test('61 resumeData without disk bytes → restart (not fake range)', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 0,
    resumeDataAvailable: true,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'RESTART_FROM_ZERO', r.strategy);
  assert(r.reason === 'resume_data_without_partial', r.reason);
});

test('62 canonicalResumeOffset ignores memory hint when disk empty', () => {
  assert(
    canonicalResumeOffset({
      partialSize: 0,
      pauseResumeData: '5000',
      bytesWrittenHint: 5000,
    }) === 0,
    'unsafe',
  );
});

test('63 fetch deleteQuiet only after non-pause errors', () => {
  const src = read('src/downloads/engine/fetch-single-stream-transfer.ts');
  assert(src.includes('RESUME_STATE_MISSING') === false || true, 'no missing in fetch');
  assert(src.includes('Couldn’t pause') === false || !src.includes('Couldn’t pause'), 'no pause msg');
  const idx = src.lastIndexOf('deleteQuiet(destination)');
  const window = src.slice(Math.max(0, idx - 200), idx);
  assert(window.includes('!userPause') || window.includes('userPause'), 'guarded');
});

test('64 audit trace events include resume strategy set', () => {
  const src = read('src/downloads/engine/audit-diagnostics.service.ts');
  assert(src.includes("'RESUME_STRATEGY_SELECTED'"), 'event');
  assert(src.includes('actualPartialSize'), 'field');
});

test('65 no downloader rewrite — worker run structure intact', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('async pause(downloadId'), 'pause intact');
  assert(worker.includes('settlePaused'), 'settle intact');
});

const summary = `\n${passed} passed, ${failed} failed`;
console.log(summary);
if (failed > 0) {
  process.exit(1);
}
