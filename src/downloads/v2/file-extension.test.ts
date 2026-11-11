import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  DEFAULT_FILE_EXTENSION,
  FILE_EXTENSION_CHOICES,
  normalizeFileExtensionChoice,
  preferredExtensionForEngine,
} from './file-extension';
import { preferredExtensionFor, setFileExtensionSource } from './filename-naming';

afterEach(() => setFileExtensionSource(null));

describe('custom extension (#494)', () => {
  test('Automatic is the default and sends nothing', () => {
    assert.equal(DEFAULT_FILE_EXTENSION, 'auto');
    assert.equal(preferredExtensionForEngine('auto'), undefined);
    assert.deepEqual([...FILE_EXTENSION_CHOICES], ['auto', 'mp4', 'm4v']);
  });

  test('a chosen alias is sent as the engine expects it', () => {
    assert.equal(preferredExtensionForEngine('m4v'), 'm4v');
    assert.equal(preferredExtensionForEngine('mp4'), 'mp4');
    assert.equal(preferredExtensionForEngine('.M4V'), 'm4v');
  });

  test('anything stored or imported that is not a choice is Automatic', () => {
    for (const raw of [undefined, null, 4, '', 'mkv', 'exe', 'm4a', '../m4v', { ext: 'm4v' }]) {
      assert.equal(normalizeFileExtensionChoice(raw), 'auto', String(raw));
      assert.equal(preferredExtensionForEngine(raw), undefined, String(raw));
    }
  });

  test('the handoff reads the setting, and nothing registered or a failing source sends nothing', () => {
    assert.equal(preferredExtensionFor(), undefined);
    setFileExtensionSource(() => 'm4v');
    assert.equal(preferredExtensionFor(), 'm4v');
    setFileExtensionSource(() => 'auto');
    assert.equal(preferredExtensionFor(), undefined);
    setFileExtensionSource(() => {
      throw new Error('store not ready');
    });
    assert.equal(preferredExtensionFor(), undefined);
  });
});
