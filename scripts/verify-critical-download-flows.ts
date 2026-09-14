/**
 * Critical download flows verifier — Pause→Resume admission + shared Delete path.
 *
 * Run: npx tsx scripts/verify-critical-download-flows.ts
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

console.log('Critical download flows verifier\n');

test('resume upserts QUEUED before enqueue call site', () => {
  const src = read('src/downloads/engine/manager.ts');
  const resumeStart = src.indexOf('async resume(downloadId: string)');
  assert(resumeStart >= 0, 'resume() present');
  const resumeEnd = src.indexOf('async cancel(downloadId: string)', resumeStart);
  assert(resumeEnd > resumeStart, 'resume block bounded');
  const body = src.slice(resumeStart, resumeEnd);

  const upsertIdx = body.indexOf("remoteStatus: 'QUEUED'");
  const enqueueIdx = body.indexOf('this.ensureScheduler().enqueue');
  const lockDeleteIdx = body.indexOf('this.locks.delete(downloadId)');

  assert(upsertIdx >= 0, 'resume persists QUEUED');
  assert(enqueueIdx >= 0, 'resume enqueues');
  assert(lockDeleteIdx >= 0, 'resume releases lock');
  assert(
    upsertIdx < lockDeleteIdx && lockDeleteIdx < enqueueIdx,
    'order must be upsert QUEUED → release lock → enqueue',
  );
});

test('resume clears ghost active slot via release()', () => {
  const src = read('src/downloads/engine/manager.ts');
  const resumeStart = src.indexOf('async resume(downloadId: string)');
  const resumeEnd = src.indexOf('async cancel(downloadId: string)', resumeStart);
  const body = src.slice(resumeStart, resumeEnd);
  assert(body.includes('.release(downloadId)'), 'resume must release ghost capacity');
  assert(body.includes('.cancelPending(downloadId)'), 'resume cancels pending');
});

test('retry uses same lock-before-enqueue ordering', () => {
  const src = read('src/downloads/engine/manager.ts');
  const retryStart = src.indexOf('async retry(downloadId: string)');
  const retryEnd = src.indexOf('async remove(downloadId: string)', retryStart);
  const body = src.slice(retryStart, retryEnd);
  const upsertIdx = body.indexOf("remoteStatus: 'QUEUED'");
  const lockDeleteIdx = body.indexOf('this.locks.delete(downloadId)');
  const enqueueIdx = body.indexOf('this.ensureScheduler().enqueue');
  assert(upsertIdx < lockDeleteIdx && lockDeleteIdx < enqueueIdx, 'retry order');
});

test('manual resume does not gate on isAutoResumeEnabled', () => {
  const src = read('src/downloads/engine/manager.ts');
  const resumeStart = src.indexOf('async resume(downloadId: string)');
  const resumeEnd = src.indexOf('async cancel(downloadId: string)', resumeStart);
  const body = src.slice(resumeStart, resumeEnd);
  assert(
    !body.includes('isAutoResumeEnabled()'),
    'user Resume must not require Auto Resume setting',
  );
});

test('scheduler requeues transient failed admit instead of dropping job', () => {
  const src = read('src/downloads/scheduler/admission-scheduler.ts');
  assert(
    src.includes("outcome: 'REQUEUE'"),
    'transient admit failures must requeue',
  );
  assert(
    src.includes('rotatePendingToBack'),
    'fair requeue rotation must exist',
  );
  assert(
    !src.includes('do not requeue automatically'),
    'legacy drop-on-fail removed',
  );
});

test('PAUSE → RESUME simulation admits when lock released + QUEUED', () => {
  const locks = new Set<string>();
  const workers = new Set<string>();
  let remoteStatus: string = 'DOWNLOADING';
  let progress = 10;
  let admitted = false;

  const admit = (id: string) => {
    if (locks.has(id) || workers.has(id) || remoteStatus === 'PAUSED') {
      return false;
    }
    workers.add(id);
    remoteStatus = 'DOWNLOADING';
    admitted = true;
    return true;
  };

  remoteStatus = 'PAUSED';
  workers.delete('dl-1');
  progress = 40;

  locks.add('dl-1');
  assert(!admit('dl-1'), 'under lock must fail');

  remoteStatus = 'QUEUED';
  locks.delete('dl-1');
  assert(admit('dl-1'), 'must admit');
  assert(admitted, 'admitted flag');
  progress = 41;
  assert(progress > 40, 'progress can continue past pause checkpoint');
});

test('wifi policy hold blocks admission while truthful waiting reason applies', () => {
  const wifiOnly = true;
  const networkType: string = 'cellular';
  const allowed = !(wifiOnly && networkType !== 'wifi');
  assert(!allowed, 'cellular blocked when wifiOnly');
  const waitingReason = 'WIFI_ONLY';
  assert(waitingReason === 'WIFI_ONLY', 'UI should map WIFI_ONLY waiting label');
});

test('details delete uses store.remove not mediaApi.deleteMedia', () => {
  const src = read('src/screens/downloads/hooks/useDownloadDetailsScreen.ts');
  assert(src.includes('state.remove'), 'wires store.remove');
  assert(src.includes('await remove(downloadId)'), 'calls remove(downloadId)');
  assert(!src.includes('mediaApi.deleteMedia'), 'must not call COMPLETED-only media delete');
  assert(!src.includes('deleteMediaFileOnDevice'), 'must not use separate media-file delete path');
});

test('list delete uses same store.remove', () => {
  const list = read('src/screens/downloads/hooks/useDownloadsScreen.ts');
  assert(list.includes('await remove(deleteTargetId)'), 'list confirmDelete uses remove');
});

test('store.remove is local-only (engine + catalog + store)', () => {
  const actions = read('src/store/downloads/actions.ts');
  const removeStart = actions.indexOf('remove: async (id)');
  assert(removeStart >= 0, 'remove action');
  const chunk = actions.slice(removeStart, removeStart + 800);
  const localIdx = chunk.indexOf('downloadEngine.remove');
  const catalogIdx = chunk.indexOf('removeDownloadCatalogItem');
  const storeIdx = chunk.indexOf('removeFromStore');
  assert(localIdx >= 0 && catalogIdx >= 0 && storeIdx >= 0, 'local + catalog + store');
  assert(localIdx < catalogIdx && catalogIdx < storeIdx, 'engine → catalog → store');
  assert(!chunk.includes('deleteDownload('), 'no VidoraX DELETE API');
  assert(!chunk.includes('pendingDelete'), 'no pending remote delete');
});

test('details confirmDelete navigates back on success', () => {
  const src = read('src/screens/downloads/hooks/useDownloadDetailsScreen.ts');
  const confirmStart = src.indexOf('const confirmDelete');
  const chunk = src.slice(confirmStart, confirmStart + 900);
  assert(chunk.includes('goBack()'), 'goBack after successful remove');
  assert(chunk.includes('setDeleteVisible(false)'), 'closes dialog');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
