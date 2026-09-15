import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DownloadRecord, DownloadState } from '@modules/vidorax-media/src/VidoraMedia.types';

import { canPause, canResume, summarizeDownloads } from './download-sections.ts';

function record(id: string, state: DownloadState, createdAt: number, updatedAt = createdAt): DownloadRecord {
  return {
    id,
    state,
    title: id,
    site: 'web',
    kind: 'progressive',
    pageUrl: null,
    thumbnailUrl: null,
    qualityLabel: null,
    bytesDone: 0,
    totalBytes: null,
    errorCode: null,
    errorMessage: null,
    attempts: 0,
    libraryItemId: state === 'completed' ? id : null,
    createdAt,
    updatedAt,
  };
}

describe('summarizeDownloads', () => {
  test('groups states into sections and hides cancelled records', () => {
    const overview = summarizeDownloads([
      record('downloading', 'downloading', 1),
      record('probing', 'probing', 2),
      record('processing', 'processing', 3),
      record('paused', 'paused', 4),
      record('offline', 'waiting_network', 5),
      record('backoff', 'waiting_retry', 6),
      record('queued', 'queued', 7),
      record('failed', 'failed', 8),
      record('done', 'completed', 9),
      record('cancelled', 'cancelled', 10),
    ]);

    assert.deepEqual(overview.sections, {
      active: ['downloading', 'probing', 'processing', 'paused', 'offline', 'backoff'],
      queued: ['queued'],
      failed: ['failed'],
      completed: ['done'],
    });
    assert.equal(overview.unfinishedCount, 7);
  });

  test('keeps queue order for pending work and latest-first for finished work', () => {
    const overview = summarizeDownloads([
      record('second-queued', 'queued', 20),
      record('first-queued', 'queued', 10),
      record('old-failure', 'failed', 1, 100),
      record('new-failure', 'failed', 2, 300),
      record('old-done', 'completed', 3, 200),
      record('new-done', 'completed', 4, 400),
    ]);

    assert.deepEqual(overview.sections.queued, ['first-queued', 'second-queued']);
    assert.deepEqual(overview.sections.failed, ['new-failure', 'old-failure']);
    assert.deepEqual(overview.sections.completed, ['new-done', 'old-done']);
  });

  test('offers pause all only for pausable work and resume all only for paused work', () => {
    assert.deepEqual(
      pick(summarizeDownloads([record('a', 'processing', 1), record('b', 'completed', 2)])),
      { canPauseAll: false, canResumeAll: false },
    );
    assert.deepEqual(pick(summarizeDownloads([record('a', 'queued', 1)])), {
      canPauseAll: true,
      canResumeAll: false,
    });
    assert.deepEqual(pick(summarizeDownloads([record('a', 'paused', 1), record('b', 'downloading', 2)])), {
      canPauseAll: true,
      canResumeAll: true,
    });
  });

  test('is empty for no records', () => {
    const overview = summarizeDownloads([]);
    assert.equal(overview.unfinishedCount, 0);
    assert.deepEqual(overview.sections, { active: [], queued: [], failed: [], completed: [] });
  });
});

test('row actions follow the state machine', () => {
  assert.equal(canPause('downloading'), true);
  assert.equal(canPause('processing'), false);
  assert.equal(canPause('paused'), false);
  assert.equal(canResume('paused'), true);
  assert.equal(canResume('failed'), false);
});

function pick(overview: ReturnType<typeof summarizeDownloads>) {
  return { canPauseAll: overview.canPauseAll, canResumeAll: overview.canResumeAll };
}
