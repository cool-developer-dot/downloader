import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { DEFAULT_SAVE_LOCATION } from './save-location';
import { getSaveLocationSettings, useExternalCopiesStore, useSaveLocationStore } from './save-location-store';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3AMovies';

beforeEach(() => {
  useSaveLocationStore.setState({ ...DEFAULT_SAVE_LOCATION });
  useExternalCopiesStore.setState({ records: {} });
});

describe('save location store', () => {
  test('starts off and follows the user through pick, sub-options and remove', () => {
    assert.deepEqual(getSaveLocationSettings(), DEFAULT_SAVE_LOCATION);
    const { dispatch } = useSaveLocationStore.getState();
    dispatch({ type: 'picked', treeUri: TREE, folderName: 'Movies', now: 10 });
    dispatch({ type: 'set-by-site', value: true });
    assert.equal(getSaveLocationSettings().enabled, true);
    assert.equal(getSaveLocationSettings().bySite, true);
    dispatch({ type: 'remove' });
    assert.equal(getSaveLocationSettings().enabled, false);
    assert.equal(getSaveLocationSettings().treeUri, null);
  });

  test('a choice that changes nothing leaves the state object alone (no needless re-render or write)', () => {
    const before = useSaveLocationStore.getState();
    before.dispatch({ type: 'set-enabled', enabled: true, now: 1 });
    assert.equal(useSaveLocationStore.getState(), before);
  });

  test('the revoked-permission flow turns the option off and keeps the notice', () => {
    const { dispatch } = useSaveLocationStore.getState();
    dispatch({ type: 'picked', treeUri: TREE, folderName: 'Movies', now: 10 });
    dispatch({ type: 'access-lost' });
    assert.equal(getSaveLocationSettings().enabled, false);
    assert.equal(getSaveLocationSettings().accessLost, true);
  });
});

describe('external copies store', () => {
  test('records are kept per item and forgotten when items are deleted', () => {
    const store = useExternalCopiesStore.getState();
    store.setRecord('a', { status: 'failed', reason: 'storage', at: 1 });
    store.setRecord('b', {
      status: 'copied',
      folderUri: 'content://f',
      documentUri: 'content://d',
      name: 'b.mp4',
      folderLabel: 'Movies',
      at: 2,
    });
    assert.deepEqual(Object.keys(useExternalCopiesStore.getState().records).sort(), ['a', 'b']);
    const before = useExternalCopiesStore.getState();
    before.forget(['unknown']);
    assert.equal(useExternalCopiesStore.getState(), before);
    before.forget(['a']);
    assert.deepEqual(Object.keys(useExternalCopiesStore.getState().records), ['b']);
  });
});
