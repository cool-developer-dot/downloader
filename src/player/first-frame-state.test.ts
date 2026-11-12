import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasOnlyUndecodableVideo, revealsWithoutFirstFrame } from './first-frame-state.ts';

describe('a file whose video this device cannot decode (F4)', () => {
  it('is unsupported when every video track says so', () => {
    // A kept .mpg/.vob on a phone without an MPEG-2 decoder: ExoPlayer is ready but paints nothing.
    assert.equal(hasOnlyUndecodableVideo([{ isSupported: false }]), true);
    assert.equal(hasOnlyUndecodableVideo([{ isSupported: false }, { isSupported: false }]), true);
  });

  it('plays when any video track decodes, and never guesses without an answer', () => {
    assert.equal(hasOnlyUndecodableVideo([{ isSupported: false }, { isSupported: true }]), false);
    assert.equal(hasOnlyUndecodableVideo([{ isSupported: true }]), false);
    assert.equal(hasOnlyUndecodableVideo([{}]), false, 'iOS reports no support flag');
    assert.equal(hasOnlyUndecodableVideo([]), false, 'no tracks yet (or audio only)');
    assert.equal(hasOnlyUndecodableVideo(null), false);
  });

  it('an audio file is still revealed without a frame', () => {
    assert.equal(revealsWithoutFirstFrame('audio/mpeg'), true);
    assert.equal(revealsWithoutFirstFrame('video/mpeg'), false);
  });
});
