/**
 * Playback sync final (mobile) — coordinator / client contracts for the
 * backend 500 incident (stale Prisma clientRevision) and pendingSync rules.
 *
 * Run (from mobile/):
 *   npm run verify:playback-sync-final
 */
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

console.log('Playback sync final verifier (mobile)\n');

test('coordinator sends clientRevision on remote sync', () => {
  const src = read('src/playback/coordinator.ts');
  assert(src.includes('clientRevision: snapshotRevision'), 'sends revision');
  assert(src.includes('playback.sync_failed'), 'logs sync_failed');
  assert(src.includes('status === 404'), 'handles 404');
  assert(src.includes('status === 409'), 'handles 409');
});

test('pendingSync cleared only when revision still matches', () => {
  const src = read('src/playback/coordinator.ts');
  const idx = src.indexOf('this.session.revision === snapshotRevision');
  assert(idx >= 0, 'revision match gate');
  const chunk = src.slice(idx, idx + 400);
  assert(chunk.includes('pendingSync: false'), 'clears pending on match');
});

test('404 does not leave unexplained crash path; keeps local-first on 500', () => {
  const src = read('src/playback/coordinator.ts');
  assert(src.includes("result: 'media_missing'"), '404 media missing');
  assert(src.includes('pendingSync: true'), 'keeps pending on failure');
});

test('playback API module removed; binder defaults sync to null', () => {
  assert(
    !fs.existsSync(path.join(root, 'src/api/playback.api.ts')),
    'playback.api.ts removed',
  );
  const bind = read('src/playback/bind-playback-persistence.ts');
  assert(
    bind.includes('sync: overrides?.sync === undefined ? null'),
    'no default cloud transport',
  );
  const types = read('src/api/types.ts');
  assert(types.includes('clientRevision?: number'), 'request revision type kept for local merge');
});

test('UpdatePlaybackProgressRequest does not send userId/progressPercent', () => {
  const types = read('src/api/types.ts');
  const start = types.indexOf('export interface UpdatePlaybackProgressRequest');
  const end = types.indexOf('export interface UpdatePlaybackProgressResponse', start);
  const body = types.slice(start, end);
  assert(!body.includes('userId'), 'no userId');
  assert(!body.includes('progressPercent'), 'no progressPercent');
  assert(!body.includes('sourceUrl'), 'no sourceUrl');
  assert(body.includes('positionSeconds'), 'position');
  assert(body.includes('durationSeconds'), 'duration');
  assert(body.includes('clientRevision'), 'revision');
});

test('sync_failed is warn-level diagnostic (not suppressed)', () => {
  const coord = read('src/playback/coordinator.ts');
  const idx = coord.indexOf("'playback.sync_failed'");
  assert(idx >= 0, 'event present');
  const chunk = coord.slice(idx, idx + 200);
  assert(chunk.includes("'warn'"), 'warn level');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
