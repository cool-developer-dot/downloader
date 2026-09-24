import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyV2Progress, projectV2Download, projectV2LibraryItem } from './projection';
import { downloadRecord, libraryItem, PAGE_URL } from './test-fixtures';

describe('v2 engine state → the existing Downloads row', () => {
  test('every engine state maps to the app’s own status and execution wording', () => {
    const expected: Record<string, { status: string; execution: string }> = {
      queued: { status: 'QUEUED', execution: 'QUEUED' },
      probing: { status: 'QUEUED', execution: 'PREPARING' },
      downloading: { status: 'DOWNLOADING', execution: 'DOWNLOADING' },
      paused: { status: 'PAUSED', execution: 'PAUSED' },
      processing: { status: 'DOWNLOADING', execution: 'FINALIZING' },
      completed: { status: 'COMPLETED', execution: 'COMPLETED' },
      failed: { status: 'FAILED', execution: 'FAILED' },
      cancelled: { status: 'CANCELLED', execution: 'CANCELLED' },
    };
    for (const [state, want] of Object.entries(expected)) {
      const record = downloadRecord({ state: state as never });
      const entry = projectV2Download(record, state === 'completed' ? { library: libraryItem() } : {});
      assert.equal(entry.item.status, want.status, state);
      assert.equal(entry.transfer.executionState, want.execution, state);
    }
  });

  test('6: a progress event moves the row without changing its state', () => {
    const entry = projectV2Download(downloadRecord({ state: 'downloading', bytesDone: 1_048_576 }));
    assert.equal(entry.item.progress, 20);

    const moved = applyV2Progress(entry, {
      id: 'dl-1',
      phase: 'download',
      bytesDone: 2_621_440,
      totalBytes: 5_242_880,
      fraction: 0.5,
      speedBps: 1_000_000,
      etaSeconds: 3,
    });

    assert.ok(moved);
    assert.equal(moved.item.progress, 50);
    assert.equal(moved.item.status, 'DOWNLOADING');
    assert.equal(moved.transfer.bytesWritten, 2_621_440);
    assert.equal(moved.transfer.bytesPerSecond, 1_000_000);

    // Progress never resurrects or moves a terminal row.
    const completed = projectV2Download(downloadRecord({ state: 'completed' }), { library: libraryItem() });
    assert.equal(
      applyV2Progress(completed, { id: 'dl-1', phase: 'download', bytesDone: 10, totalBytes: null, fraction: null, speedBps: 0, etaSeconds: null }),
      null,
    );
  });

  test('8: a completed download points at the verified library file', () => {
    const item = libraryItem();
    const entry = projectV2Download(downloadRecord({ state: 'completed' }), { library: item });

    assert.equal(entry.item.status, 'COMPLETED');
    assert.equal(entry.item.progress, 100);
    assert.equal(entry.transfer.localUri, item.fileUri);
    assert.equal(entry.transfer.localState, 'complete');
    assert.equal(entry.item.fileName, item.fileName);
    assert.equal(entry.item.mimeType, 'video/mp4');
    assert.equal(entry.item.fileSize, String(item.sizeBytes));
    assert.equal(entry.item.sourceUrl, PAGE_URL, 'rows carry the page, never the signed media URL');
  });

  test('8: a completed record without its library item is not yet playable', () => {
    const entry = projectV2Download(downloadRecord({ state: 'completed' }));
    assert.equal(entry.transfer.localUri, null);
    assert.notEqual(entry.transfer.localState, 'complete');
  });

  test('9: failed and cancelled rows claim no file and explain themselves', () => {
    const failed = projectV2Download(
      downloadRecord({ state: 'failed', errorCode: 'SOURCE_EXPIRED', errorMessage: 'expired' }),
      { library: libraryItem() },
    );
    assert.equal(failed.item.status, 'FAILED');
    assert.equal(failed.item.progress < 100, true);
    assert.equal(failed.transfer.localUri, null, 'a failure never references a library file');
    assert.match(failed.item.errorMessage ?? '', /expired/i);
    assert.equal(failed.item.downloadedAt, null);

    const cancelled = projectV2Download(downloadRecord({ state: 'cancelled' }), { library: libraryItem() });
    assert.equal(cancelled.item.status, 'CANCELLED');
    assert.equal(cancelled.transfer.localUri, null);
    assert.equal(cancelled.item.downloadedAt, null);
  });

  test('a library item with no recent record is a completed row', () => {
    const entry = projectV2LibraryItem(libraryItem({ id: 'legacy-1', title: 'Old clip' }));
    assert.equal(entry.item.id, 'legacy-1');
    assert.equal(entry.item.status, 'COMPLETED');
    assert.equal(entry.item.title, 'Old clip');
    assert.equal(entry.transfer.localState, 'complete');
  });
});
