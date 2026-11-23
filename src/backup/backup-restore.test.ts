import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_GESTURE_SETTINGS } from '../player/gesture-settings.ts';
import type { SavedLoop } from '../player/saved-loops.ts';
import { mmkvKeys } from '../storage/constants/mmkv-keys.ts';

import {
  collectPreferences,
  mergeSavedLoops,
  readSubtitleChoices,
  restoredPreferences,
} from './backup-preferences.ts';
import { changedKeys, restoredSettingsValues } from './backup-restore.ts';

/** P11 #700 Restore: Merge vs Replace for the settings and every kind of preference. */

const DEFAULTS = { wifiOnly: false, language: 'en', maxConcurrentDownloads: 2, settingsView: 'simple' };

const loop = (id: string, startMs: number, endMs: number, name = id): SavedLoop => ({ id, name, startMs, endMs, createdAt: 1 });

const subtitleFile = {
  id: 'picked:1',
  name: 'english.srt',
  uri: 'file:///data/user/0/app/files/subtitles/english.srt',
  format: 'srt',
  language: 'en',
  encoding: 'auto',
  origin: 'picked',
} as const;

describe('P11 restore: settings', () => {
  test('Merge applies only what the file has', () => {
    assert.deepEqual(restoredSettingsValues({ wifiOnly: true }, DEFAULTS, 'merge'), { wifiOnly: true });
  });

  test('Replace: the file’s, every other setting back to its default — the language stays unless the file has one', () => {
    assert.deepEqual(restoredSettingsValues({ wifiOnly: true }, DEFAULTS, 'replace'), {
      wifiOnly: true,
      maxConcurrentDownloads: 2,
      settingsView: 'simple',
    });
    assert.deepEqual(restoredSettingsValues({ language: 'ur' }, DEFAULTS, 'replace'), {
      wifiOnly: false,
      language: 'ur',
      maxConcurrentDownloads: 2,
      settingsView: 'simple',
    });
  });
});

describe('P11 restore: preferences', () => {
  const phone = {
    [mmkvKeys.playerSeekStepSeconds]: 15,
    [mmkvKeys.playerAutoPlayNext]: true,
    [mmkvKeys.playerVideoFits]: [
      ['phone-only', 'stretch'],
      ['both', 'crop'],
    ],
    [mmkvKeys.playerSavedLoops]: [['both', [loop('a', 0, 5000)]]],
    [mmkvKeys.libraryExcludedFolders]: ['phone-folder'],
    [mmkvKeys.playerSubtitles]: [
      ['with-file', { primary: { kind: 'file', fileId: 'picked:1' }, files: [subtitleFile], offsetMs: 0 }],
      ['offset-only', { primary: null, files: [], offsetMs: 400 }],
    ],
  };
  const file = {
    [mmkvKeys.playerSeekStepSeconds]: 30,
    [mmkvKeys.playerVideoFits]: [['both', '16:9'], ['file-only', '4:3']],
    [mmkvKeys.playerSavedLoops]: [
      ['both', [loop('a', 0, 5000), loop('b', 10_000, 20_000)]],
      ['file-only', [loop('c', 1000, 4000)]],
    ],
    [mmkvKeys.libraryExcludedFolders]: ['file-folder'],
    [mmkvKeys.playerSubtitles]: [['with-file', { primary: null, files: [], offsetMs: -300 }]],
  };

  test('Merge: the file’s choices apply, lists join, nothing of the phone’s is dropped; keys it lacks are untouched', () => {
    const next = restoredPreferences(phone, file, 'merge');
    assert.equal(next[mmkvKeys.playerSeekStepSeconds], 30);
    assert.ok(!(mmkvKeys.playerAutoPlayNext in next), 'not in the file: left as it is');
    assert.deepEqual(next[mmkvKeys.playerVideoFits], [
      ['phone-only', 'stretch'],
      ['both', '16:9'],
      ['file-only', '4:3'],
    ]);
    assert.deepEqual(next[mmkvKeys.playerSavedLoops], [
      ['both', [loop('a', 0, 5000), loop('b', 10_000, 20_000)]],
      ['file-only', [loop('c', 1000, 4000)]],
    ]);
    assert.deepEqual(next[mmkvKeys.libraryExcludedFolders], ['phone-folder', 'file-folder']);
    // The phone's subtitle file stays, and stays chosen (the file has no track choice of its own); its offset applies.
    assert.deepEqual(next[mmkvKeys.playerSubtitles], [
      ['offset-only', { primary: null, files: [], offsetMs: 400 }],
      ['with-file', { primary: { kind: 'file', fileId: 'picked:1' }, files: [subtitleFile], offsetMs: -300 }],
    ]);
  });

  test('Merge is idempotent: the same file twice changes nothing the second time', () => {
    const once = restoredPreferences(phone, file, 'merge');
    const twice = restoredPreferences({ ...phone, ...once }, file, 'merge');
    assert.deepEqual(changedKeys({ ...phone, ...once }, twice), []);
  });

  test('Replace: every allow-listed key takes the file’s value or its default', () => {
    const next = restoredPreferences(phone, file, 'replace');
    assert.equal(next[mmkvKeys.playerSeekStepSeconds], 30);
    assert.equal(next[mmkvKeys.playerAutoPlayNext], false, 'not in the file: back to the default');
    assert.deepEqual(next[mmkvKeys.playerGestures], DEFAULT_GESTURE_SETTINGS);
    assert.deepEqual(next[mmkvKeys.playerVideoFits], [['both', '16:9'], ['file-only', '4:3']]);
    assert.deepEqual(next[mmkvKeys.playerSavedLoops], file[mmkvKeys.playerSavedLoops]);
    assert.deepEqual(next[mmkvKeys.libraryExcludedFolders], ['file-folder']);
    // Choices only as in the file; the phone's subtitle files themselves are never deleted by a restore.
    assert.deepEqual(next[mmkvKeys.playerSubtitles], [
      ['with-file', { primary: { kind: 'file', fileId: 'picked:1' }, files: [subtitleFile], offsetMs: -300 }],
    ]);
  });

  test('a loop already on the phone (same id, or the same A and B) is not added twice', () => {
    const merged = mergeSavedLoops([['v', [loop('a', 0, 5000)]]], [['v', [loop('x', 0, 5000, 'Same range'), loop('a', 1, 9000)]]]);
    assert.deepEqual(merged, [['v', [loop('a', 0, 5000)]]]);
  });

  test('a backup carries the subtitle choices without the files (they are files on the phone)', () => {
    const choices = readSubtitleChoices(phone[mmkvKeys.playerSubtitles]);
    assert.deepEqual(choices, [['offset-only', { primary: null, files: [], offsetMs: 400 }]]);
    const exported = collectPreferences((spec) => (phone as Record<string, unknown>)[spec.key]);
    assert.ok(!JSON.stringify(exported).includes('english.srt'));
    const full = collectPreferences((spec) => (phone as Record<string, unknown>)[spec.key], { fullSubtitleRecords: true });
    assert.ok(JSON.stringify(full).includes('english.srt'), 'a restore merges into the whole record');
  });

  test('changedKeys compares by content', () => {
    assert.deepEqual(changedKeys({ a: [1, 2], b: { x: 1 } }, { a: [1, 2], b: { x: 2 }, c: true }), ['b', 'c']);
  });
});
