/**
 * Week 7 Day 4 Phase 2 — Recovery / Security / Performance hardening verifier (mobile).
 * Pure logic + fixtures. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week7-day4-phase2.ts
 */

import { decideRecoveryState } from '../src/downloads/engine/recovery-decision';
import {
  applyRetryJitter,
  computeRetryDelayMs,
  shouldScheduleAutoRetry,
} from '../src/downloads/engine/retry-policy';
import { sanitizeFileName, isSafeHttpUrl } from '../src/downloads/engine/resource-guard';
import { isPrivateOrLocalHostname } from '../src/media-detection/utils/url';
import {
  evaluateNetworkAdmission,
  shouldHoldActiveTransfer,
} from '../src/downloads/scheduler/network-policy';
import { DOWNLOAD_EVENT_TYPES, REALTIME_CLIENT } from '../src/realtime/types';
import { parseDownloadRealtimeEvent } from '../src/realtime/validate';
import { shouldApplyRealtimeEvent } from '../src/realtime/ordering';

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

const baseEvidence = {
  hasActiveWorker: false,
  isQueued: false,
  isSuppressed: false,
  isHls: false,
  hasValidPartial: false,
  canResume: false,
  hasVerifiedFinalFile: false,
  completedFileMissing: false,
  sourceUrlSafe: true,
  localState: 'not_started' as const,
};

async function main(): Promise<void> {
  console.log('Week 7 Day 4 Phase 2 — hardening verifier (mobile)\n');

  await test('recovery: CANCELLED stays terminal', () => {
    const d = decideRecoveryState({
      ...baseEvidence,
      remoteStatus: 'CANCELLED',
      localState: 'paused',
    });
    assert(d.action === 'KEEP_CANCELLED', d.action);
  });

  await test('recovery: COMPLETED verified stays terminal', () => {
    const d = decideRecoveryState({
      ...baseEvidence,
      remoteStatus: 'COMPLETED',
      localState: 'complete',
      hasVerifiedFinalFile: true,
    });
    assert(d.action === 'KEEP_COMPLETED', d.action);
  });

  await test('recovery: PAUSED kept paused', () => {
    const d = decideRecoveryState({
      ...baseEvidence,
      remoteStatus: 'PAUSED',
      localState: 'paused',
      hasValidPartial: true,
      canResume: true,
    });
    assert(d.action === 'KEEP_PAUSED', d.action);
  });

  await test('recovery: stale DOWNLOADING → PAUSED when resumable', () => {
    const d = decideRecoveryState({
      ...baseEvidence,
      remoteStatus: 'DOWNLOADING',
      localState: 'transferring',
      hasValidPartial: true,
      canResume: true,
    });
    assert(d.action === 'RECOVER_TO_PAUSED', d.action);
  });

  await test('recovery: CANCELLED never becomes DOWNLOADING', () => {
    const d = decideRecoveryState({
      ...baseEvidence,
      remoteStatus: 'CANCELLED',
      localState: 'transferring',
      hasActiveWorker: false,
      hasValidPartial: true,
      canResume: true,
    });
    assert(d.action === 'KEEP_CANCELLED', d.action);
    assert(d.nextStatus !== 'DOWNLOADING', 'no resurrection');
  });

  await test('wifiOnly: cellular must hold active transfers', () => {
    assert(
      shouldHoldActiveTransfer(true, {
        connected: true,
        internetReachable: true,
        type: 'cellular',
      }),
      'hold on cellular',
    );
  });

  await test('wifiOnly: wifi allows active transfers', () => {
    assert(
      !shouldHoldActiveTransfer(true, {
        connected: true,
        internetReachable: true,
        type: 'wifi',
      }),
      'allow on wifi',
    );
  });

  await test('wifiOnly: offline holds and blocks admission', () => {
    const net = {
      connected: false,
      internetReachable: false,
      type: 'none' as const,
    };
    assert(shouldHoldActiveTransfer(true, net), 'hold offline');
    const admission = evaluateNetworkAdmission(true, net);
    assert(!admission.allowed && admission.reason === 'OFFLINE', 'offline');
  });

  await test('wifiOnly OFF: cellular admission allowed', () => {
    const admission = evaluateNetworkAdmission(false, {
      connected: true,
      internetReachable: true,
      type: 'cellular',
    });
    assert(admission.allowed, 'cellular ok when wifiOnly off');
  });

  await test('ssrf: localhost / private / metadata / mapped IPv6 blocked', () => {
    assert(isPrivateOrLocalHostname('localhost'), 'localhost');
    assert(isPrivateOrLocalHostname('127.0.0.1'), '127');
    assert(isPrivateOrLocalHostname('::1'), '::1');
    assert(isPrivateOrLocalHostname('10.0.0.1'), '10/8');
    assert(isPrivateOrLocalHostname('192.168.1.1'), '192.168');
    assert(isPrivateOrLocalHostname('169.254.169.254'), 'metadata link-local');
    assert(isPrivateOrLocalHostname('metadata.google.internal'), 'metadata host');
    assert(isPrivateOrLocalHostname('::ffff:127.0.0.1'), 'mapped loopback');
    assert(isPrivateOrLocalHostname('::ffff:169.254.169.254'), 'mapped metadata');
    assert(!isSafeHttpUrl('http://127.0.0.1/x'), 'unsafe url');
    assert(!isSafeHttpUrl('file:///etc/passwd'), 'file scheme');
    assert(isSafeHttpUrl('https://cdn.example.com/v.mp4'), 'public https');
  });

  await test('filename: traversal and control chars sanitized', () => {
    const a = sanitizeFileName('../etc/passwd');
    assert(!a.includes('..'), a);
    assert(!a.includes('/'), a);
    const b = sanitizeFileName('foo\u0000bar.mp4');
    assert(!b.includes('\u0000'), b);
    const c = sanitizeFileName('C:\\Windows\\system32\\x.mp4');
    assert(!c.includes('\\'), c);
  });

  await test('retry: deterministic backoff + jitter bounds', () => {
    assert(computeRetryDelayMs(0) === 1000, 'base');
    assert(computeRetryDelayMs(1) === 2000, '2s');
    assert(computeRetryDelayMs(20) === 60_000, 'cap');
    const jittered = applyRetryJitter(1000);
    assert(jittered >= 250 && jittered <= 60_000, String(jittered));
  });

  await test('retry: exhausted not scheduled', () => {
    assert(
      !shouldScheduleAutoRetry({
        retryEligible: true,
        retryCount: 99,
        errorCode: 'NETWORK_ERROR',
      }),
      'exhausted',
    );
  });

  await test('realtime: polling/socket bounds', () => {
    assert(REALTIME_CLIENT.pollingIntervalMs >= 3000, 'poll min');
    assert(REALTIME_CLIENT.pollingIntervalMs <= 5000, 'poll max');
    assert(DOWNLOAD_EVENT_TYPES.includes('download.completed'), 'events');
  });

  await test('realtime: malformed rejected; terminal not overwritten', () => {
    assert(parseDownloadRealtimeEvent({ type: 'nope' }) === null, 'bad');
    const decision = shouldApplyRealtimeEvent(
      {
        eventId: 'e1',
        type: 'download.progress',
        downloadId: 'd1',
        status: 'DOWNLOADING',
        progress: 10,
        version: 100,
        timestamp: new Date(100).toISOString(),
      },
      {
        id: 'd1',
        userId: 'u',
        title: 't',
        sourceUrl: 'https://cdn.example.com/x.mp4',
        platform: 'OTHER',
        thumbnailUrl: '',
        fileName: 'x.mp4',
        fileSize: '1',
        folderId: null,
        status: 'COMPLETED',
        progress: 100,
        quality: null,
        resolution: null,
        bitrate: null,
        retryCount: 0,
        workerState: 'COMPLETED',
        errorCode: null,
        errorMessage: null,
        downloadedAt: new Date(200).toISOString(),
        createdAt: new Date(50).toISOString(),
        updatedAt: new Date(200).toISOString(),
      },
      new Set(),
    );
    assert(!decision.apply, decision.reason);
  });

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
