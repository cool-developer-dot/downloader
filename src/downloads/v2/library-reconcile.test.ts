import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { V2EnginePort } from './engine-port.ts';
import { createLibraryReconciler, LIBRARY_RECONCILE_TTL_MS } from './library-reconcile.ts';
import { fileQualityLabel, projectV2Download, projectV2LibraryItem } from './projection.ts';
import { downloadRecord, libraryItem } from './test-fixtures.ts';

type Calls = (string[] | null | undefined)[];

function fakeEngine(answer: (ids: string[] | null | undefined) => Promise<string[]>, calls: Calls): V2EnginePort {
  return {
    reconcileLibrary: (ids?: string[] | null) => {
      calls.push(ids);
      return answer(ids);
    },
  } as unknown as V2EnginePort;
}

test('a file removed outside VidoraX takes its library row with it', async () => {
  const calls: Calls = [];
  const removed: string[][] = [];
  const reconciler = createLibraryReconciler({
    engine: () => fakeEngine(async () => ['gone-1'], calls),
    onRemoved: (ids) => removed.push(ids),
  });

  assert.deepEqual(await reconciler.reconcileAll(), ['gone-1']);
  assert.deepEqual(calls, [null], 'a whole-library check');
  assert.deepEqual(removed, [['gone-1']], 'the stale row leaves the store even if the native event is missed');
});

test('a whole-library check runs at most once per interval unless forced', async () => {
  let clock = 1_000;
  const calls: Calls = [];
  const reconciler = createLibraryReconciler({
    engine: () => fakeEngine(async () => [], calls),
    onRemoved: () => undefined,
    now: () => clock,
  });

  await reconciler.reconcileAll();
  clock += 1_000;
  await reconciler.reconcileAll();
  assert.equal(calls.length, 1, 'a focus burst shares one scan');

  await reconciler.reconcileAll({ force: true });
  assert.equal(calls.length, 2, 'pull-to-refresh always checks');

  clock += LIBRARY_RECONCILE_TTL_MS;
  await reconciler.reconcileAll();
  assert.equal(calls.length, 3);
});

test('concurrent whole-library checks share one run', async () => {
  const calls: Calls = [];
  let finish: (ids: string[]) => void = () => undefined;
  const reconciler = createLibraryReconciler({
    engine: () => fakeEngine(() => new Promise((resolve) => { finish = resolve; }), calls),
    onRemoved: () => undefined,
  });

  const first = reconciler.reconcileAll();
  const second = reconciler.reconcileAll({ force: true });
  finish(['x']);
  assert.deepEqual(await first, ['x']);
  assert.deepEqual(await second, ['x']);
  assert.equal(calls.length, 1);
});

test('a targeted check always runs, for exactly the ids asked', async () => {
  const calls: Calls = [];
  const reconciler = createLibraryReconciler({
    engine: () => fakeEngine(async (ids) => ids ?? [], calls),
    onRemoved: () => undefined,
  });

  assert.deepEqual(await reconciler.reconcileIds([' a ', 'a', '', 'b']), ['a', 'b']);
  assert.deepEqual(await reconciler.reconcileIds([]), []);
  assert.deepEqual(calls, [['a', 'b']]);
});

test('an older native build or a failing check leaves the library as it was', async () => {
  const noEngine = createLibraryReconciler({ engine: () => null, onRemoved: () => assert.fail('nothing removed') });
  assert.deepEqual(await noEngine.reconcileAll(), []);

  const oldBuild = createLibraryReconciler({
    engine: () => ({}) as V2EnginePort,
    onRemoved: () => assert.fail('nothing removed'),
  });
  assert.deepEqual(await oldBuild.reconcileIds(['a']), []);

  const failing = createLibraryReconciler({
    engine: () => fakeEngine(async () => { throw new Error('ERR_STORAGE'); }, []),
    onRemoved: () => assert.fail('nothing removed'),
  });
  assert.deepEqual(await failing.reconcileAll(), []);
});

test('a finished row shows the quality its file really has', () => {
  assert.equal(fileQualityLabel({ width: 640, height: 360 }), '360p');
  assert.equal(fileQualityLabel({ width: 720, height: 1280 }), '720p', 'a vertical video reads like its landscape twin');
  assert.equal(fileQualityLabel({ width: null, height: 360 }), null);

  const completed = projectV2Download(downloadRecord({ state: 'completed', qualityLabel: 'Original Quality' }), {
    library: libraryItem({ width: 854, height: 480 }),
  });
  assert.equal(completed.item.quality, '480p');

  const unknownSize = projectV2Download(downloadRecord({ state: 'completed', qualityLabel: '720p' }), {
    library: libraryItem({ width: null, height: null }),
  });
  assert.equal(unknownSize.item.quality, '720p', 'the offer label stays when the file reported no size');

  const active = projectV2Download(downloadRecord({ state: 'downloading', qualityLabel: '1080p' }));
  assert.equal(active.item.quality, '1080p', 'an unfinished download shows the quality that was chosen');

  assert.equal(projectV2LibraryItem(libraryItem({ width: 1080, height: 1920 })).item.quality, '1080p');
});
