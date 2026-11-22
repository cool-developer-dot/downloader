import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_LOOP_NAME_LENGTH,
  MAX_SAVED_LOOPS_PER_VIDEO,
  MAX_SAVED_LOOP_VIDEOS,
  addSavedLoop,
  deleteSavedLoop,
  nextLoopName,
  normalizeLoopName,
  readSavedLoopRecords,
  renameSavedLoop,
  savedLoopsFor,
  type SavedLoopRecords,
} from './saved-loops';

const input = (id: string, startMs: number, endMs: number, name = `Loop ${id}`) => ({
  id,
  name,
  startMs,
  endMs,
  createdAt: Number(id.replace(/\D/g, '')) || 1,
});

function added(records: SavedLoopRecords, mediaId: string, loop: ReturnType<typeof input>): SavedLoopRecords {
  const result = addSavedLoop(records, mediaId, loop);
  assert.ok(result.ok);
  return result.records;
}

describe('saved loops (#722)', () => {
  test('saves loops per video, lists them in timeline order, and survives a JSON round trip', () => {
    let records: SavedLoopRecords = [];
    records = added(records, 'v1', input('l1', 60_000, 75_000, 'Chorus'));
    records = added(records, 'v1', input('l2', 10_000, 20_000, 'Intro'));
    records = added(records, 'v2', input('l3', 5_000, 9_000));
    assert.deepEqual(
      savedLoopsFor(records, 'v1').map((loop) => loop.name),
      ['Intro', 'Chorus'],
    );
    assert.equal(savedLoopsFor(records, 'v2').length, 1);
    assert.deepEqual(savedLoopsFor(records, 'nope'), []);
    assert.deepEqual(savedLoopsFor(records, null), []);
    const stored = JSON.parse(JSON.stringify(records)) as unknown;
    assert.deepEqual(readSavedLoopRecords(stored), records);
  });

  test('B before A is saved the right way round', () => {
    const result = addSavedLoop([], 'v1', input('l1', 30_000, 12_000));
    assert.ok(result.ok);
    assert.equal(result.loop.startMs, 12_000);
    assert.equal(result.loop.endMs, 30_000);
  });

  test('renames and deletes; an empty name keeps the old one; the last loop gone drops the video', () => {
    let records = added([], 'v1', input('l1', 0, 4_000, 'Old'));
    records = added(records, 'v1', input('l2', 5_000, 9_000));
    records = renameSavedLoop(records, 'v1', 'l1', '  New   name ');
    assert.equal(savedLoopsFor(records, 'v1')[0]!.name, 'New name');
    assert.equal(renameSavedLoop(records, 'v1', 'l1', '   '), records);
    assert.equal(renameSavedLoop(records, 'v1', 'missing', 'X'), records);
    records = deleteSavedLoop(records, 'v1', 'l1');
    assert.deepEqual(
      savedLoopsFor(records, 'v1').map((loop) => loop.id),
      ['l2'],
    );
    records = deleteSavedLoop(records, 'v1', 'l2');
    assert.deepEqual(records, []);
    assert.equal(deleteSavedLoop(records, 'v1', 'l2'), records);
  });

  test('a video keeps at most 50 loops: one more is refused', () => {
    let records: SavedLoopRecords = [];
    for (let i = 0; i < MAX_SAVED_LOOPS_PER_VIDEO; i += 1) {
      records = added(records, 'v1', input(`l${i + 1}`, i * 1000, i * 1000 + 800));
    }
    assert.deepEqual(addSavedLoop(records, 'v1', input('lx', 0, 5_000)), { ok: false, reason: 'full' });
  });

  test('past 300 videos, the oldest video’s loops go; a change moves a video to the newest', () => {
    let records: SavedLoopRecords = [];
    for (let i = 0; i < MAX_SAVED_LOOP_VIDEOS + 2; i += 1) {
      records = added(records, `v${i}`, input(`l${i + 1}`, 0, 1_000));
    }
    assert.equal(records.length, MAX_SAVED_LOOP_VIDEOS);
    assert.equal(records[0]![0], 'v2');
    records = renameSavedLoop(records, 'v2', 'l3', 'Kept');
    assert.equal(records[records.length - 1]![0], 'v2');
  });

  test('refuses a loop that is too short, has no name or no video', () => {
    assert.deepEqual(addSavedLoop([], 'v1', input('l1', 1_000, 1_200)), { ok: false, reason: 'invalid' });
    assert.deepEqual(addSavedLoop([], 'v1', input('l1', 0, 5_000, '   ')), { ok: false, reason: 'invalid' });
    assert.deepEqual(addSavedLoop([], '', input('l1', 0, 5_000)), { ok: false, reason: 'invalid' });
  });

  test('reads a damaged record tolerantly', () => {
    assert.deepEqual(readSavedLoopRecords(null), []);
    assert.deepEqual(readSavedLoopRecords('x'), []);
    const records = readSavedLoopRecords([
      ['v1', [input('l1', 0, 4_000), { id: 'bad' }, input('l2', 3_000, 3_100)]],
      ['v1', [input('l9', 0, 4_000)]],
      [42, []],
      ['v2', []],
      'junk',
    ]);
    assert.deepEqual(
      records.map(([id, loops]) => [id, loops.map((loop) => loop.id)]),
      [['v1', ['l1']]],
    );
  });

  test('names: trimmed, one space, at most 80 characters (Urdu too); the next free "Loop n"', () => {
    assert.equal(normalizeLoopName('  a \n b  '), 'a b');
    assert.equal(normalizeLoopName('   '), null);
    const urdu = 'گانا '.repeat(30);
    assert.ok(Array.from(normalizeLoopName(urdu)!).length <= MAX_LOOP_NAME_LENGTH);
    const loops = savedLoopsFor(added(added([], 'v', input('l1', 0, 1_000, 'Loop 2')), 'v', input('l2', 0, 2_000)), 'v');
    assert.equal(nextLoopName(loops, 'Loop'), 'Loop 3');
    assert.equal(nextLoopName([], 'لوپ'), 'لوپ 1');
  });
});
