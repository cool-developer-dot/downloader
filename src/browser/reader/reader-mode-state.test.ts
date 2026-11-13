import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { paragraphStart } from './read-aloud.ts';
import type { ReaderMessage } from './reader-article.ts';
import {
  INITIAL_READER_STATE,
  isReaderAvailable,
  needsCheck,
  onCheckSent,
  onClose,
  onFrontChange,
  onOpenFailed,
  onOpenRequested,
  onReaderMessage,
  readerPageKey,
} from './reader-mode-state.ts';

const URL_A = 'https://news.example.com/a';
const state = (requestId: number, url = URL_A, readerable = true): ReaderMessage => ({ type: 'state', requestId, readerable, url });
const article = (requestId: number, html = '<p>Hello reader</p>'): ReaderMessage => ({
  type: 'article',
  requestId,
  ok: true,
  url: URL_A,
  title: 'T',
  byline: '',
  siteName: '',
  lang: 'en',
  dir: '',
  html,
  truncated: false,
});

describe('reader mode state (#161)', () => {
  test('a check answer counts only for the newest request of the same tab', () => {
    let s = onCheckSent(INITIAL_READER_STATE, 't1', 1);
    s = onCheckSent(s, 't1', 2);
    assert.equal(onReaderMessage(s, 't1', state(1)), s, 'stale request ignored');
    assert.equal(onReaderMessage(s, 't2', state(2)), s, 'other tab ignored');
    s = onReaderMessage(s, 't1', state(2));
    assert.deepEqual(s.checks.t1, { url: URL_A, readerable: true });
    assert.equal('t1' in s.pendingChecks, false);
    assert.equal(onReaderMessage(s, 't1', state(2)), s, 'a repeated answer is ignored');
  });

  test('the button shows only for the page that answered (a #fragment is the same page)', () => {
    let s = onCheckSent(INITIAL_READER_STATE, 't1', 1);
    s = onReaderMessage(s, 't1', state(1, `${URL_A}#top`));
    assert.equal(isReaderAvailable(s, 't1', URL_A), true);
    assert.equal(isReaderAvailable(s, 't1', `${URL_A}#section-2`), true);
    assert.equal(isReaderAvailable(s, 't1', 'https://news.example.com/b'), false);
    assert.equal(isReaderAvailable(s, 't2', URL_A), false);
    const no = onReaderMessage(onCheckSent(s, 't1', 2), 't1', state(2, URL_A, false));
    assert.equal(isReaderAvailable(no, 't1', URL_A), false);
  });

  test('a page is checked once per address, after loading', () => {
    let s = INITIAL_READER_STATE;
    assert.equal(needsCheck(s, { tabId: 't1', url: URL_A, isLoading: true }), false);
    assert.equal(needsCheck(s, { tabId: 't1', url: URL_A, isLoading: false }), true);
    s = onReaderMessage(onCheckSent(s, 't1', 1), 't1', state(1));
    assert.equal(needsCheck(s, { tabId: 't1', url: `${URL_A}#x`, isLoading: false }), false);
    assert.equal(needsCheck(s, { tabId: 't1', url: 'https://news.example.com/b', isLoading: false }), true);
    assert.equal(needsCheck(s, { tabId: null, url: URL_A, isLoading: false }), false);
  });

  test('opening: the newest request of the same tab fills the reader; a failure shows failed', () => {
    let s = onOpenRequested(INITIAL_READER_STATE, 't1', URL_A, 5);
    assert.equal(s.open?.status, 'loading');
    assert.equal(onReaderMessage(s, 't1', article(4)), s);
    assert.equal(onReaderMessage(s, 't2', article(5)), s);
    const ready = onReaderMessage(s, 't1', article(5));
    assert.equal(ready.open?.status, 'ready');
    assert.equal(ready.pendingExtract, null);
    const empty = onReaderMessage(s, 't1', article(5, '<script>x()</script>'));
    assert.equal(empty.open?.status, 'failed');
    const refused = onReaderMessage(s, 't1', { type: 'article', requestId: 5, ok: false, url: URL_A });
    assert.equal(refused.open?.status, 'failed');
    s = onOpenFailed(s, 4);
    assert.equal(s.open?.status, 'loading', 'an old timeout is ignored');
    s = onOpenFailed(s, 5);
    assert.equal(s.open?.status, 'failed');
    assert.equal(onOpenFailed(ready, 5), ready, 'a timeout after the answer is ignored');
  });

  test('the reader closes when its page leaves the front, not on a #fragment jump', () => {
    const open = onReaderMessage(onOpenRequested(INITIAL_READER_STATE, 't1', URL_A, 1), 't1', article(1));
    const front = { tabId: 't1', url: URL_A, isLoading: false, tabIds: ['t1', 't2'] };
    assert.equal(onFrontChange(open, front), open);
    assert.equal(onFrontChange(open, { ...front, url: `${URL_A}#comments` }).open?.status, 'ready');
    assert.equal(onFrontChange(open, { ...front, tabId: 't2' }).open, null);
    assert.equal(onFrontChange(open, { ...front, url: 'https://news.example.com/b' }).open, null);
    assert.equal(onClose(open).open, null);
    assert.equal(onClose(INITIAL_READER_STATE), INITIAL_READER_STATE);
  });

  test("closed tabs' answers and pending checks go", () => {
    let s = onReaderMessage(onCheckSent(INITIAL_READER_STATE, 't1', 1), 't1', state(1));
    s = onCheckSent(s, 't2', 2);
    s = onFrontChange(s, { tabId: 't3', url: URL_A, isLoading: false, tabIds: ['t3'] });
    assert.deepEqual(s.checks, {});
    assert.deepEqual(s.pendingChecks, {});
  });

  test('page key drops only the fragment', () => {
    assert.equal(readerPageKey('https://x.example/a?b=1#c'), 'https://x.example/a?b=1');
  });
});

describe('read aloud: paragraph start (#173)', () => {
  const chunks = [
    { blockIndex: 0, text: 'a' },
    { blockIndex: 2, text: 'b1' },
    { blockIndex: 2, text: 'b2' },
    { blockIndex: 2, text: 'b3' },
    { blockIndex: 3, text: 'c' },
  ];
  test('pause and speed changes go back to the start of the paragraph being read', () => {
    assert.equal(paragraphStart(chunks, 3), 1);
    assert.equal(paragraphStart(chunks, 1), 1);
    assert.equal(paragraphStart(chunks, 4), 4);
    assert.equal(paragraphStart(chunks, 0), 0);
    assert.equal(paragraphStart(chunks, 99), 4);
    assert.equal(paragraphStart([], 3), 0);
  });
});
