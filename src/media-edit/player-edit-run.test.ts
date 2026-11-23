/**
 * P10: an edit started from the Player, through the app's one edit job: idle → running → done / failed / cancelled /
 * no space; one job at a time (also against an edit from Download details); the player paused before it starts.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { EditRequest, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { COPY_FACTOR, EDIT_FREE_SPACE_MARGIN_BYTES } from './edit-plan';
import { createEditJob, type EditJobState } from './edit-job';
import { playerEditMessageKey, runPlayerEdit, type PlayerEditInput, type PlayerEditRunDeps } from './player-edit-run';

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

/** The real edit job with a native editor that the test finishes by hand. */
function harness(options: { source?: LibraryItem | null; freeBytes?: number | null } = {}) {
  const states: EditJobState[] = [];
  const requests: EditRequest[] = [];
  const events: string[] = [];
  let finish: (result: { item?: LibraryItem; error?: unknown }) => void = () => {};
  const job = createEditJob({
    startEdit: (request) => {
      requests.push(request);
      events.push('native-start');
      return new Promise<LibraryItem>((resolve, reject) => {
        finish = ({ item: made, error }) => (made ? resolve(made) : reject(error));
      });
    },
    getProgress: () => null,
    cancelEdit: async () => {
      finish({ error: coded('ERR_EDIT_CANCELLED') });
    },
    onChange: (state) => states.push(state),
    schedule: () => 0,
    clear: () => undefined,
  });
  const deps: PlayerEditRunDeps = {
    job,
    getItem: async () => (options.source === undefined ? item() : options.source),
    getFreeBytes: async () => (options.freeBytes === undefined ? 50_000_000_000 : options.freeBytes),
    pausePlayer: () => events.push('pause'),
    onStarted: (input: PlayerEditInput) => events.push(`started:${input.kind}`),
    outputLabel: (kind) => (kind === 'compress' ? 'compressed' : kind === 'audio' ? 'audio' : 'MP4'),
  };
  return { job, deps, states, requests, events, finish: (result: { item?: LibraryItem; error?: unknown }) => finish(result) };
}

/** Lets the runner reach `job.start` (it awaits the item and the free space first). */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** A WebM (VP9 + Opus): Convert to MP4 re-encodes it, so the MP4 edit applies. */
const WEBM = { container: 'webm', videoCodec: 'video/x-vnd.on2.vp9', audioCodec: 'audio/opus', mimeType: 'video/webm' } as const;

describe('an edit started from the Player', () => {
  test('idle → running → done: the player is paused first, the new item is announced', async () => {
    const h = harness();
    assert.equal(h.job.state().phase, 'idle');
    const outcome = runPlayerEdit(h.deps, { id: 'lib1', kind: 'audio' });
    await settle();
    assert.deepEqual(h.events, ['pause', 'started:audio', 'native-start']);
    assert.equal(h.job.state().phase, 'running');
    assert.deepEqual(h.requests[0], {
      sourceId: 'lib1',
      kind: 'audio',
      startMs: null,
      endMs: null,
      keyframeStart: false,
      video: 'drop',
      audio: 'copy',
      title: 'Beach clip (audio)',
    });
    h.finish({ item: item({ id: 'new1' }) });
    const result = await outcome;
    assert.deepEqual(result, { kind: 'finished', state: { phase: 'done', sourceId: 'lib1', kind: 'audio', itemId: 'new1' } });
    assert.equal(playerEditMessageKey(result), 'mediaEdit.done');
  });

  test('compress sends the preset’s bitrate and size with a new title', async () => {
    const h = harness();
    const outcome = runPlayerEdit(h.deps, { id: 'lib1', kind: 'compress', preset: 'small' });
    await settle();
    assert.equal(h.requests[0]?.kind, 'compress');
    assert.equal(h.requests[0]?.video, 'h264');
    assert.equal(h.requests[0]?.videoBitrate, 1_000_000);
    assert.equal(h.requests[0]?.maxShortSide, 480);
    assert.equal(h.requests[0]?.title, 'Beach clip (compressed)');
    h.finish({ item: item({ id: 'new2' }) });
    assert.equal((await outcome).kind, 'finished');
  });

  test('Cancel → cancelled, and nothing is kept (the native side deletes the partial file)', async () => {
    const h = harness({ source: item(WEBM) });
    const outcome = runPlayerEdit(h.deps, { id: 'lib1', kind: 'mp4' });
    await settle();
    h.job.cancel();
    const result = await outcome;
    assert.deepEqual(result, { kind: 'finished', state: { phase: 'cancelled', sourceId: 'lib1', kind: 'mp4' } });
    assert.equal(playerEditMessageKey(result), 'mediaEdit.cancelled');
  });

  test('a native failure → failed, with its reason (no space found by the native check too)', async () => {
    const h = harness({ source: item(WEBM) });
    const outcome = runPlayerEdit(h.deps, { id: 'lib1', kind: 'mp4' });
    await settle();
    h.finish({ error: coded('ERR_NO_SPACE') });
    const result = await outcome;
    assert.deepEqual(result, { kind: 'finished', state: { phase: 'failed', sourceId: 'lib1', kind: 'mp4', reason: 'no-space' } });
    assert.equal(playerEditMessageKey(result), 'mediaEdit.noSpace');

    const failing = harness({ source: item(WEBM) });
    const second = runPlayerEdit(failing.deps, { id: 'lib1', kind: 'mp4' });
    await settle();
    failing.finish({ error: coded('ERR_STORAGE') });
    assert.equal(playerEditMessageKey(await second), 'mediaEdit.failed');
  });

  test('low storage is caught before anything starts: the player keeps playing', async () => {
    const h = harness({ freeBytes: 1_000 });
    const result = await runPlayerEdit(h.deps, { id: 'lib1', kind: 'compress', preset: 'medium' });
    assert.deepEqual(result, { kind: 'no-space' });
    assert.deepEqual(h.events, []);
    assert.equal(h.job.state().phase, 'idle');
    assert.equal(playerEditMessageKey(result), 'mediaEdit.noSpace');
  });

  test('compress needs room for its estimate (+10 %, as the native check), not for twice the original', async () => {
    // 10 minutes at Small is about 86 MB (86 292 000 bytes); the original is 600 MB.
    const tight = harness({ freeBytes: 86_292_000 + EDIT_FREE_SPACE_MARGIN_BYTES });
    assert.deepEqual(await runPlayerEdit(tight.deps, { id: 'lib1', kind: 'compress', preset: 'small' }), { kind: 'no-space' });
    const h = harness({ freeBytes: Math.ceil(86_292_000 * COPY_FACTOR) + EDIT_FREE_SPACE_MARGIN_BYTES });
    const outcome = runPlayerEdit(h.deps, { id: 'lib1', kind: 'compress', preset: 'small' });
    await settle();
    assert.equal(h.job.state().phase, 'running');
    h.finish({ item: item({ id: 'new3' }) });
    assert.equal((await outcome).kind, 'finished');
  });

  test('unknown free space is not a refusal (the native editor checks again)', async () => {
    const h = harness({ freeBytes: null });
    const outcome = runPlayerEdit(h.deps, { id: 'lib1', kind: 'audio' });
    await settle();
    assert.equal(h.job.state().phase, 'running');
    h.finish({ item: item({ id: 'new4' }) });
    await outcome;
  });

  test('one edit at a time: a second one is refused while the first runs', async () => {
    const h = harness();
    const first = runPlayerEdit(h.deps, { id: 'lib1', kind: 'audio' });
    await settle();
    const second = await runPlayerEdit(h.deps, { id: 'lib1', kind: 'mp4' });
    assert.deepEqual(second, { kind: 'busy' });
    assert.equal(playerEditMessageKey(second), 'mediaEdit.busy');
    assert.equal(h.requests.length, 1);
    h.finish({ item: item({ id: 'new5' }) });
    await first;
  });

  test('an edit started elsewhere (Download details) also blocks one from the Player', async () => {
    const h = harness();
    const downloader = h.job.start({ sourceId: 'other', kind: 'trim', video: 'copy', audio: 'copy', title: 'Other (trimmed)' });
    const result = await runPlayerEdit(h.deps, { id: 'lib1', kind: 'audio' });
    assert.deepEqual(result, { kind: 'busy' });
    assert.deepEqual(h.events, ['native-start']);
    h.finish({ item: item({ id: 'trimmed' }) });
    await downloader;
  });

  test('an item gone from the library, an edit that makes no sense, and no editor', async () => {
    assert.deepEqual(await runPlayerEdit(harness({ source: null }).deps, { id: 'lib1', kind: 'audio' }), { kind: 'missing' });
    const silent = await runPlayerEdit(harness({ source: item({ hasAudio: false }) }).deps, { id: 'lib1', kind: 'audio' });
    assert.deepEqual(silent, { kind: 'not-possible', reason: 'no-audio' });
    assert.equal(playerEditMessageKey(silent), 'mediaEdit.noAudio');
    const mp4 = await runPlayerEdit(harness().deps, { id: 'lib1', kind: 'mp4' });
    // An H.264 + AAC MP4 is already what Convert makes … (then the runner never reached the job)
    assert.deepEqual(mp4, { kind: 'not-possible', reason: 'already-mp4' });
    const tiny = await runPlayerEdit(harness({ source: item({ sizeBytes: 10_000_000 }) }).deps, {
      id: 'lib1',
      kind: 'compress',
      preset: 'high',
    });
    assert.deepEqual(tiny, { kind: 'not-possible', reason: 'no-gain' });
    assert.equal(playerEditMessageKey(tiny), 'videoPlayer.compressNoGain');
    const none = await runPlayerEdit({ ...harness().deps, job: null }, { id: 'lib1', kind: 'audio' });
    assert.deepEqual(none, { kind: 'unavailable' });
  });
});
