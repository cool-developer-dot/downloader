import assert from 'node:assert/strict';
import { test } from 'node:test';

import { liveRecordingMigration } from './migrations';
import { initialSettingsState } from './state';

test('live recording is on by default for new installs', () => {
  assert.equal(initialSettingsState.liveRecording, true);
  assert.equal(initialSettingsState.liveRecordingApproved, true);
});

test('settings saved before 1.2.0 are switched on once, then the user choice is kept', () => {
  assert.deepEqual(liveRecordingMigration({ liveRecording: false }), { liveRecording: true, liveRecordingApproved: true });
  assert.deepEqual(liveRecordingMigration({}), { liveRecording: true, liveRecordingApproved: true });
  assert.deepEqual(liveRecordingMigration({ liveRecording: false, liveRecordingApproved: true }), {});
});
