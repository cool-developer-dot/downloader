import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DownloadStatus } from '@/api/types';

import { resolveTapToggle } from './tap-to-toggle';

describe('resolveTapToggle', () => {
  test('off: every tap opens the details, as today', () => {
    for (const status of ['DOWNLOADING', 'PAUSED', 'QUEUED', 'COMPLETED'] as DownloadStatus[]) {
      assert.equal(
        resolveTapToggle({ enabled: false, engineOwned: true, status, cardActions: ['pause', 'resume', 'cancel'] }),
        null,
      );
    }
  });

  test('on: a running row pauses and a paused row resumes', () => {
    assert.equal(
      resolveTapToggle({ enabled: true, engineOwned: true, status: 'DOWNLOADING', cardActions: ['pause', 'cancel'] }),
      'pause',
    );
    assert.equal(
      resolveTapToggle({ enabled: true, engineOwned: true, status: 'PAUSED', cardActions: ['resume', 'cancel'] }),
      'resume',
    );
  });

  test('on: a row that does not offer the button keeps opening the details', () => {
    // Finishing (processing) rows show no Pause.
    assert.equal(
      resolveTapToggle({ enabled: true, engineOwned: true, status: 'DOWNLOADING', cardActions: ['cancel'] }),
      null,
    );
    assert.equal(resolveTapToggle({ enabled: true, engineOwned: true, status: 'PAUSED', cardActions: [] }), null);
  });

  test('on: queued, finished, failed and cancelled rows open the details', () => {
    for (const status of ['QUEUED', 'COMPLETED', 'FAILED', 'CANCELLED'] as DownloadStatus[]) {
      assert.equal(
        resolveTapToggle({ enabled: true, engineOwned: true, status, cardActions: ['pause', 'resume'] }),
        null,
        status,
      );
    }
  });

  test('on: v1 rows and unknown rows are never toggled', () => {
    assert.equal(
      resolveTapToggle({ enabled: true, engineOwned: false, status: 'DOWNLOADING', cardActions: ['pause'] }),
      null,
    );
    assert.equal(resolveTapToggle({ enabled: true, engineOwned: true, status: null, cardActions: ['pause'] }), null);
  });
});
