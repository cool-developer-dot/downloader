import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { bulkSignature, rowsFromBulkSignature, summarizeBulkActions, type BulkRow } from './bulk-actions';

const ROWS: BulkRow[] = [
  { id: 'a', status: 'DOWNLOADING', workerState: 'TRANSFERRING', pauseRestarts: false },
  { id: 'b', status: 'PAUSED', workerState: null, pauseRestarts: true },
  { id: 'c|d', status: 'QUEUED', workerState: 'WAITING', pauseRestarts: false },
];

describe('bulk signature', () => {
  test('round-trips the rows the bar needs', () => {
    assert.deepEqual(rowsFromBulkSignature(bulkSignature(ROWS)), ROWS);
    assert.deepEqual(rowsFromBulkSignature(''), []);
    assert.deepEqual(summarizeBulkActions(rowsFromBulkSignature(bulkSignature(ROWS))), summarizeBulkActions(ROWS));
  });

  test('is unchanged by anything the bar does not show (progress ticks), and changes with a status', () => {
    const before = bulkSignature(ROWS);
    assert.equal(bulkSignature(ROWS.map((r) => ({ ...r }))), before);
    assert.notEqual(bulkSignature([{ ...ROWS[0]!, status: 'PAUSED' }, ...ROWS.slice(1)]), before);
  });
});
