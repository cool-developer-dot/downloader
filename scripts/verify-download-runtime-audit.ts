/**
 * Phase 1A — download runtime audit verification.
 * Static architecture/invariant checks + diagnostics presence.
 *
 * Usage (from mobile/):
 *   npm run verify:download-runtime-audit
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function mustInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} missing: ${needle}`);
  }
}

function mustNotInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(!source.includes(needle), `${label} must not include: ${needle}`);
  }
}

const TRANSFER_PATHS = [
  'src/downloads/engine/fetch-single-stream-transfer.ts',
  'src/downloads/engine/append-range-transfer.ts',
  'src/downloads/engine/multi-range/part-worker.ts',
  'src/downloads/engine/hls/segment-transfer.ts',
  'src/downloads/engine/worker.ts',
];

const DRAIN_TRIGGERS = [
  "requestDrain('create')",
  "requestDrain('network_change')",
  "requestDrain('settings_change')",
  "requestDrain('release')",
  "requestDrain('cancel')",
];

const POLICY_CONSUMERS = [
  'src/downloads/scheduler/network-policy.ts',
  'src/downloads/scheduler/admission-scheduler.ts',
  'src/downloads/engine/manager.ts',
];

const DIAG_TAGS = [
  'DownloadState',
  'Scheduler',
  'NetworkPolicy',
  'Worker',
  'FirstByte',
  'Transfer',
  'Watchdog',
  'Finalize',
  'Traffic',
];

console.log('Phase 1A — Download Runtime Audit Verification\n');

async function main(): Promise<void> {
await test('audit diagnostics module exports structured tags', () => {
  const src = readSrc('src/downloads/engine/audit-diagnostics.service.ts');
  for (const tag of DIAG_TAGS) {
    assert(src.includes(`'${tag}'`), `Audit tag missing: ${tag}`);
  }
  mustInclude(src, ['sanitizeAuditUrl', 'logTrafficRequest', 'logDownloadStateTransition'], 'audit helper');
});

await test('audit diagnostics strip sensitive fields', () => {
  const src = readSrc('src/downloads/engine/audit-diagnostics.service.ts');
  mustInclude(src, ["lower.includes('cookie')", "BLOCKED_KEYS"], 'sanitizer');
  mustNotInclude(src, ['console.log(payload.cookie'], 'audit helper');
});

await test('every major transfer path is present', () => {
  for (const rel of TRANSFER_PATHS) {
    readSrc(rel);
  }
  const worker = readSrc('src/downloads/engine/worker.ts');
  mustInclude(
    worker,
    [
      'fetchSingleStreamTransfer',
      'resumeAppendRangeTransfer',
      'runMultiRangeTransfer',
      'File.createDownloadTask',
    ],
    'worker routing',
  );
});

await test('scheduler drain triggers enumerated', () => {
  const scheduler = readSrc('src/downloads/scheduler/admission-scheduler.ts');
  for (const trigger of DRAIN_TRIGGERS) {
    assert(scheduler.includes(trigger), `Drain trigger missing: ${trigger}`);
  }
  mustInclude(scheduler, ['logSchedulerDrain', 'logSchedulerDecision'], 'scheduler diagnostics');
});

await test('network policy consumers enumerated', () => {
  for (const rel of POLICY_CONSUMERS) {
    const src = readSrc(rel);
    assert(
      src.includes('evaluateNetworkAdmission') || src.includes('shouldHoldActiveTransfer'),
      `${rel} must reference network admission helpers`,
    );
  }
  const network = readSrc('src/downloads/network/service.ts');
  mustInclude(network, ['logNetworkPolicy', 'NetInfo'], 'network monitor');
});

await test('queue admission and worker release paths traceable', () => {
  const manager = readSrc('src/downloads/engine/manager.ts');
  mustInclude(
    manager,
    ['admitWorker', 'ensureScheduler().release', 'logWorkerLifecycle'],
    'manager admission/release',
  );
  const scheduler = readSrc('src/downloads/scheduler/admission-scheduler.ts');
  mustInclude(scheduler, ['onAdmit', 'release(', 'peekFirstEligiblePending'], 'scheduler admission');
});

await test('transfer paths classified for traffic attribution', () => {
  const audit = readSrc('src/downloads/engine/audit-diagnostics.service.ts');
  mustInclude(
    audit,
    [
      'metadata_probe',
      'candidate_verification',
      'download_transfer',
      'hls_segment',
      'browser_observation',
    ],
    'traffic classes',
  );
  mustInclude(readSrc('src/downloads/analyze/probe.ts'), ['logTrafficRequest'], 'analyze probe traffic');
  mustInclude(
    readSrc('src/downloads/engine/fetch-single-stream-transfer.ts'),
    ['logTrafficRequest'],
    'social transfer traffic',
  );
});

await test('signed URL / request context not logged in audit helper', () => {
  const audit = readSrc('src/downloads/engine/audit-diagnostics.service.ts');
  mustInclude(audit, ["value.startsWith('http')", 'safeDownloadHostname'], 'url sanitization');
  mustNotInclude(audit, ['logDownloadAudit(tag, { sourceUrl'], 'raw url logging');
});

await test('state / scheduler / network / first-byte / watchdog / finalization diagnostics present', () => {
  mustInclude(readSrc('src/downloads/engine/manager.ts'), ['logDownloadStateTransition'], 'state diagnostics');
  mustInclude(readSrc('src/downloads/engine/worker.ts'), ['logFirstByte', 'logFinalize'], 'worker diagnostics');
  mustInclude(readSrc('src/downloads/engine/stall-watchdog.ts'), ['logWatchdog'], 'watchdog diagnostics');
});

await test('admit failure drop behavior documented in scheduler (no auto-requeue)', () => {
  const scheduler = readSrc('src/downloads/scheduler/admission-scheduler.ts');
  mustInclude(scheduler, ["outcome: 'REQUEUE'", 'rotatePendingToBack'], 'admit requeue invariant');
  mustNotInclude(scheduler, ['do not requeue automatically'], 'legacy admit drop');
});

await test('Phase 1C: scheduler admission emits STARTING not DOWNLOADING', () => {
  const manager = readSrc('src/downloads/engine/manager.ts');
  mustInclude(manager, ["executionState: 'STARTING'", 'worker_admitted'], 'STARTING on admit');
  mustNotInclude(manager, ["setStatusHint(input.id, 'DOWNLOADING', 'scheduler_admission')"], 'premature DOWNLOADING admit');
  const worker = readSrc('src/downloads/engine/worker.ts');
  mustInclude(worker, ["syncStatusImmediate(input.id, 'QUEUED', { workerState: 'STARTING' })"], 'worker STARTING sync');
  mustNotInclude(worker, ['syncStatusImmediate(input.id, \'DOWNLOADING\')'], 'premature worker DOWNLOADING sync');
});

await test('native progressive path uses shared transferWatchdog (Phase 1D)', () => {
  const worker = readSrc('src/downloads/engine/worker.ts');
  mustInclude(worker, ['const transferWatchdog = new StallWatchdog'], 'unified transfer watchdog');
  mustInclude(worker, ['armFirstByteWatchdog'], 'first-byte arming');
  mustInclude(worker, ['File.createDownloadTask'], 'native createDownloadTask path');
  mustInclude(worker, ['transferWatchdog.noteBytes'], 'native progress feeds watchdog');
});

await test('social refresh handoff returns HANDOFF not STARTED (Phase 1B fix)', () => {
  const manager = readSrc('src/downloads/engine/manager.ts');
  mustInclude(
    manager,
    ['return admissionHandoff('],
    'refresh handoff',
  );
  assert(
    !manager.includes('if (refreshed) {\n          await coordinator.endExecution(input.id);\n          return true;'),
    'legacy slot-leak return true removed',
  );
});

await test('Wi-Fi-only default is false in settings (Phase 1B)', () => {
  const settings = readSrc('src/downloads/settings/types.ts');
  mustInclude(settings, ['wifiOnly: false'], 'default wifiOnly');
});

await test('pre-download / analyze paths bypass scheduler policy (audit finding)', () => {
  const analyze = readSrc('src/downloads/analyze/analyze-url.ts');
  const gate = readSrc('src/media-detection/services/pre-download-gate.service.ts');
  assert(!analyze.includes('evaluateNetworkAdmission'), 'analyze must not gate on wifi policy');
  assert(!gate.includes('evaluateNetworkAdmission'), 'pre-download gate must not gate on wifi policy');
});

await test('production download semantics unchanged — no scheduler redesign markers', () => {
  const scheduler = readSrc('src/downloads/scheduler/admission-scheduler.ts');
  mustInclude(scheduler, ['class AdmissionScheduler', 'peekFirstEligiblePending'], 'scheduler core intact');
  mustNotInclude(scheduler, ['TODO: redesign', 'REFACTOR_SCHEDULER'], 'scheduler');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
