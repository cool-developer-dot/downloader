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
    assert.deepEqual(takeAddressBarFocusRequest(), { prefill: null });
    assert.equal(takeAddressBarFocusRequest(), null);
  });

  it('carries the text to put in the field (B5 Search this site)', () => {
    requestAddressBarFocus({ prefill: 'site:example.com ' });
    assert.deepEqual(takeAddressBarFocusRequest(), { prefill: 'site:example.com ' });
    requestAddressBarFocus();
    assert.deepEqual(takeAddressBarFocusRequest(), { prefill: null });
  });

  it('expires when nobody takes it within 5 s', () => {
    const now = mock.method(Date, 'now', () => 1_000_000);
    requestAddressBarFocus();
    now.mock.mockImplementation(() => 1_005_001);
    assert.equal(takeAddressBarFocusRequest(), null);
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
