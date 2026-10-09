import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createRowRevision, type RowVisitor } from './row-revision';

type Row = { title: string; progress: number };

function rowsOf(map: Map<string, Row>): RowVisitor<Row> {
  return (visit) => {
    for (const [id, row] of map) {
      visit(id, row);
    }
  };
}

describe('row identity revision', () => {
  test('stays the same when nothing the parts cover changed', () => {
    let computed = 0;
    const revision = createRowRevision<Row>((id, row) => {
      computed += 1;
      return `${id}:${row.title}`;
    });
    const rows = new Map([
      ['a', { title: 'A', progress: 0 }],
      ['b', { title: 'B', progress: 0 }],
    ]);
    const first = revision(rowsOf(rows));
    assert.equal(revision(rowsOf(rows)), first);
    assert.equal(computed, 2, 'parts are computed once per row object');

    // A progress tick: a new object for one row, same title.
    rows.set('a', { title: 'A', progress: 40 });
    assert.equal(revision(rowsOf(rows)), first);
    assert.equal(computed, 3, 'only the replaced row is looked at again');
  });

  test('changes when a covered field changes, a row appears or a row goes away', () => {
    const revision = createRowRevision<Row>((id, row) => `${id}:${row.title}`);
    const rows = new Map([['a', { title: 'A', progress: 0 }]]);
    const r1 = revision(rowsOf(rows));
    rows.set('a', { title: 'Renamed', progress: 0 });
    const r2 = revision(rowsOf(rows));
    assert.notEqual(r2, r1);
    rows.set('b', { title: 'B', progress: 0 });
    const r3 = revision(rowsOf(rows));
    assert.notEqual(r3, r2);
    rows.delete('a');
    const r4 = revision(rowsOf(rows));
    assert.notEqual(r4, r3);
    assert.equal(revision(rowsOf(rows)), r4);
  });

  test('a swap of one row for another of the same count is a change', () => {
    const revision = createRowRevision<Row>((id, row) => `${id}:${row.title}`);
    const r1 = revision(rowsOf(new Map([['a', { title: 'A', progress: 0 }]])));
    const r2 = revision(rowsOf(new Map([['b', { title: 'A', progress: 0 }]])));
    assert.notEqual(r2, r1);
  });

  test('stays cheap for a large library on every tick', () => {
    const revision = createRowRevision<Row>((id, row) => `${id}:${row.title}`);
    const rows = new Map<string, Row>();
    for (let i = 0; i < 20_000; i += 1) {
      rows.set(`id-${i}`, { title: `Video ${i}`, progress: 100 });
    }
    const first = revision(rowsOf(rows));
    const started = performance.now();
    for (let tick = 0; tick < 50; tick += 1) {
      rows.set('id-7', { title: 'Video 7', progress: tick });
      assert.equal(revision(rowsOf(rows)), first);
    }
    // Generous bound: the point is linear, allocation-free work (tens of ms on a laptop for 50 ticks x 20k rows).
    assert.ok(performance.now() - started < 2_000);
  });
});
