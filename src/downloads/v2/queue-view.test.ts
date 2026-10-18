import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import type { DownloadRecord } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { QueueSnapshot } from '@/downloads/scheduler';

import type { V2EnginePort } from './engine-port';
import { setV2EngineForTests } from './engine-port';
import { ensureV2QueueRecords, useV2QueueRecords } from './queue-records-store';
import { applyQueueRecord, combineQueueSnapshots, v2QueueView, type V2QueueRecord } from './queue-view';

const r = (id: string, state: V2QueueRecord['state'], createdAt: number): V2QueueRecord => ({ id, state, createdAt });

const V1_EMPTY: QueueSnapshot = {
  active: [],
  pending: [],
  policy: { maxConcurrentDownloads: 2, wifiOnly: false },
  network: { connected: true, internetReachable: null, type: 'unknown' },
};

describe('v2 Queue view', () => {
  test('running downloads are active, waiting ones are up next, in first-come order', () => {
    const view = v2QueueView(
      [
        r('c', 'queued', 30),
        r('a', 'downloading', 10),
        r('b', 'probing', 20),
        r('d', 'waiting_retry', 40),
        r('e', 'processing', 5),
        r('f', 'waiting_network', 25),
      ],
      { wifiOnly: false },
    );
    assert.deepEqual(view.active, ['e', 'a', 'b']);
    assert.deepEqual(view.pending, [
      { downloadId: 'f', waitingReason: 'OFFLINE' },
      { downloadId: 'c', waitingReason: 'CAPACITY' },
      { downloadId: 'd', waitingReason: 'RETRY_DELAY' },
    ]);
  });

  test('waiting for the network reads as waiting for Wi-Fi under Wi-Fi only', () => {
    const view = v2QueueView([r('a', 'waiting_network', 1)], { wifiOnly: true });
    assert.deepEqual(view.pending, [{ downloadId: 'a', waitingReason: 'WAITING_FOR_WIFI' }]);
  });

  test('paused, finished, failed, cancelled and unknown states are on neither list', () => {
    const view = v2QueueView(
      [
        r('a', 'paused', 1),
        r('b', 'completed', 2),
        r('c', 'failed', 3),
        r('d', 'cancelled', 4),
        r('e', 'recording' as V2QueueRecord['state'], 5),
      ],
      { wifiOnly: false },
    );
    assert.deepEqual(view, { active: [], pending: [] });
  });

  test('v1 lists come first; places in line count across both', () => {
    const v1: QueueSnapshot = {
      ...V1_EMPTY,
      active: [{ downloadId: 'v1-a' }],
      pending: [{ downloadId: 'v1-p', position: 1, waitingReason: 'CAPACITY' }],
    };
    const combined = combineQueueSnapshots(v1, {
      active: ['v2-a'],
      pending: [
        { downloadId: 'v2-p', waitingReason: 'OFFLINE' },
        { downloadId: 'v2-q', waitingReason: 'CAPACITY' },
      ],
    });
    assert.deepEqual(combined.active, [{ downloadId: 'v1-a' }, { downloadId: 'v2-a' }]);
    assert.deepEqual(combined.pending, [
      { downloadId: 'v1-p', waitingReason: 'CAPACITY', position: 1 },
      { downloadId: 'v2-p', waitingReason: 'OFFLINE', position: 2 },
      { downloadId: 'v2-q', waitingReason: 'CAPACITY', position: 3 },
    ]);
    assert.equal(combined.policy, v1.policy, 'the v1 policy and network are kept');
  });

  test('an id in both lists is shown once, as the engine reports it', () => {
    const v1: QueueSnapshot = { ...V1_EMPTY, pending: [{ downloadId: 'x', position: 1, waitingReason: 'CAPACITY' }] };
    const combined = combineQueueSnapshots(v1, { active: ['x'], pending: [] });
    assert.deepEqual(combined.active, [{ downloadId: 'x' }]);
    assert.deepEqual(combined.pending, []);
  });

  test('state events add, move and drop records; an unchanged one keeps the same map', () => {
    let byId = applyQueueRecord({}, r('a', 'queued', 1));
    assert.deepEqual(Object.keys(byId), ['a']);
    const same = applyQueueRecord(byId, r('a', 'queued', 1));
    assert.equal(same, byId);
    byId = applyQueueRecord(byId, r('a', 'downloading', 1));
    assert.equal(byId.a?.state, 'downloading');
    byId = applyQueueRecord(byId, r('a', 'paused', 1));
    assert.deepEqual(byId, {});
    const untouched = applyQueueRecord(byId, r('b', 'completed', 2));
    assert.equal(untouched, byId);
  });
});

describe('v2 Queue records from the engine', () => {
  afterEach(() => {
    setV2EngineForTests(null);
    useV2QueueRecords.setState({ byId: {} });
  });

  test('seeded from the engine, then kept current by its state events; a newer event beats the seed', async () => {
    let emit: (record: DownloadRecord) => void = () => undefined;
    let resolveList: (records: DownloadRecord[]) => void = () => undefined;
    const record = (id: string, state: DownloadRecord['state']) => ({ id, state, createdAt: 1 }) as unknown as DownloadRecord;
    const engine = {
      listDownloads: () => new Promise<DownloadRecord[]>((resolve) => (resolveList = resolve)),
      addListener: (_name: string, listener: (event: { record: DownloadRecord }) => void) => {
        emit = (rec) => listener({ record: rec });
        return { remove: () => undefined };
      },
    } as unknown as V2EnginePort;
    setV2EngineForTests(engine);

    ensureV2QueueRecords();
    emit(record('a', 'downloading'));
    resolveList([record('a', 'queued'), record('b', 'waiting_network'), record('c', 'completed')]);
    await new Promise((resolve) => setImmediate(resolve));

    const byId = useV2QueueRecords.getState().byId;
    assert.deepEqual(Object.keys(byId).sort(), ['a', 'b']);
    assert.equal(byId.a?.state, 'downloading', 'the event after the seed was asked for wins');

    emit(record('b', 'failed'));
    assert.deepEqual(Object.keys(useV2QueueRecords.getState().byId), ['a']);
  });
});

describe('v2 Queue view in the engine start order (H4)', () => {
  test('"Up next" follows the start order given; running ones are not reordered', () => {
    const view = v2QueueView(
      [r('a', 'queued', 1), r('b', 'queued', 2), r('c', 'waiting_retry', 3), r('d', 'downloading', 4)],
      { wifiOnly: false, startOrder: (ids) => [...ids].reverse() },
    );
    assert.deepEqual(view.active, ['d']);
    assert.deepEqual(
      view.pending.map((item) => item.downloadId),
      ['c', 'b', 'a'],
    );
  });

  test('an id the order leaves out keeps its first-come place at the end; unknown ids are ignored', () => {
    const view = v2QueueView([r('a', 'queued', 1), r('b', 'queued', 2), r('c', 'queued', 3)], {
      wifiOnly: false,
      startOrder: () => ['c', 'zzz', 'a'],
    });
    assert.deepEqual(
      view.pending.map((item) => item.downloadId),
      ['c', 'a', 'b'],
    );
  });

  test("H4's queues decide: a later queue's downloads come after Main's, the user's order inside each", async () => {
    const { groupByQueue } = await import('./queue-order');
    const state = {
      queues: [
        { id: 'main', name: 'Main', held: false },
        { id: 'night', name: 'Night', held: false },
      ],
      assignments: { a: 'night' },
      order: ['c', 'b'],
    };
    const records = [r('a', 'queued', 1), r('b', 'queued', 2), r('c', 'queued', 3)];
    const byId = Object.fromEntries(records.map((record) => [record.id, record]));
    const startOrder = (ids: string[]) =>
      groupByQueue(state, ids.map((id) => ({ id, createdAt: new Date(byId[id]!.createdAt).toISOString() }))).flatMap(
        (group) => group.ids,
      );
    const view = v2QueueView(records, { wifiOnly: false, startOrder });
    assert.deepEqual(
      view.pending.map((item) => item.downloadId),
      ['c', 'b', 'a'],
    );
  });
});
