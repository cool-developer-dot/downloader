import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { completedActionErrorMessageKey, mapCompletedActionError } from './action-errors.ts';

describe('mapCompletedActionError', () => {
  it('names a missing player when the v2 module finds no app for the file', () => {
    // Expo CodedException from NoAppException: { code: 'ERR_NO_APP', message: 'No installed app opens video/x-msvideo' }
    const error = Object.assign(new Error('No installed app opens video/x-msvideo'), { code: 'ERR_NO_APP' });
    const mapped = mapCompletedActionError(error);
    assert.equal(mapped.code, 'NO_COMPATIBLE_APP');
    assert.equal(completedActionErrorMessageKey(mapped.code), 'files.noCompatibleApp');
  });

  it('keeps the legacy codes and the generic fallback', () => {
    assert.equal(mapCompletedActionError({ code: 'NO_COMPATIBLE_APP' }).code, 'NO_COMPATIBLE_APP');
    assert.equal(mapCompletedActionError(new Error('ACTIVITY_NOT_FOUND')).code, 'NO_COMPATIBLE_APP');
    assert.equal(mapCompletedActionError({ code: 'ERR_SOMETHING' }).code, 'OPEN_FAILED');
  });
});
