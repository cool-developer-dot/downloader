import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { EditRequest } from '@modules/vidorax-media/src/VidoraMedia.types';

import { createEditJob, editFailure, isEditCancelled, type EditJobState } from './edit-job';

const REQUEST: EditRequest = { sourceId: 'lib1', kind: 'mp4', video: 'copy', audio: 'aac', title: 'Clip (MP4)' };

function coded(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function jobRejectingWith(error: unknown) {
  const states: EditJobState[] = [];
  const job = createEditJob({
    startEdit: async () => {
      throw error;
    },
    getProgress: () => null,
    cancelEdit: async () => undefined,
    onChange: (state) => states.push(state),
    schedule: () => null,
    clear: () => undefined,
  });
  return { job, states };
}

describe('Cancel in the edit notification (H23 foreground service)', () => {
  test('the native "cancelled" rejection ends the job as cancelled, not failed', async () => {
    const { job } = jobRejectingWith(coded('ERR_EDIT_CANCELLED'));
    const result = await job.start(REQUEST);
    assert.deepEqual(result, { phase: 'cancelled', sourceId: 'lib1', kind: 'mp4' });
  });

  test('any other rejection is still a failure', async () => {
    const { job } = jobRejectingWith(coded('ERR_NO_SPACE'));
    assert.deepEqual(await job.start(REQUEST), { phase: 'failed', sourceId: 'lib1', kind: 'mp4', reason: 'no-space' });
  });

  test('isEditCancelled reads only that code', () => {
    assert.equal(isEditCancelled(coded('ERR_EDIT_CANCELLED')), true);
    assert.equal(isEditCancelled(coded('ERR_CANCELLED')), false);
    assert.equal(isEditCancelled(null), false);
    assert.equal(isEditCancelled('ERR_EDIT_CANCELLED'), false);
    assert.equal(editFailure(coded('ERR_EDIT_CANCELLED')), 'failed', 'never mapped to a failure reason by itself');
  });
});
