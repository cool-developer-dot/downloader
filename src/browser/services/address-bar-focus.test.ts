import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import {
  requestAddressBarFocus,
  subscribeAddressBarFocusRequest,
  takeAddressBarFocusRequest,
} from './address-bar-focus.ts';

describe('address bar focus request', () => {
  it('is taken once', () => {
    requestAddressBarFocus();
    assert.equal(takeAddressBarFocusRequest(), true);
    assert.equal(takeAddressBarFocusRequest(), false);
  });

  it('expires when nobody takes it within 5 s', () => {
    const now = mock.method(Date, 'now', () => 1_000_000);
    requestAddressBarFocus();
    now.mock.mockImplementation(() => 1_005_001);
    assert.equal(takeAddressBarFocusRequest(), false);
    now.mock.restore();
  });

  it('tells a listening address bar, and stops after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribeAddressBarFocusRequest(() => {
      calls += 1;
    });
    requestAddressBarFocus();
    unsubscribe();
    requestAddressBarFocus();
    assert.equal(calls, 1);
    takeAddressBarFocusRequest();
  });
});
