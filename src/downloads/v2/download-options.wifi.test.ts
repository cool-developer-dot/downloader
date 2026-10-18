import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import type { EnqueueRequest } from '@modules/vidorax-media/src/VidoraMedia.types';

import {
  applyDownloadOptions,
  hasChangedOptions,
  nextDraft,
  requestOverrides,
  setDownloadOptionsSource,
  type DownloadOptionsDraft,
} from './download-options';

const SOURCE = 'https://cdn.example.com/v.mp4?sig=1';
const DRAFT: DownloadOptionsDraft = {
  identity: SOURCE,
  title: '',
  titleEdited: false,
  folderId: null,
  saveToGallery: 'default',
  wifiOnly: 'default',
};

afterEach(() => setDownloadOptionsSource(null));

describe('per-download Wi-Fi only (#480)', () => {
  test('"As in settings" sends nothing, so Download Settings decides as before', () => {
    assert.deepEqual(requestOverrides({ url: SOURCE }, DRAFT), {});
    const { wifiOnly: _omitted, ...olderDraft } = DRAFT;
    assert.deepEqual(requestOverrides({ url: SOURCE }, olderDraft), {}, 'a draft from before #480');
    assert.equal(hasChangedOptions(DRAFT), false);
  });

  test('Yes and No are sent as this download’s own choice', () => {
    assert.deepEqual(requestOverrides({ url: SOURCE }, { ...DRAFT, wifiOnly: 'on' }), { wifiOnly: true });
    assert.deepEqual(requestOverrides({ url: SOURCE }, { ...DRAFT, wifiOnly: 'off' }), { wifiOnly: false });
    assert.equal(hasChangedOptions({ ...DRAFT, wifiOnly: 'off' }), true);
  });

  test('it combines with the other options and is never applied to another offer', () => {
    assert.deepEqual(requestOverrides({ url: SOURCE }, { ...DRAFT, wifiOnly: 'on', saveToGallery: 'off' }), {
      saveToGallery: false,
      wifiOnly: true,
    });
    assert.deepEqual(requestOverrides({ url: 'https://other.example/v.mp4' }, { ...DRAFT, wifiOnly: 'on' }), {});
  });

  test('a new draft starts at "As in settings"', () => {
    assert.equal(nextDraft(null, { identity: SOURCE }).wifiOnly, 'default');
    assert.equal(nextDraft(null, { identity: SOURCE, wifiOnly: 'on' }).wifiOnly, 'on');
  });

  test('the handoff puts the choice on the enqueue request', () => {
    setDownloadOptionsSource(() => ({ ...DRAFT, wifiOnly: 'off' }));
    const request = { url: SOURCE, kind: 'progressive', title: 'Clip' } as unknown as EnqueueRequest;
    applyDownloadOptions(request);
    assert.equal(request.wifiOnly, false);

    setDownloadOptionsSource(() => DRAFT);
    const untouched = { url: SOURCE, kind: 'progressive', title: 'Clip' } as unknown as EnqueueRequest;
    applyDownloadOptions(untouched);
    assert.equal('wifiOnly' in untouched, false);
  });
});
