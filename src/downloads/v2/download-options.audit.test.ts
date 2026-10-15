import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { nextDraft, requestOverrides } from './download-options';

describe('download options (audit)', () => {
  test('options set before picking another quality follow it and are applied to it', () => {
    let draft = nextDraft(null, { identity: 'https://cdn/a-720.mp4', title: 'Renamed', titleEdited: true });
    draft = nextDraft(draft, { identity: 'https://cdn/a-1080.mp4' }); // quality changed
    assert.deepEqual(requestOverrides({ url: 'https://cdn/a-1080.mp4' }, draft), { title: 'Renamed' });
    assert.deepEqual(requestOverrides({ url: 'https://cdn/a-720.mp4' }, draft), {});
  });

  test('a first change starts from the defaults', () => {
    assert.deepEqual(nextDraft(null, { identity: 'x', folderId: 'f' }), {
      identity: 'x',
      title: '',
      titleEdited: false,
      folderId: 'f',
      saveToGallery: 'default',
    });
  });
});
