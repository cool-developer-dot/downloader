import assert from 'node:assert/strict';
import { test } from 'node:test';

import { answerAppDialog, hasAppDialogHost, registerAppDialogHost, showAppDialog, useAppDialogStore } from './app-dialog';

test('a dialog resolves with the answer, and a newer one cancels the older', async () => {
  assert.equal(hasAppDialogHost(), false);
  const unregister = registerAppDialogHost();
  assert.equal(hasAppDialogHost(), true);

  const first = showAppDialog({ title: 'First', confirmLabel: 'OK', cancelLabel: 'Cancel' });
  const firstId = useAppDialogStore.getState().current!.id;
  const second = showAppDialog({ title: 'Second', confirmLabel: 'OK', cancelLabel: null });
  assert.equal(await first, false);
  answerAppDialog(firstId, true); // a stale answer is ignored
  assert.equal(useAppDialogStore.getState().current?.title, 'Second');
  answerAppDialog(useAppDialogStore.getState().current!.id, true);
  assert.equal(await second, true);
  assert.equal(useAppDialogStore.getState().current, null);

  unregister();
  assert.equal(hasAppDialogHost(), false);
});
