import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { parseBrowserChromeMessage } from '../bridge/browser-chrome.bridge.ts';
import { FIND_CLEAR_SCRIPT, FIND_MATCH_CAP, findScript, findStepScript, jsString } from './find-in-page-script.ts';
import { applyFindResult, CLOSED_FIND_STATE, findCountLabel, shouldCloseFind, type FindState } from './find-in-page-state.ts';

type FakeEl = { nodeType: 1; tagName: string; hidden?: boolean; scrolled: number };
type FakeText = { nodeType: 3; nodeValue: string; parentElement: FakeEl };
type FakeRange = { start?: [FakeText, number]; end?: [FakeText, number]; startContainer?: FakeText };

/**
 * A page for the find scripts: text nodes under elements (one per piece), the TreeWalker over them, Ranges, and
 * optionally the CSS Custom Highlight API.
 */
function fakePage(pieces: (string | { text: string; tag?: string; hidden?: boolean })[], options: { highlights?: boolean } = {}) {
  const els: FakeEl[] = [];
  const texts: FakeText[] = pieces.map((piece) => {
    const p = typeof piece === 'string' ? { text: piece } : piece;
    const el: FakeEl & { getClientRects: () => unknown[]; scrollIntoView: () => void } = {
      nodeType: 1,
      tagName: p.tag ?? 'SPAN',
      hidden: p.hidden,
      scrolled: 0,
      getClientRects: () => (p.hidden ? [] : [{}]),
      scrollIntoView: () => {
        el.scrolled += 1;
      },
    };
    els.push(el);
    return { nodeType: 3, nodeValue: p.text, parentElement: el };
  });
  const posted: { type: string; payload: Record<string, unknown> }[] = [];
  const highlights = new Map<string, { ranges: FakeRange[] }>();
  let selection: FakeRange[] = [];
  const document: Record<string, unknown> = {
    body: { nodeType: 1 },
    adoptedStyleSheets: [] as unknown[],
    createTreeWalker: () => {
      let i = -1;
      return { nextNode: () => (++i < texts.length ? texts[i] : null) };
    },
    createRange: () => {
      const range: FakeRange & { setStart: (n: FakeText, o: number) => void; setEnd: (n: FakeText, o: number) => void } = {
        setStart(n, o) {
          range.start = [n, o];
          range.startContainer = n;
        },
        setEnd(n, o) {
          range.end = [n, o];
        },
      };
      return range;
    },
  };
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (raw: string) => posted.push(JSON.parse(raw)) },
    getSelection: () => ({
      removeAllRanges: () => (selection = []),
      addRange: (r: FakeRange) => selection.push(r),
    }),
  };
  const context: Record<string, unknown> = { window, document, Map, JSON, Date, Array, RegExp };
  if (options.highlights !== false) {
    class Highlight {
      ranges: FakeRange[];
      constructor(...ranges: FakeRange[]) {
        this.ranges = [...ranges];
      }
      add(range: FakeRange) {
        this.ranges.push(range);
      }
    }
    class CSSStyleSheet {
      css = '';
      replaceSync(css: string) {
        this.css = css;
      }
    }
    const CSS = { highlights };
    Object.assign(window, { Highlight, CSS, CSSStyleSheet });
    Object.assign(context, { Highlight, CSS, CSSStyleSheet });
  }
  vm.createContext(context);
  const textOf = (range: FakeRange) => {
    const [a, s] = range.start!;
    const [b, e] = range.end!;
    if (a === b) return a.nodeValue.slice(s, e);
    const from = texts.indexOf(a);
    const to = texts.indexOf(b);
    let out = a.nodeValue.slice(s);
    for (let i = from + 1; i < to; i++) out += texts[i].nodeValue;
    return out + b.nodeValue.slice(0, e);
  };
  return {
    run: (script: string) => vm.runInContext(script, context),
    posted,
    highlights,
    selection: () => selection,
    document,
    els,
    textOf,
    last: () => posted[posted.length - 1]?.payload,
  };
}

const search = (query: string, options: { matchCase?: boolean; wholeWord?: boolean; requestId?: number; cap?: number } = {}) =>
  findScript({ requestId: options.requestId ?? 1, query, matchCase: options.matchCase ?? false, wholeWord: options.wholeWord ?? false, cap: options.cap });

describe('B7 find script (node:vm page)', () => {
  test('#67 counts every match and reports "1 of n"; #71 highlights all and the current one', () => {
    const page = fakePage(['Lahore is in Punjab. ', 'lahore fort, LAHORE museum']);
    page.run(search('lahore'));
    assert.deepEqual(page.last(), { requestId: 1, current: 1, total: 3, capped: false });
    assert.equal(page.highlights.get('vidorax-find')!.ranges.length, 3);
    assert.deepEqual(page.highlights.get('vidorax-find-current')!.ranges.map(page.textOf), ['Lahore']);
    assert.equal((page.document.adoptedStyleSheets as unknown[]).length, 1);
    assert.equal(page.els[0].scrolled, 1);
  });

  test('#69 Match case: "Apple" no longer finds "apple"', () => {
    const page = fakePage(['Apple apple APPLE']);
    page.run(search('Apple', { matchCase: true }));
    assert.equal(page.last()!.total, 1);
    page.run(search('Apple', { matchCase: false, requestId: 2 }));
    assert.equal(page.last()!.total, 3);
  });

  test('#70 Whole word: "cat" no longer finds "category" — Urdu too', () => {
    const page = fakePage(['cat category cat. concat']);
    page.run(search('cat', { wholeWord: true }));
    assert.equal(page.last()!.total, 2);
    const urdu = fakePage(['پاکستان پاکستانی پاکستان۔']);
    urdu.run(search('پاکستان', { wholeWord: true }));
    assert.equal(urdu.last()!.total, 2);
    urdu.run(search('پاکستان', { wholeWord: false, requestId: 2 }));
    assert.equal(urdu.last()!.total, 3);
  });

  test('a match can span elements; hidden, script and style text is skipped', () => {
    const page = fakePage(['Lah', { text: 'ore', tag: 'B' }, { text: 'Lahore', tag: 'SCRIPT' }, { text: 'Lahore', hidden: true }]);
    page.run(search('lahore'));
    assert.equal(page.last()!.total, 1);
    assert.deepEqual(page.highlights.get('vidorax-find')!.ranges.map(page.textOf), ['Lahore']);
  });

  test('regex characters are literal; spaces match any white space', () => {
    const page = fakePage(['a+b (c) a.b\nnew   line [x]']);
    page.run(search('a+b'));
    assert.equal(page.last()!.total, 1);
    page.run(search('a.b', { requestId: 2 }));
    assert.equal(page.last()!.total, 1);
    page.run(search('b\nnew line', { requestId: 3 }));
    assert.equal(page.last()!.total, 1);
    page.run(search('[x]', { requestId: 4 }));
    assert.equal(page.last()!.total, 1);
  });

  test('#68 next / previous wrap around and move the current highlight', () => {
    const page = fakePage(['one two one three one']);
    page.run(search('one'));
    page.run(findStepScript(2, 1));
    assert.deepEqual(page.last(), { requestId: 2, current: 2, total: 3, capped: false });
    page.run(findStepScript(3, 1));
    page.run(findStepScript(4, 1));
    assert.equal(page.last()!.current, 1);
    page.run(findStepScript(5, -1));
    assert.equal(page.last()!.current, 3);
  });

  test('no matches and empty searches report 0', () => {
    const page = fakePage(['nothing here']);
    page.run(search('zzz'));
    assert.deepEqual(page.last(), { requestId: 1, current: 0, total: 0, capped: false });
    page.run(search('   ', { requestId: 2 }));
    assert.deepEqual(page.last(), { requestId: 2, current: 0, total: 0, capped: false });
    page.run(findStepScript(3, 1));
    assert.equal(page.last()!.total, 0);
  });

  test('a very long page stops at the cap and says so', () => {
    const page = fakePage(['x '.repeat(FIND_MATCH_CAP + 50)]);
    page.run(search('x'));
    assert.deepEqual(page.last(), { requestId: 1, current: 1, total: FIND_MATCH_CAP, capped: true });
  });

  test('#71 closing clears every highlight and the style sheet, and sends nothing', () => {
    const page = fakePage(['find me, find me']);
    page.run(search('find'));
    const before = page.posted.length;
    page.run(FIND_CLEAR_SCRIPT);
    assert.equal(page.highlights.size, 0);
    assert.equal((page.document.adoptedStyleSheets as unknown[]).length, 0);
    assert.equal(page.posted.length, before);
  });

  test('without the Highlight API (old WebView) the current match is the selection', () => {
    const page = fakePage(['alpha beta alpha'], { highlights: false });
    page.run(search('alpha'));
    assert.equal(page.last()!.total, 2);
    assert.deepEqual(page.selection().map(page.textOf), ['alpha']);
    page.run(findStepScript(2, 1));
    assert.equal(page.selection().length, 1);
    page.run(FIND_CLEAR_SCRIPT);
    assert.equal(page.selection().length, 0);
  });

  test('only numbers go back to the app; the search text is a quoted string literal', () => {
    const page = fakePage(['a "quote" and \u2028 separator']);
    page.run(search('"quote"'));
    assert.deepEqual(Object.keys(page.last()!).sort(), ['capped', 'current', 'requestId', 'total']);
    assert.equal(jsString('x\u2028y'), '"x\\u2028y"');
    const script = search("'); alert(1); ('");
    assert.ok(script.includes(`var query = "'); alert(1); ('";`));
  });
});

describe('B7 bar state', () => {
  const open: FindState = { ...CLOSED_FIND_STATE, open: true, tabId: 't1', pageUrl: 'https://e.com/', query: 'x', requestId: 4 };

  test('only the latest answer from the bar’s tab counts', () => {
    const result = { requestId: 4, current: 2, total: 9, capped: false };
    assert.equal(applyFindResult(open, result, 't1').total, 9);
    assert.equal(applyFindResult(open, { ...result, requestId: 3 }, 't1'), open);
    assert.equal(applyFindResult(open, result, 't2'), open);
    assert.equal(applyFindResult(CLOSED_FIND_STATE, result, 't1'), CLOSED_FIND_STATE);
  });

  test('"3 of 12", "1000+", "No matches", nothing while empty', () => {
    assert.deepEqual(findCountLabel({ ...open, answered: true, current: 3, total: 12 }), { kind: 'count', current: 3, total: '12' });
    assert.deepEqual(findCountLabel({ ...open, answered: true, current: 1, total: 1000, capped: true }), {
      kind: 'count',
      current: 1,
      total: '1000+',
    });
    assert.deepEqual(findCountLabel({ ...open, answered: true, total: 0 }), { kind: 'none' });
    assert.deepEqual(findCountLabel({ ...open, answered: false }), { kind: 'searching' });
    assert.deepEqual(findCountLabel({ ...open, query: ' ' }), { kind: 'empty' });
  });

  test('closes on another tab in front or when the tab navigates', () => {
    assert.equal(shouldCloseFind(open, { tabId: 't1', url: 'https://e.com/' }), false);
    assert.equal(shouldCloseFind(open, { tabId: 't2', url: 'https://e.com/' }), true);
    assert.equal(shouldCloseFind(open, { tabId: 't1', url: 'https://e.com/next' }), true);
    assert.equal(shouldCloseFind(CLOSED_FIND_STATE, { tabId: 't2', url: 'x' }), false);
  });
});

describe('B7 bridge message', () => {
  const envelope = (payload: Record<string, unknown>) =>
    JSON.stringify({ channel: 'vidorax-browser-chrome', type: 'find_result', payload });

  test('bounded whole numbers only (any page can post this)', () => {
    assert.deepEqual(parseBrowserChromeMessage(envelope({ requestId: 3, current: 2, total: 5, capped: false })), {
      type: 'find_result',
      payload: { requestId: 3, current: 2, total: 5, capped: false },
    });
    for (const bad of [
      { requestId: 3, current: 6, total: 5 },
      { requestId: 3, current: 0, total: 5 },
      { requestId: -1, current: 0, total: 0 },
      { requestId: 3, current: 1.5, total: 5 },
      { requestId: 3, current: 1, total: 1e9 },
      { requestId: '3', current: 1, total: 1 },
    ]) {
      assert.equal(parseBrowserChromeMessage(envelope(bad)), null, JSON.stringify(bad));
    }
    const loose = parseBrowserChromeMessage(envelope({ requestId: 1, current: 0, total: 0, capped: 'yes' }));
    assert.equal(loose?.type === 'find_result' && loose.payload.capped, false);
  });
});
