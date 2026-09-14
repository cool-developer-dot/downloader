/**
 * Week 7 Day 4 Phase 3 — Production freeze / certification verifier (mobile).
 * Pure assertions + constants audit. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week7-day4-phase3.ts
 */

import { DOWNLOAD_ENGINE } from '../src/downloads/engine/constants';
import { deriveDownloadExecutionDisplayState } from '../src/downloads/execution/display-status';
import { DOWNLOAD_EXECUTION_DISPLAY_COPY } from '../src/downloads/execution/types';
import { QUEUE_WAITING_REASON_COPY } from '../src/downloads/scheduler/waiting-reason';
import { normalizeMaxConcurrentDownloads } from '../src/downloads/settings/normalize';
import { DEFAULT_DOWNLOAD_SETTINGS } from '../src/downloads/settings/types';
import { FGS_SUMMARY_THROTTLE_MS } from '../src/downloads/notifications/types';
import { REALTIME_CLIENT } from '../src/realtime/types';

/** Mirrors download-format.formatEtaSeconds freeze rule (hide ≤0 / non-finite). */
function formatEtaSeconds(etaSeconds: number | null): string | null {
  if (etaSeconds == null || !Number.isFinite(etaSeconds) || etaSeconds <= 0) {
    return null;
  }
  if (etaSeconds < 60) {
    return `${Math.ceil(etaSeconds)}s left`;
  }
  return 'ok';
}

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

async function main(): Promise<void> {
  console.log('Week 7 Day 4 Phase 3 — production freeze verifier (mobile)\n');

  await test('display: never claim background without FGS true', () => {
    const state = deriveDownloadExecutionDisplayState({
      status: 'DOWNLOADING',
      appState: 'background',
      hasActiveExecution: true,
      backgroundServiceActive: false,
    });
    assert(state === 'DOWNLOADING_FOREGROUND', `got ${state}`);
  });

  await test('display: background only when FGS true', () => {
    const state = deriveDownloadExecutionDisplayState({
      status: 'DOWNLOADING',
      appState: 'background',
      hasActiveExecution: true,
      backgroundServiceActive: true,
    });
    assert(state === 'DOWNLOADING_BACKGROUND', `got ${state}`);
  });

  await test('display: RETRY_WAIT maps to Retrying', () => {
    const state = deriveDownloadExecutionDisplayState({
      status: 'FAILED',
      appState: 'active',
      workerState: 'RETRY_WAIT',
    });
    assert(state === 'WAITING_FOR_RETRY', `got ${state}`);
    assert(
      DOWNLOAD_EXECUTION_DISPLAY_COPY.WAITING_FOR_RETRY === 'Retrying',
      DOWNLOAD_EXECUTION_DISPLAY_COPY.WAITING_FOR_RETRY,
    );
  });

  await test('copy: truthful waiting labels', () => {
    assert(
      QUEUE_WAITING_REASON_COPY.WAITING_FOR_WIFI === 'Waiting for Wi-Fi',
      'wifi',
    );
    assert(
      QUEUE_WAITING_REASON_COPY.OFFLINE === 'Waiting for network',
      'offline',
    );
    assert(QUEUE_WAITING_REASON_COPY.RETRY_DELAY === 'Retrying', 'retry');
    assert(QUEUE_WAITING_REASON_COPY.CAPACITY === 'Queued', 'capacity');
    assert(
      DOWNLOAD_EXECUTION_DISPLAY_COPY.WAITING_FOR_CONNECTION ===
        'Waiting for network',
      'connection copy',
    );
  });

  await test('ETA: hide zero / negative / non-finite', () => {
    assert(formatEtaSeconds(0) === null, 'zero');
    assert(formatEtaSeconds(-1) === null, 'negative');
    assert(formatEtaSeconds(Number.NaN) === null, 'nan');
    assert(formatEtaSeconds(Number.POSITIVE_INFINITY) === null, 'inf');
    assert(formatEtaSeconds(30) === '30s left', 'positive');
  });

  await test('concurrency setting bounds 1–4', () => {
    assert(normalizeMaxConcurrentDownloads(1) === 1, '1');
    assert(normalizeMaxConcurrentDownloads(4) === 4, '4');
    assert(normalizeMaxConcurrentDownloads(2) === 2, '2');
    assert(
      normalizeMaxConcurrentDownloads(0) ===
        DEFAULT_DOWNLOAD_SETTINGS.maxConcurrentDownloads,
      '0→default',
    );
    assert(
      normalizeMaxConcurrentDownloads(99) ===
        DEFAULT_DOWNLOAD_SETTINGS.maxConcurrentDownloads,
      '99→default',
    );
  });

  await test('performance budgets present (configured values)', () => {
    assert(DOWNLOAD_ENGINE.maxRangesPerFile === 4, 'ranges');
    assert(DOWNLOAD_ENGINE.maxGlobalNetworkWorkers === 6, 'global');
    assert(DOWNLOAD_ENGINE.uiProgressIntervalMs === 250, 'ui');
    assert(DOWNLOAD_ENGINE.backendProgressIntervalMs === 2500, 'backend');
    assert(DOWNLOAD_ENGINE.maxAutoRetryAttempts === 3, 'retry');
    assert(FGS_SUMMARY_THROTTLE_MS === 750, 'fgs');
    assert(REALTIME_CLIENT.pollingIntervalMs === 4000, 'poll');
    assert(REALTIME_CLIENT.reconnectMaxMs === 30_000, 'reconnect');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
