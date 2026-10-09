import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  applyNativeWebViewActivity,
  forgetNativeWebViewActivity,
  isBrowserRouteVisible,
  setBrowserRouteVisible,
  setWebViewActivityDriverForTests,
  subscribeBrowserRouteVisible,
} from './webview-activity';

type Call = { viewTag: number; active: boolean };

let calls: Call[] = [];
let answer: () => Promise<boolean> = () => Promise.resolve(true);

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  calls = [];
  answer = () => Promise.resolve(true);
  setWebViewActivityDriverForTests((viewTag, active) => {
    calls.push({ viewTag, active });
    return answer();
  });
});

afterEach(() => {
  setWebViewActivityDriverForTests(null);
});

describe('parking WebViews natively', () => {
  test('each state is sent once per WebView, however often a render re-binds it', () => {
    applyNativeWebViewActivity(11, false);
    applyNativeWebViewActivity(11, false);
    applyNativeWebViewActivity(11, false);
    applyNativeWebViewActivity(12, true);
    applyNativeWebViewActivity(12, true);
    assert.deepEqual(calls, [
      { viewTag: 11, active: false },
      { viewTag: 12, active: true },
    ]);
  });

  test('switching tabs sends the new state to both WebViews', () => {
    applyNativeWebViewActivity(11, true);
    applyNativeWebViewActivity(12, false);
    // Tab 12 comes to the front.
    applyNativeWebViewActivity(11, false);
    applyNativeWebViewActivity(12, true);
    assert.deepEqual(calls.slice(2), [
      { viewTag: 11, active: false },
      { viewTag: 12, active: true },
    ]);
  });

  test('a WebView the native side could not find yet is tried again on the next bind', async () => {
    answer = () => Promise.resolve(false);
    applyNativeWebViewActivity(21, false);
    await settle();
    answer = () => Promise.resolve(true);
    applyNativeWebViewActivity(21, false);
    await settle();
    applyNativeWebViewActivity(21, false);
    assert.equal(calls.length, 2);
  });

  test('a failed native call is tried again, never remembered as applied', async () => {
    answer = () => Promise.reject(new Error('view gone'));
    applyNativeWebViewActivity(31, true);
    await settle();
    applyNativeWebViewActivity(31, true);
    assert.equal(calls.length, 2);
  });

  test('a WebView that unmounted is forgotten: a new one with the same tag gets its state', () => {
    applyNativeWebViewActivity(41, false);
    forgetNativeWebViewActivity(41);
    applyNativeWebViewActivity(41, false);
    assert.equal(calls.length, 2);
  });

  test('the remembered states stay bounded', () => {
    for (let tag = 100; tag < 140; tag += 1) {
      applyNativeWebViewActivity(tag, false);
    }
    // The oldest were dropped, so re-applying one of them reaches native again; a recent one does not.
    applyNativeWebViewActivity(100, false);
    applyNativeWebViewActivity(139, false);
    assert.equal(calls.length, 41);
  });
});

describe('Browser route visibility', () => {
  test('subscribers hear each change once, and only real changes', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeBrowserRouteVisible(() => seen.push(isBrowserRouteVisible()));
    setBrowserRouteVisible(false);
    setBrowserRouteVisible(false);
    setBrowserRouteVisible(true);
    unsubscribe();
    setBrowserRouteVisible(false);
    assert.deepEqual(seen, [false, true]);
  });
});
