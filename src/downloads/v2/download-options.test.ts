import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  editedTitle,
  folderOnStateChange,
  hasChangedOptions,
  rememberFolder,
  requestOverrides,
  type DownloadOptionsDraft,
} from './download-options';

const SOURCE = 'https://cdn.example.com/v.mp4?sig=1';
const DRAFT: DownloadOptionsDraft = { identity: SOURCE, title: '', titleEdited: false, folderId: null, saveToGallery: 'default' };

describe('requestOverrides', () => {
  test('untouched options change nothing', () => {
    assert.deepEqual(requestOverrides({ url: SOURCE }, DRAFT), {});
    assert.deepEqual(requestOverrides({ url: SOURCE }, null), {});
    assert.equal(hasChangedOptions(DRAFT), false);
  });

  test('an edited name is cleaned like the filename template and replaces the title', () => {
    assert.deepEqual(requestOverrides({ url: SOURCE }, { ...DRAFT, title: '  My/clip: part*1  ', titleEdited: true }), {
      title: 'My clip part 1',
    });
    assert.deepEqual(requestOverrides({ url: SOURCE }, { ...DRAFT, title: 'میری ویڈیو', titleEdited: true }), {
      title: 'میری ویڈیو',
    });
  });

  test('a name edited down to nothing keeps the usual title', () => {
    assert.deepEqual(requestOverrides({ url: SOURCE }, { ...DRAFT, title: ' /// ', titleEdited: true }), {});
    assert.equal(editedTitle({ title: 'x', titleEdited: false }), null);
  });

  test('per-item Save to Gallery only when not Default', () => {
    assert.deepEqual(requestOverrides({ url: SOURCE }, { ...DRAFT, saveToGallery: 'off' }), { saveToGallery: false });
    assert.deepEqual(requestOverrides({ url: SOURCE }, { ...DRAFT, saveToGallery: 'on' }), { saveToGallery: true });
  });

  test('options for another offer are never applied; a refreshed link still matches by identity', () => {
    const draft = { ...DRAFT, title: 'X', titleEdited: true };
    assert.deepEqual(requestOverrides({ url: 'https://other.example/v.mp4' }, draft), {});
    assert.deepEqual(requestOverrides({ url: 'https://cdn.example.com/v.mp4?sig=2', identityUrl: SOURCE }, draft), { title: 'X' });
  });

  test('hasChangedOptions', () => {
    assert.equal(hasChangedOptions({ ...DRAFT, folderId: 'f1' }), true);
    assert.equal(hasChangedOptions({ ...DRAFT, saveToGallery: 'on' }), true);
    assert.equal(hasChangedOptions({ ...DRAFT, title: 'n', titleEdited: true }), true);
  });
});

describe('folder on completion', () => {
  test('a chosen folder is assigned when the download completes, once', () => {
    let pending = rememberFolder({}, 'd1', 'f1');
    let step = folderOnStateChange(pending, { id: 'd1', state: 'downloading' });
    assert.equal(step.assign, null);
    pending = step.pending;
    step = folderOnStateChange(pending, { id: 'd1', state: 'completed' });
    assert.equal(step.assign, 'f1');
    assert.deepEqual(step.pending, {});
    assert.equal(folderOnStateChange(step.pending, { id: 'd1', state: 'completed' }).assign, null);
  });

  test('Unfiled or no download id needs nothing; a cancelled download is forgotten; a failed one waits for retry', () => {
    assert.deepEqual(rememberFolder({}, 'd1', null), {});
    assert.deepEqual(rememberFolder({}, null, 'f1'), {});
    const pending = rememberFolder({}, 'd1', 'f1');
    assert.deepEqual(folderOnStateChange(pending, { id: 'd1', state: 'cancelled' }), { assign: null, pending: {} });
    assert.equal(folderOnStateChange(pending, { id: 'd1', state: 'failed' }).pending.d1, 'f1');
  });

  test('the pending map is bounded', () => {
    let pending = {};
    for (let i = 0; i < 250; i += 1) {
      pending = rememberFolder(pending, `d${i}`, 'f');
    }
    assert.equal(Object.keys(pending).length, 200);
    assert.equal((pending as Record<string, string>).d249, 'f');
  });
});

describe('applyDownloadOptions', () => {
  test('applies the registered draft in place, and nothing without one', async () => {
    const { applyDownloadOptions, setDownloadOptionsSource } = await import('./download-options');
    const request = { url: SOURCE, kind: 'progressive', title: 'Template title', site: 'web', request: {} } as never as import('@modules/vidorax-media/src/VidoraMedia.types').EnqueueRequest;
    applyDownloadOptions(request);
    assert.equal(request.title, 'Template title');
    setDownloadOptionsSource(() => ({ ...DRAFT, title: 'Renamed', titleEdited: true, saveToGallery: 'off' }));
    applyDownloadOptions(request);
    assert.equal(request.title, 'Renamed');
    assert.equal(request.saveToGallery, false);
    setDownloadOptionsSource(() => {
      throw new Error('store gone');
    });
    assert.doesNotThrow(() => applyDownloadOptions(request));
    setDownloadOptionsSource(null);
  });
});
