import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  hasPasteLinkRequest,
  requestPasteLink,
  resetPasteLinkRequestsForTests,
  subscribePasteLinkRequests,
  takePasteLinkRequest,
} from './paste-link-request';

afterEach(() => resetPasteLinkRequestsForTests());

describe('Paste link from the shortcut or the widget defers to the Paste link action (H7 × F7)', () => {
  test('one request runs the action once', () => {
    assert.equal(hasPasteLinkRequest(), false);
    requestPasteLink();
    requestPasteLink();
    assert.equal(hasPasteLinkRequest(), true);
    assert.equal(takePasteLinkRequest(), true);
    assert.equal(takePasteLinkRequest(), false, 'never twice for one tap');
  });

  test('the handler hears a request made after it mounted, and stops hearing once unsubscribed', () => {
    let heard = 0;
    const off = subscribePasteLinkRequests(() => {
      heard += 1;
    });
    requestPasteLink();
    off();
    requestPasteLink();
    assert.equal(heard, 1);
  });

  test('a request made before the handler mounted is still there for it (cold start)', () => {
    requestPasteLink();
    let heard = 0;
    subscribePasteLinkRequests(() => {
      heard += 1;
    });
    assert.equal(heard, 0, 'mounting does not replay it');
    assert.equal(hasPasteLinkRequest(), true, 'the handler checks for it on mount');
  });

  test('a failing listener never stops the request', () => {
    subscribePasteLinkRequests(() => {
      throw new Error('boom');
    });
    requestPasteLink();
    assert.equal(hasPasteLinkRequest(), true);
  });
});
