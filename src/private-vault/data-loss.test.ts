import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { dataLossNotice, moveConfirmGate } from './data-loss';
import { usePrivateVaultPrefs } from './vault-prefs-store';

beforeEach(() => {
  usePrivateVaultPrefs.setState({ dataLossAcknowledged: false });
});

describe('data-loss warning', () => {
  test('the very first move needs "I understand" ticked before it can go ahead', () => {
    assert.deepEqual(moveConfirmGate({ acknowledged: false, ticked: false, busy: false }), {
      showAcknowledgement: true,
      canConfirm: false,
    });
    assert.deepEqual(moveConfirmGate({ acknowledged: false, ticked: true, busy: false }), {
      showAcknowledgement: true,
      canConfirm: true,
    });
  });

  test('later moves still show the warning but need no tick', () => {
    assert.deepEqual(moveConfirmGate({ acknowledged: true, ticked: false, busy: false }), {
      showAcknowledgement: false,
      canConfirm: true,
    });
  });

  test('nothing can be confirmed twice while a move runs', () => {
    assert.equal(moveConfirmGate({ acknowledged: true, ticked: true, busy: true }).canConfirm, false);
  });

  test('the Private screen shows the whole warning until the first move was acknowledged, then a reminder', () => {
    assert.equal(dataLossNotice(false), 'full');
    assert.equal(dataLossNotice(true), 'compact');
  });

  test('the acknowledgement is remembered and never undone by repeating it', () => {
    assert.equal(usePrivateVaultPrefs.getState().dataLossAcknowledged, false);
    usePrivateVaultPrefs.getState().acknowledgeDataLoss();
    const after = usePrivateVaultPrefs.getState();
    assert.equal(after.dataLossAcknowledged, true);
    after.acknowledgeDataLoss();
    assert.equal(usePrivateVaultPrefs.getState(), after);
  });
});
