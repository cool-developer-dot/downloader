import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { batchActionsFor, type BatchItem } from './batch-actions';

const video = (id: string, extra: Partial<Extract<BatchItem, { kind: 'file' }>> = {}): BatchItem => ({
  kind: 'file',
  id,
  type: 'video',
  canMoveToPrivate: true,
  ...extra,
});
const enabled = (items: BatchItem[], moreItems = 0) =>
  Object.entries(batchActionsFor(items, { moreItems }))
    .filter(([, state]) => state.visible && state.enabled)
    .map(([action]) => action);

describe('Files F4: batch actions', () => {
  test('videos and audio: everything works; More only when a package fills it', () => {
    const items = [video('1'), video('2', { type: 'audio' })];
    assert.deepEqual(enabled(items), ['move', 'share', 'delete', 'add-to-playlist', 'move-to-private']);
    assert.deepEqual(enabled(items, 2), ['move', 'share', 'delete', 'add-to-playlist', 'move-to-private', 'more']);
  });

  test('mixed types: no Add to playlist once a file can’t play; Move to Private only when every file can move', () => {
    const items = [video('1'), video('2', { type: 'doc', canMoveToPrivate: false })];
    assert.deepEqual(enabled(items), ['move', 'share', 'delete']);
  });

  test('a folder in the selection hides Share and turns off Move, Add to playlist and Move to Private', () => {
    const items: BatchItem[] = [video('1'), { kind: 'folder', id: 'f' }];
    const states = batchActionsFor(items, { moreItems: 0 });
    assert.equal(states.share.visible, false);
    assert.deepEqual(enabled(items), ['delete']);
    // Only folders: nothing to delete either.
    assert.deepEqual(enabled([{ kind: 'folder', id: 'f' }]), []);
  });

  test('F12: moving a folder waits for nested folders, then Move takes the folders too', () => {
    const items: BatchItem[] = [video('1'), { kind: 'folder', id: 'f' }];
    assert.equal(batchActionsFor(items, { moreItems: 0, nestedFolders: false }).move.enabled, false);
    assert.equal(batchActionsFor(items, { moreItems: 0, nestedFolders: true }).move.enabled, true);
    assert.equal(batchActionsFor([{ kind: 'folder', id: 'f' }], { moreItems: 0, nestedFolders: true }).move.enabled, true);
  });

  test('a missing file: Delete still works; Share, Add to playlist and Move to Private don’t', () => {
    const items = [video('1'), video('2', { missing: true })];
    assert.deepEqual(enabled(items), ['move', 'delete']);
  });

  test('nothing selected: nothing is enabled', () => {
    assert.deepEqual(enabled([], 3), []);
  });
});
