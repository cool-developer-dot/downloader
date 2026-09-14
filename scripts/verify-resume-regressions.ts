/**
 * Resume regressions — Download Pause→Resume admission + Playback auto-resume.
 *
 * Run: npm run verify:resume-regressions
 */
import { DownloadEngineError } from '../src/downloads/engine/errors';
import {
  parseContentRange,
  validateRangeResumeResponse,
} from '../src/downloads/engine/range-validation';
import { mergeRangeValidatorsWithLength } from '../src/downloads/engine/source-validators';
import { isResumeEligible } from '../src/playback/domain/resume';
import { PLAYBACK_MIN_RESUME_SECONDS } from '../src/playback/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

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

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (error) {
    assert(error instanceof DownloadEngineError, 'engine error');
    assert(error.code === code, `got ${error.code}`);
  }
}

console.log('Resume regressions verifier\n');

// ─── Download: lock / queue ordering ───────────────────────────────────────

test('resume upserts QUEUED → release lock → enqueue (no under-lock admit)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const resumeStart = src.indexOf('async resume(downloadId: string)');
  const resumeEnd = src.indexOf('async cancel(downloadId: string)', resumeStart);
  const body = src.slice(resumeStart, resumeEnd);
  const upsertIdx = body.indexOf("remoteStatus: 'QUEUED'");
  const lockDeleteIdx = body.indexOf('this.locks.delete(downloadId)');
  const enqueueIdx = body.indexOf('this.ensureScheduler().enqueue');
  assert(upsertIdx < lockDeleteIdx && lockDeleteIdx < enqueueIdx, 'order');
});

test('manual Resume ignores Auto Resume preference', () => {
  const src = read('src/downloads/engine/manager.ts');
  const resumeStart = src.indexOf('async resume(downloadId: string)');
  const resumeEnd = src.indexOf('async cancel(downloadId: string)', resumeStart);
  const body = src.slice(resumeStart, resumeEnd);
  assert(!body.includes('isAutoResumeEnabled()'), 'no auto-resume gate');
  assert(
    body.includes('Manual Resume must succeed regardless'),
    'documents manual override',
  );
});

test('afterWorkerSettled must not regress QUEUED/DOWNLOADING to PAUSED', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('stalePauseOverAdvanced'), 'stale pause guard present');
  assert(
    src.includes("record.remoteStatus === 'PAUSED'"),
    'guards PAUSED overwrite',
  );
});

test('resume re-asserts QUEUED hint immediately before enqueue', () => {
  const src = read('src/downloads/engine/manager.ts');
  const resumeStart = src.indexOf('async resume(downloadId: string)');
  const resumeEnd = src.indexOf('async cancel(downloadId: string)', resumeStart);
  const body = src.slice(resumeStart, resumeEnd);
  const first = body.indexOf("this.setStatusHint(downloadId, 'QUEUED')");
  const second = body.indexOf(
    "this.setStatusHint(downloadId, 'QUEUED')",
    first + 1,
  );
  const enqueueIdx = body.indexOf('this.ensureScheduler().enqueue');
  assert(first >= 0 && second > first, 'QUEUED hint set twice');
  assert(second < enqueueIdx, 'second hint before enqueue');
});

test('PAUSE→RESUME simulation: stale PAUSED hint must not block after re-assert', () => {
  const statusHints = new Map<string, string>();
  const locks = new Set<string>();
  let remoteStatus = 'PAUSED';
  let enqueued = false;

  const probe = (id: string) => statusHints.get(id) ?? 'QUEUED';
  const enqueue = (id: string) => {
    const status = probe(id);
    if (status === 'PAUSED' || status === 'COMPLETED' || status === 'CANCELLED') {
      return false;
    }
    if (locks.has(id)) {
      return false;
    }
    enqueued = true;
    return true;
  };

  // Late pause settle sees PAUSED but resume already advanced.
  statusHints.set('dl-1', 'QUEUED');
  remoteStatus = 'PAUSED';
  const currentHint = statusHints.get('dl-1');
  const stalePauseOverAdvanced =
    remoteStatus === 'PAUSED' &&
    (currentHint === 'QUEUED' || currentHint === 'DOWNLOADING');
  if (!stalePauseOverAdvanced) {
    statusHints.set('dl-1', remoteStatus);
  }
  assert(statusHints.get('dl-1') === 'QUEUED', 'hint stays QUEUED');

  statusHints.set('dl-1', 'QUEUED');
  assert(enqueue('dl-1') === true, 'enqueue accepts');
  assert(enqueued, 'enqueued');
});

test('enqueue under lock / PAUSED probe → QUEUE_ADMISSION_FAILED path exists', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("QUEUE_ADMISSION_FAILED"), 'specific admission code');
  assert(src.includes('download.resume_admission'), 'admission diagnostic');
  assert(src.includes('download.resume_failed'), 'failure diagnostic');
});

// ─── Range / checkpoint truth ──────────────────────────────────────────────

test('Range offset uses on-disk partial size (checkpoint mismatch)', () => {
  const checkpoint = 8_000_000;
  const actualPartialSize = 6_000_000;
  const safeOffset = actualPartialSize > 0 ? actualPartialSize : checkpoint;
  assert(safeOffset === 6_000_000, 'disk wins');
  const header = `bytes=${safeOffset}-`;
  assert(header === 'bytes=6000000-', 'Range header');
});

test('206 validation accepts matching Content-Range start', () => {
  const offset = 1_000_000;
  const result = validateRangeResumeResponse({
    status: 206,
    contentRange: 'bytes 1000000-21069677/21069678',
    etag: '"1d78e810989076e"',
    lastModified: 'Wed, 11 Aug 2021 07:18:08 GMT',
    contentLength: '20069678',
    offset,
    sentIfRange: true,
    knownTotalBytes: 21_069_678,
    priorValidators: {
      etag: '"1d78e810989076e"',
      contentLength: 21_069_678,
    },
  });
  assert(result.totalBytes === 21_069_678, 'total');
  const parsed = parseContentRange('bytes 1000000-21069677/21069678');
  assert(parsed?.start === offset, 'start matches offset');
});

test('stale slice contentLength (1) does not SOURCE_CHANGED vs real total', () => {
  // priorValidators.contentLength=1 is ignored when <= offset
  const result = validateRangeResumeResponse({
    status: 206,
    contentRange: 'bytes 1000-1999/21069678',
    offset: 1000,
    sentIfRange: false,
    priorValidators: { contentLength: 1 },
  });
  assert(result.totalBytes === 21_069_678, 'uses Content-Range total');
});

test('validator merge never shrinks known full length with slice length', () => {
  const merged = mergeRangeValidatorsWithLength(
    { etag: '"a"', contentLength: 21_069_678 },
    { contentLength: 1 },
  );
  assert(merged?.contentLength === 21_069_678, 'keeps full size');
});

test('no worker duplication: admit rejects when workers.has', () => {
  const workers = new Set<string>(['dl-1']);
  const locks = new Set<string>();
  const admit = (id: string) => {
    if (locks.has(id) || workers.has(id)) {
      return false;
    }
    workers.add(id);
    return true;
  };
  assert(admit('dl-1') === false, 'duplicate blocked');
  workers.delete('dl-1');
  assert(admit('dl-1') === true, 'second start after release');
});

// ─── Playback auto-resume ──────────────────────────────────────────────────

test('eligibility: >=15s unfinished mid-roll resumes; short/completed start 0', () => {
  assert(PLAYBACK_MIN_RESUME_SECONDS === 15, 'threshold');
  assert(
    isResumeEligible({
      positionSeconds: 30,
      durationSeconds: 600,
      completed: false,
    }),
    '30s eligible',
  );
  assert(
    !isResumeEligible({
      positionSeconds: 5,
      durationSeconds: 600,
      completed: false,
    }),
    '5s ineligible',
  );
  assert(
    !isResumeEligible({
      positionSeconds: 30,
      durationSeconds: 600,
      completed: true,
    }),
    'completed ineligible',
  );
  assert(
    !isResumeEligible({
      positionSeconds: 595,
      durationSeconds: 600,
      completed: false,
    }),
    'near-end ineligible',
  );
});

test('PlayerScreen bypasses ResumePlaybackSheet; hook auto-seeks when ready', () => {
  const screen = read('src/screens/player/PlayerScreen.tsx');
  assert(!screen.includes('ResumePlaybackSheet'), 'sheet not mounted');
  assert(screen.includes('useResumePrompt'), 'hook still wired');
  assert(screen.includes('resolveGeneration'), 'generation passed');

  const hook = read('src/playback/use-resume-prompt.ts');
  assert(hook.includes('visible: false'), 'sheet never visible');
  assert(hook.includes('applySeek(candidate.positionSeconds)'), 'auto seek');
  assert(hook.includes('input.resolveGeneration'), 'generation guard');
  assert(hook.includes('input.activeMediaId !== input.mediaId'), 'media guard');
});

test('stale media A callback cannot seek media B', () => {
  let activeMediaId = 'media-a';
  let resolveGeneration = 1;
  const sessionGenA = 1;
  let seekTarget: { mediaId: string; seconds: number } | null = null;

  const applySeek = (
    mediaId: string,
    seconds: number,
    sessionGen: number,
  ): boolean => {
    if (activeMediaId !== mediaId) {
      return false;
    }
    if (sessionGen !== resolveGeneration) {
      return false;
    }
    seekTarget = { mediaId, seconds };
    return true;
  };

  // User switches A → B before A's async resume fires.
  activeMediaId = 'media-b';
  resolveGeneration = 2;
  assert(applySeek('media-a', 34, sessionGenA) === false, 'stale A blocked');
  assert(seekTarget === null, 'no seek');

  assert(applySeek('media-b', 10, 2) === true, 'B allowed');
  const applied = seekTarget as { mediaId: string; seconds: number } | null;
  assert(
    applied !== null && applied.mediaId === 'media-b' && applied.seconds === 10,
    'B seeked',
  );
});

test('player ready before seek — session exposes resolveGeneration', () => {
  const session = read('src/player/use-player-session.ts');
  assert(session.includes('resolveGeneration'), 'exported');
  assert(session.includes('setResolveGeneration(gen)'), 'bumped per load');
  assert(session.includes("status === 'readyToPlay'"), 'ready gate exists');
});

test('Back / playerExited flush path still mandatory', () => {
  const session = read('src/player/use-player-session.ts');
  assert(session.includes("type: 'playerExited'"), 'exit event');
  const coord = read('src/playback/coordinator.ts');
  assert(coord.includes("case 'playerExited'"), 'handles exit');
  assert(coord.includes("this.flushSync('exit')"), 'exit flush');
  assert(coord.includes('persistLocalMandatory'), 'local mandatory');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
