/**
 * Week 7 Day 4 Phase 1 — Realtime client verification (mobile).
 * Pure logic / fixtures. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week7-day4-phase1.ts
 */

import {
  eventToDownloadPatch,
  shouldApplyRealtimeEvent,
  skeletonItemFromEvent,
} from '../src/realtime/ordering';
import { parseDownloadRealtimeEvent } from '../src/realtime/validate';
import {
  DOWNLOAD_EVENT_TYPES,
  REALTIME_CLIENT,
  type DownloadRealtimeEvent,
} from '../src/realtime/types';

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

function baseEvent(
  overrides: Partial<DownloadRealtimeEvent> = {},
): DownloadRealtimeEvent {
  return {
    eventId: 'evt-1',
    type: 'download.progress',
    downloadId: 'dl-1',
    status: 'DOWNLOADING',
    progress: 42,
    version: 1_700_000_000_000,
    timestamp: new Date(1_700_000_000_000).toISOString(),
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log('Week 7 Day 4 Phase 1 — mobile realtime client verifier\n');

  await test('contract exports required event types', () => {
    assert(DOWNLOAD_EVENT_TYPES.includes('download.queued'), 'queued');
    assert(DOWNLOAD_EVENT_TYPES.includes('download.started'), 'started');
    assert(DOWNLOAD_EVENT_TYPES.includes('download.progress'), 'progress');
    assert(DOWNLOAD_EVENT_TYPES.includes('download.paused'), 'paused');
    assert(DOWNLOAD_EVENT_TYPES.includes('download.resumed'), 'resumed');
    assert(DOWNLOAD_EVENT_TYPES.includes('download.retrying'), 'retrying');
    assert(DOWNLOAD_EVENT_TYPES.includes('download.completed'), 'completed');
    assert(DOWNLOAD_EVENT_TYPES.includes('download.failed'), 'failed');
    assert(DOWNLOAD_EVENT_TYPES.includes('download.cancelled'), 'cancelled');
  });

  await test('validate accepts normalized payload', () => {
    const parsed = parseDownloadRealtimeEvent(baseEvent({ retryCount: 2 }));
    assert(parsed, 'parsed');
    assert(parsed.downloadId === 'dl-1', 'id');
    assert(parsed.retryCount === 2, 'retry');
  });

  await test('validate rejects unknown type', () => {
    assert(
      parseDownloadRealtimeEvent(
        baseEvent({ type: 'download.hacked' as never }),
      ) === null,
      'null',
    );
  });

  await test('validate rejects missing downloadId', () => {
    assert(
      parseDownloadRealtimeEvent({
        ...baseEvent(),
        downloadId: '',
      }) === null,
      'null',
    );
  });

  await test('validate rejects non-numeric progress', () => {
    assert(
      parseDownloadRealtimeEvent({
        ...baseEvent(),
        progress: 'nope' as unknown as number,
      }) === null,
      'null',
    );
  });

  await test('validate clamps progress and drops invalid speed', () => {
    const parsed = parseDownloadRealtimeEvent({
      ...baseEvent(),
      progress: 150,
      speed: Number.NaN,
      eta: Number.POSITIVE_INFINITY,
    });
    assert(parsed, 'parsed');
    assert(parsed.progress === 100, 'clamped');
    assert(parsed.speed === undefined, 'no nan speed');
    assert(parsed.eta === undefined, 'no inf eta');
  });

  await test('validate ignores failureReason when not failed', () => {
    const parsed = parseDownloadRealtimeEvent(
      baseEvent({ failureReason: 'x', status: 'DOWNLOADING' }),
    );
    assert(parsed, 'parsed');
    assert(parsed.failureReason === undefined, 'omitted');
  });

  await test('no sensitive keys survive validation shape', () => {
    const raw = {
      ...baseEvent(),
      token: 'SECRET',
      authorization: 'Bearer x',
      sourceUrl: 'https://cdn/x?sig=1',
    };
    const parsed = parseDownloadRealtimeEvent(raw);
    assert(parsed, 'parsed');
    assert(!('token' in parsed), 'no token');
    assert(!('authorization' in parsed), 'no auth');
    assert(!('sourceUrl' in parsed), 'no source');
  });

  await test('duplicate eventId ignored', () => {
    const event = baseEvent();
    const seen = new Set<string>([event.eventId]);
    const decision = shouldApplyRealtimeEvent(event, null, seen);
    assert(!decision.apply, decision.reason);
    assert(decision.reason === 'duplicate_event_id', decision.reason);
  });

  await test('stale version ignored', () => {
    const existing = skeletonItemFromEvent(
      baseEvent({ version: 2_000, timestamp: new Date(2_000).toISOString() }),
    );
    const decision = shouldApplyRealtimeEvent(
      baseEvent({ eventId: 'newer-id', version: 1_000 }),
      existing,
      new Set(),
    );
    assert(!decision.apply, decision.reason);
    assert(decision.reason === 'stale_version', decision.reason);
  });

  await test('newer version applied', () => {
    const existing = skeletonItemFromEvent(
      baseEvent({ version: 1_000, timestamp: new Date(1_000).toISOString() }),
    );
    const decision = shouldApplyRealtimeEvent(
      baseEvent({ eventId: 'v2', version: 2_000, progress: 80 }),
      existing,
      new Set(),
    );
    assert(decision.apply, decision.reason);
  });

  await test('terminal not overwritten by older active event', () => {
    const existing = skeletonItemFromEvent(
      baseEvent({
        type: 'download.completed',
        status: 'COMPLETED',
        progress: 100,
        version: 5_000,
        timestamp: new Date(5_000).toISOString(),
      }),
    );
    const decision = shouldApplyRealtimeEvent(
      baseEvent({
        eventId: 'stale-active',
        type: 'download.progress',
        status: 'DOWNLOADING',
        progress: 50,
        version: 4_000,
      }),
      existing,
      new Set(),
    );
    assert(!decision.apply, decision.reason);
  });

  await test('patch clears failure fields on completed', () => {
    const patch = eventToDownloadPatch(
      baseEvent({
        type: 'download.completed',
        status: 'COMPLETED',
        progress: 100,
      }),
    );
    assert(patch.errorCode === null, 'code');
    assert(patch.errorMessage === null, 'msg');
    assert(patch.progress === 100, 'progress');
  });

  await test('reconnect backoff bounds', () => {
    assert(REALTIME_CLIENT.reconnectBaseMs === 1_000, 'base');
    assert(REALTIME_CLIENT.reconnectMaxMs === 30_000, 'max');
    assert(REALTIME_CLIENT.pollingIntervalMs >= 3_000, 'poll min');
    assert(REALTIME_CLIENT.pollingIntervalMs <= 5_000, 'poll max');
  });

  await test('skeleton failed reason split', () => {
    const merged = skeletonItemFromEvent(
      baseEvent({
        type: 'download.failed',
        status: 'FAILED',
        failureReason: 'NETWORK: boom',
        workerState: 'FAILED',
      }),
    );
    assert(merged.status === 'FAILED', 'status');
    assert(merged.errorCode === 'NETWORK', 'code');
    assert(merged.errorMessage === 'boom', 'msg');
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
