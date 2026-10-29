import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  AUTO_HIDE_HIDE_AFTER_PX,
  INITIAL_AUTO_HIDE,
  onAutoHideHold,
  onAutoHideScroll,
  type AutoHideHold,
  type AutoHideState,
} from './auto-hide.ts';
import { registrableDomain } from './domain.ts';
import { completionOnSelection, inlineCompletion, rankAutocompleteHosts } from './inline-autocomplete.ts';

const hosts = rankAutocompleteHosts(
  [
    { host: 'en.wikipedia.org', visits: 9, bookmarked: false },
    { host: 'www.wikihow.com', visits: 2, bookmarked: false },
    { host: 'www.bbc.com', visits: 4, bookmarked: true },
    { host: 'example.com', visits: 1, bookmarked: false },
  ],
  registrableDomain,
);

describe('inline autocomplete (#24)', () => {
  test('completes the best site that starts with the typed text', () => {
    assert.equal(inlineCompletion('wik', hosts), 'wikipedia.org');
    assert.equal(inlineCompletion('en.w', hosts), 'en.wikipedia.org');
    assert.equal(inlineCompletion('wikih', hosts), 'wikihow.com');
  });

  test('www. and a scheme are kept as typed; case kept', () => {
    assert.equal(inlineCompletion('www.bb', hosts), 'www.bbc.com');
    assert.equal(inlineCompletion('https://bb', hosts), 'https://bbc.com');
    assert.equal(inlineCompletion('WiK', hosts), 'WiKipedia.org');
  });

  test('never in the middle of a word or after the host', () => {
    assert.equal(inlineCompletion('ipedia', hosts), null);
    assert.equal(inlineCompletion('wikipedia.org/w', hosts), null);
    assert.equal(inlineCompletion('wik', hosts, { caretAtEnd: false }), null);
  });

  test('no completion for searches, exact hosts or nothing known', () => {
    assert.equal(inlineCompletion('wik cats', hosts), null);
    assert.equal(inlineCompletion('wikipedia.org', hosts), null);
    assert.equal(inlineCompletion('zzz', hosts), null);
    assert.equal(inlineCompletion('', hosts), null);
    assert.equal(inlineCompletion('www.', hosts), null);
    assert.equal(inlineCompletion('لاہ', hosts), null);
  });

  test('ranking: visits, then bookmarks, then shorter', () => {
    assert.deepEqual(hosts.slice(0, 2).map((h) => h.host), ['wikipedia.org', 'en.wikipedia.org']);
    assert.equal(hosts.find((h) => h.host === 'bbc.com')!.score, 6);
  });

  test('a site used often beats one bookmarked once (scores add up over its pages)', () => {
    const ranked = rankAutocompleteHosts(
      [
        { host: 'commons.wikimedia.org', visits: 0, bookmarked: true },
        { host: 'en.wikipedia.org', visits: 0, bookmarked: true },
        { host: 'en.wikipedia.org', visits: 1, bookmarked: false },
        { host: 'ur.wikipedia.org', visits: 1, bookmarked: false },
      ],
      registrableDomain,
    );
    assert.equal(inlineCompletion('wik', ranked), 'wikipedia.org');
    assert.equal(ranked.find((h) => h.host === 'wikipedia.org')!.score, 4);
    assert.equal(ranked.find((h) => h.host === 'wikimedia.org')!.score, 2);
  });
});

describe('caret and selection moves while a completion shows (#24)', () => {
  const typed = 'wik';
  const shown = 'wikipedia.org';
  test('its own selection, and the caret right after typing, keep it', () => {
    assert.equal(completionOnSelection(typed, shown, { start: 3, end: 13 }), 'keep');
    assert.equal(completionOnSelection(typed, shown, { start: 3, end: 3 }), 'keep');
    // A late event from the previous letter's completion ("wi" + "kipedia.org").
    assert.equal(completionOnSelection(typed, shown, { start: 2, end: 13 }), 'keep');
  });
  test('the end (→, a tap there) or Select all accepts it', () => {
    assert.equal(completionOnSelection(typed, shown, { start: 13, end: 13 }), 'accept');
    assert.equal(completionOnSelection(typed, shown, { start: 0, end: 13 }), 'accept');
  });
  test('the caret or a selection inside what was typed drops it', () => {
    assert.equal(completionOnSelection(typed, shown, { start: 1, end: 1 }), 'drop');
    assert.equal(completionOnSelection(typed, shown, { start: 0, end: 3 }), 'drop');
  });
});

describe('auto-hide address bar (#29)', () => {
  const free: AutoHideHold = { enabled: true, loading: false, editing: false, videoOffer: false };
  const scrollTo = (ys: number[], hold = free, start: AutoHideState = INITIAL_AUTO_HIDE) =>
    ys.reduce((state, y) => onAutoHideScroll(state, y, hold), start);

  test('hides after scrolling down far enough, shows when scrolling up', () => {
    const down = scrollTo([0, 40, 80, 80 + AUTO_HIDE_HIDE_AFTER_PX + 10]);
    assert.equal(down.hidden, true);
    assert.equal(scrollTo([300, 290], free, down).hidden, true, 'a small move up keeps it hidden');
    assert.equal(scrollTo([300, 250], free, down).hidden, false);
  });

  test('a small scroll down does not hide it', () => {
    assert.equal(scrollTo([0, 40, 60]).hidden, false);
    // Mid-page too: 40 px down from where the downward scroll began.
    const shown = scrollTo([0, 300, 600, 400]);
    assert.equal(shown.hidden, false);
    assert.equal(scrollTo([440], free, shown).hidden, false);
  });

  test('always shown at the top', () => {
    const hidden = scrollTo([0, 200, 400]);
    assert.equal(hidden.hidden, true);
    assert.equal(onAutoHideScroll(hidden, 10, free).hidden, false);
  });

  test('loading, editing, a video offer or the setting off keep it shown', () => {
    for (const hold of [
      { ...free, loading: true },
      { ...free, editing: true },
      { ...free, videoOffer: true },
      { ...free, enabled: false },
    ]) {
      assert.equal(scrollTo([0, 200, 600], hold).hidden, false, JSON.stringify(hold));
      const hidden = scrollTo([0, 200, 600]);
      assert.equal(onAutoHideHold(hidden, hold).hidden, false);
    }
  });

  test('direction changes restart the distance', () => {
    let state = scrollTo([0, 200, 400]);
    state = scrollTo([360], free, state);
    assert.equal(state.hidden, false);
    state = scrollTo([400], free, state);
    assert.equal(state.hidden, false, 'needs a full hide distance again');
    state = scrollTo([360 + AUTO_HIDE_HIDE_AFTER_PX + 1], free, state);
    assert.equal(state.hidden, true);
  });

  test('garbage positions are treated as the top', () => {
    assert.equal(onAutoHideScroll(scrollTo([0, 300, 500]), Number.NaN, free).hidden, false);
  });
});
