/**
 * P12 Export extras started from the Player, through the app's one edit job (the real edit-job.ts): Create GIF runs as
 * a job task (`startTask`) and Merge / Change speed as `startEdit` edits. idle → running → done / cancelled / failed /
 * no space; one at a time (also against an edit from Download details); the player paused before it starts; a GIF's
 * result and the Android 9 permission refusal.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { EditRequest, GifRequest, GifResult, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { createEditJob, type EditJobState } from './edit-job';
import { EDIT_FREE_SPACE_MARGIN_BYTES } from './edit-plan';
import { playerExportMessageKey, runPlayerExport, type PlayerExportDeps, type PlayerExportInput } from './player-export-run';

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'lib1',
    title: 'Beach clip',
    site: 'web',
    pageUrl: null,
    fileUri: 'file:///data/library/web/Beach%20clip_lib1.mp4',
    fileName: 'Beach clip_lib1.mp4',
    mimeType: 'video/mp4',
    container: 'mp4',
    videoCodec: 'video/avc',
    audioCodec: 'audio/mp4a-latm',
    hasAudio: true,
    width: 1920,
    height: 1080,
    durationMs: 600_000,
    sizeBytes: 600_000_000,
    thumbnailUri: null,
    favorite: false,
    galleryUri: null,
    createdAt: 1,
    completedAt: 1,
    ...overrides,
  } as LibraryItem;
}

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

const GIF_RESULT: GifResult = {
  uri: 'content://media/external/images/media/7',
  shareName: 'Beach clip 0m02.0s.gif',
  width: 480,
  height: 270,
  frames: 50,
  bytes: 3_900_000,
  durationMs: 5_000,
};

/** The real edit job with a native side the test finishes by hand. */
function harness(options: { items?: LibraryItem[]; freeBytes?: number | null; gif?: boolean } = {}) {
  const library = new Map((options.items ?? [item()]).map((entry) => [entry.id, entry]));
  const states: EditJobState[] = [];
  const requests: EditRequest[] = [];
  const gifRequests: GifRequest[] = [];
  const events: string[] = [];
  let finish: (result: { value?: unknown; error?: unknown }) => void = () => {};
  const pending = <T,>() =>
    new Promise<T>((resolve, reject) => {
      finish = ({ value, error }) => (error ? reject(error) : resolve(value as T));
    });
  const job = createEditJob({
    startEdit: (request) => {
      requests.push(request);
      events.push('native-start');
      return pending<LibraryItem>();
    },
    getProgress: () => null,
    cancelEdit: async () => {
      finish({ error: coded('ERR_EDIT_CANCELLED') });
    },
    onChange: (state) => states.push(state),
    schedule: () => 0,
    clear: () => undefined,
  });
  const deps: PlayerExportDeps = {
    job,
    gif:
      options.gif === false
        ? null
        : {
            startGifExport: (request) => {
              gifRequests.push(request);
              events.push('gif-start');
              return pending<GifResult>();
            },
          },
    getItem: async (id) => library.get(id) ?? null,
    getItems: async (ids) => ids.map((id) => library.get(id)).filter((entry): entry is LibraryItem => entry != null),
    getFreeBytes: async () => (options.freeBytes === undefined ? 50_000_000_000 : options.freeBytes),
    pausePlayer: () => events.push('pause'),
    onStarted: (input: PlayerExportInput, sourceId: string) => events.push(`started:${input.kind}:${sourceId}`),
    outputLabel: (input) => (input.kind === 'merge' ? 'merged' : input.kind === 'speed' ? `${input.speed}× speed` : 'GIF'),
    gifFallbackTitle: 'Clip',
  };
  return {
    job,
    deps,
    states,
    requests,
    gifRequests,
    events,
    finish: (result: { value?: unknown; error?: unknown }) => finish(result),
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const GIF: PlayerExportInput = { kind: 'gif', id: 'lib1', choice: { startMs: 2_000, lengthMs: 5_000, width: 480, fps: 10 } };

describe('Create GIF from the Player', () => {
  test('idle → running → done: paused first, the GIF request, its result handed back', async () => {
    const h = harness();
    assert.equal(h.job.state().phase, 'idle');
    const outcome = runPlayerExport(h.deps, GIF);
    await settle();
    assert.deepEqual(h.events, ['pause', 'started:gif:lib1', 'gif-start']);
    assert.deepEqual(h.job.state(), { phase: 'running', sourceId: 'lib1', kind: 'gif', progress: null });
    assert.deepEqual(h.gifRequests[0], {
      sourceId: 'lib1',
      startMs: 2_000,
      endMs: 7_000,
      width: 480,
      fps: 10,
      title: 'Beach clip 0m02.0s',
    });
    assert.equal(h.requests.length, 0);
    h.finish({ value: GIF_RESULT });
    const result = await outcome;
    assert.deepEqual(result, {
      kind: 'finished',
      state: { phase: 'done', sourceId: 'lib1', kind: 'gif', itemId: GIF_RESULT.uri },
      gif: GIF_RESULT,
      permission: false,
    });
    assert.equal(playerExportMessageKey(result), 'videoPlayer.gifSaved');
  });

  test('Cancel stops the GIF like any edit; nothing is handed back', async () => {
    const h = harness();
    const outcome = runPlayerExport(h.deps, GIF);
    await settle();
    h.job.cancel();
    const result = await outcome;
    assert.deepEqual(result, { kind: 'finished', state: { phase: 'cancelled', sourceId: 'lib1', kind: 'gif' }, gif: null, permission: false });
    assert.equal(playerExportMessageKey(result), 'mediaEdit.cancelled');
  });

  test('Android 9 without the storage permission says so; the native space check is reported too', async () => {
    const h = harness();
    const outcome = runPlayerExport(h.deps, GIF);
    await settle();
    h.finish({ error: coded('ERR_STORAGE_PERMISSION') });
    const result = await outcome;
    assert.equal(result.kind === 'finished' && result.permission, true);
    assert.equal(playerExportMessageKey(result), 'thumbnailSave.needsPermission');

    const full = harness();
    const second = runPlayerExport(full.deps, GIF);
    await settle();
    full.finish({ error: coded('ERR_NO_SPACE') });
    assert.equal(playerExportMessageKey(await second), 'mediaEdit.noSpace');
  });

  test('the space check counts the GIF at most, twice, before anything starts', async () => {
    // 5 s at 10 fps, 480 × 270: 19 595 166 bytes (gifSpaceNeededBytes) + the margin.
    const tight = harness({ freeBytes: 19_595_166 + EDIT_FREE_SPACE_MARGIN_BYTES - 1 });
    assert.deepEqual(await runPlayerExport(tight.deps, GIF), { kind: 'no-space' });
    assert.deepEqual(tight.events, []);
    const enough = harness({ freeBytes: 19_595_166 + EDIT_FREE_SPACE_MARGIN_BYTES });
    const outcome = runPlayerExport(enough.deps, GIF);
    await settle();
    assert.equal(enough.job.state().phase, 'running');
    enough.finish({ value: GIF_RESULT });
    await outcome;
  });

  test('not offered without the native export, for audio, or without a size', async () => {
    assert.deepEqual(await runPlayerExport(harness({ gif: false }).deps, GIF), { kind: 'unavailable' });
    const audio = await runPlayerExport(harness({ items: [item({ mimeType: 'audio/mp4' })] }).deps, GIF);
    assert.deepEqual(audio, { kind: 'not-possible', reason: 'audio-source' });
    const unsized = await runPlayerExport(harness({ items: [item({ width: null })] }).deps, GIF);
    assert.deepEqual(unsized, { kind: 'not-possible', reason: 'no-size' });
    assert.equal(playerExportMessageKey(unsized), 'videoPlayer.exportNoSize');
  });
});

describe('Merge videos from the Player', () => {
  const videos = [item({ id: 'a', title: 'First' }), item({ id: 'lib1' }), item({ id: 'c', hasAudio: false })];

  test('the videos in the order chosen, started from the playing one, a new item', async () => {
    const h = harness({ items: videos });
    const outcome = runPlayerExport(h.deps, { kind: 'merge', id: 'lib1', ids: ['a', 'lib1', 'c'] });
    await settle();
    assert.deepEqual(h.events, ['pause', 'started:merge:lib1', 'native-start']);
    assert.deepEqual(h.requests[0], {
      sourceId: 'lib1',
      kind: 'merge',
      startMs: null,
      endMs: null,
      keyframeStart: false,
      video: 'h264',
      audio: 'aac',
      title: 'Beach clip (merged)',
      sourceIds: ['a', 'lib1', 'c'],
    });
    h.finish({ value: item({ id: 'merged1' }) });
    const result = await outcome;
    assert.deepEqual(result, {
      kind: 'finished',
      state: { phase: 'done', sourceId: 'lib1', kind: 'merge', itemId: 'merged1' },
      gif: null,
      permission: false,
    });
    assert.equal(playerExportMessageKey(result), 'mediaEdit.done');
  });

  test('a video gone from the library, too few, twice the same, or one without the playing video', async () => {
    const h = harness({ items: videos });
    assert.deepEqual(await runPlayerExport(h.deps, { kind: 'merge', id: 'lib1', ids: ['lib1', 'gone'] }), { kind: 'missing' });
    const few = await runPlayerExport(h.deps, { kind: 'merge', id: 'lib1', ids: ['lib1'] });
    assert.deepEqual(few, { kind: 'not-possible', reason: 'too-few' });
    assert.equal(playerExportMessageKey(few), 'videoPlayer.mergeTooFew');
    const twice = await runPlayerExport(h.deps, { kind: 'merge', id: 'lib1', ids: ['lib1', 'a', 'lib1'] });
    assert.deepEqual(twice, { kind: 'not-possible', reason: 'duplicate' });
    assert.deepEqual(await runPlayerExport(h.deps, { kind: 'merge', id: 'lib1', ids: ['a', 'c'] }), {
      kind: 'not-possible',
      reason: 'too-few',
    });
    assert.deepEqual(h.events, []);
  });

  test('needs room for every video re-encoded', async () => {
    // Three 600 MB videos × 2 = 3.6 GB.
    const h = harness({ items: videos, freeBytes: 3_600_000_000 + EDIT_FREE_SPACE_MARGIN_BYTES - 1 });
    assert.deepEqual(await runPlayerExport(h.deps, { kind: 'merge', id: 'lib1', ids: ['a', 'lib1', 'c'] }), { kind: 'no-space' });
  });
});

describe('Change speed from the Player', () => {
  test('a part at 0.5×: the request, a new item', async () => {
    const h = harness();
    const outcome = runPlayerExport(h.deps, { kind: 'speed', id: 'lib1', speed: 0.5, part: { startMs: 10_000, endMs: 20_000 } });
    await settle();
    assert.deepEqual(h.requests[0], {
      sourceId: 'lib1',
      kind: 'speed',
      startMs: 10_000,
      endMs: 20_000,
      keyframeStart: false,
      video: 'h264',
      audio: 'aac',
      title: 'Beach clip (0.5× speed)',
      speed: 0.5,
    });
    h.finish({ value: item({ id: 'slow1' }) });
    assert.equal(playerExportMessageKey(await outcome), 'mediaEdit.done');
  });

  test('1× is refused; a slower copy needs more room', async () => {
    const one = await runPlayerExport(harness().deps, { kind: 'speed', id: 'lib1', speed: 1, part: null });
    assert.deepEqual(one, { kind: 'not-possible', reason: 'bad-speed' });
    assert.equal(playerExportMessageKey(one), 'videoPlayer.speedInvalid');
    // The whole 600 MB video at 0.25×: 4.8 GB.
    const h = harness({ freeBytes: 4_800_000_000 + EDIT_FREE_SPACE_MARGIN_BYTES - 1 });
    assert.deepEqual(await runPlayerExport(h.deps, { kind: 'speed', id: 'lib1', speed: 0.25, part: null }), { kind: 'no-space' });
  });

  test('a failure keeps its reason', async () => {
    const h = harness();
    const outcome = runPlayerExport(h.deps, { kind: 'speed', id: 'lib1', speed: 2, part: null });
    await settle();
    h.finish({ error: coded('ERR_EDIT_REFUSED') });
    const result = await outcome;
    assert.deepEqual(result.kind === 'finished' ? result.state : null, {
      phase: 'failed',
      sourceId: 'lib1',
      kind: 'speed',
      reason: 'refused',
    });
    assert.equal(playerExportMessageKey(result), 'mediaEdit.refused');
  });
});

describe('one export at a time', () => {
  test('a second one is refused while the first runs, whichever kind', async () => {
    const h = harness();
    const first = runPlayerExport(h.deps, GIF);
    await settle();
    const second = await runPlayerExport(h.deps, { kind: 'speed', id: 'lib1', speed: 2, part: null });
    assert.deepEqual(second, { kind: 'busy' });
    assert.equal(playerExportMessageKey(second), 'mediaEdit.busy');
    // The job refuses a task too, even without the runner.
    const task = await h.job.startTask({ sourceId: 'x', kind: 'gif', run: async () => 'never' });
    assert.deepEqual(task, { phase: 'failed', sourceId: 'x', kind: 'gif', reason: 'busy' });
    h.finish({ value: GIF_RESULT });
    await first;
  });

  test('an edit started in Download details blocks a GIF from the Player', async () => {
    const h = harness();
    const downloader = h.job.start({ sourceId: 'other', kind: 'trim', video: 'copy', audio: 'copy', title: 'Other (trimmed)' });
    assert.deepEqual(await runPlayerExport(h.deps, GIF), { kind: 'busy' });
    assert.deepEqual(h.events, ['native-start']);
    h.finish({ value: item({ id: 'trimmed' }) });
    await downloader;
    // Then it can run.
    const outcome = runPlayerExport(h.deps, GIF);
    await settle();
    assert.equal(h.job.state().phase, 'running');
    h.finish({ value: GIF_RESULT });
    assert.equal((await outcome).kind, 'finished');
  });
});
