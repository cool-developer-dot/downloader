import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { SELECTION_CONTEXT_SEPARATOR, SELECTION_READ_SCRIPT, splitSelectionResult } from '../selection/selection-read-script.ts';
import { addStroke, EMPTY_DRAWING, eraseAt, redo, strokePath, strokesJson, undo } from '../draw/draw-core.ts';
import { detectPageLanguage, languageFromAttribute, languageFromText, parseStringList, shouldOfferTranslate } from '../language/language-detect.ts';
import {
  checkFetchedPage,
  clampAlertHours,
  connectionAllows,
  extractPageText,
  extractTitle,
  hashText,
  needsJavaScript,
} from '../page-alerts/page-alerts-core.ts';
import {
  cleanAnchor,
  FIND_ANCHOR_SOURCE,
  matchesHighlightQuery,
  pageKey,
  parseAnnotateMessage,
  removeHighlightScript,
  restoreHighlightsScript,
  shareTextFor,
} from './highlights-core.ts';

const findAnchor = (text: string, exact: string, prefix: string, suffix: string): number =>
  vm.runInNewContext(`${FIND_ANCHOR_SOURCE}; __vidoraxFindAnchor(t, e, p, s)`, { t: text, e: exact, p: prefix, s: suffix });

describe('B23 #261 highlights: text anchors', () => {
  test('the occurrence whose surroundings match wins; gone text is -1', () => {
    const text = 'Lahore is old. Lahore Fort is in Lahore. Visit Lahore Fort at dawn.';
    assert.equal(findAnchor(text, 'Lahore Fort', '', ''), 15);
    assert.equal(findAnchor(text, 'Lahore Fort', 'Visit ', ' at dawn'), 47);
    assert.equal(findAnchor(text, 'Lahore Fort', 'xx Visit ', ' at dusk'), 47, 'a partly matching context still picks the best');
    assert.equal(findAnchor(text, 'Karachi', '', ''), -1);
    assert.equal(findAnchor('اردو متن اور اردو', 'اردو', 'اور ', ''), 13);
  });

  test('B8’s read script returns the text with its anchor in the same result; nothing is left in the page', () => {
    const range = { startContainer: 'a', startOffset: 0, endContainer: 'a', endOffset: 4, toString: () => 'Fort' };
    const document = {
      activeElement: { tagName: 'BODY' },
      body: { childNodes: { length: 3 } },
      createRange: () => {
        const r: Record<string, unknown> = {};
        r.setStart = (n: unknown) => (r.start = n);
        r.setEnd = (n: unknown) => (r.end = n);
        r.toString = () => (r.start === document.body ? 'Visit the Lahore ' : ' at dawn, before the crowds');
        return r;
      },
    };
    const window: Record<string, unknown> = {
      getSelection: () => ({ rangeCount: 1, getRangeAt: () => range, toString: () => 'Fort' }),
    };
    const keysBefore = Object.keys(window).sort();
    const raw = vm.runInNewContext(SELECTION_READ_SCRIPT, { window, document, String, JSON }) as string;
    assert.deepEqual(Object.keys(window).sort(), keysBefore, 'no page variable');
    assert.ok(raw.startsWith('Fort' + SELECTION_CONTEXT_SEPARATOR));
    assert.deepEqual(JSON.parse(JSON.stringify(splitSelectionResult(raw))), {
      text: 'Fort',
      anchor: { exact: 'Fort', prefix: 'Visit the Lahore ', suffix: ' at dawn, before the crowds' },
    });
    // A text field's selection: the text alone, no anchor.
    const field = { tagName: 'TEXTAREA', value: 'hello world', selectionStart: 0, selectionEnd: 5 };
    const plain = vm.runInNewContext(SELECTION_READ_SCRIPT, { window: { getSelection: () => null }, document: { ...document, activeElement: field }, String, JSON });
    assert.equal(plain, 'hello');
    assert.deepEqual(splitSelectionResult('hello'), { text: 'hello', anchor: null });
    // A long selection still fits the native 20,000 cap with its anchor; a cut tail falls back to the text alone.
    const long = vm.runInNewContext(SELECTION_READ_SCRIPT, {
      window: { getSelection: () => ({ rangeCount: 1, getRangeAt: () => range, toString: () => 'x'.repeat(25_000) }) },
      document,
      String,
      JSON,
    }) as string;
    assert.ok(long.length <= 20_000);
    assert.equal(splitSelectionResult(long).anchor?.exact, 'Fort');
    assert.deepEqual(splitSelectionResult('abc' + SELECTION_CONTEXT_SEPARATOR + '{"e":"Fo'), { text: 'abc', anchor: null });
  });

  test('messages are cleaned and bounded', () => {
    assert.deepEqual(cleanAnchor({ exact: 'x', prefix: 'p'.repeat(50), suffix: 's'.repeat(50) }), { exact: 'x', prefix: 'p'.repeat(32), suffix: 's'.repeat(32) });
    assert.equal(cleanAnchor({ exact: '   ' }), null);
    assert.deepEqual(parseAnnotateMessage('{"type":"vidorax_annotate","kind":"restored","found":2,"of":3}'), { kind: 'restored', found: 2, of: 3 });
    assert.equal(parseAnnotateMessage('{"type":"vidorax_annotate","kind":"anchor","exact":"x"}'), undefined, 'pages no longer send anchors');
    assert.equal(parseAnnotateMessage('{"type":"other"}'), undefined);
    assert.equal(parseAnnotateMessage(`{"type":"vidorax_annotate","kind":"lang","sample":"${'a'.repeat(30_000)}"}`), undefined);
  });

  test('marks carry no VidoraX class, id or attribute; notes never reach the page; remove and restore twice', () => {
    const { document, body, p } = fakeDom(['Visit the ', 'Lahore Fort', ' at dawn. Lahore Fort again.']);
    const posted: string[] = [];
    const window = { ReactNativeWebView: { postMessage: (m: string) => posted.push(m) } };
    const highlight = { id: 'h1', exact: 'Lahore Fort', prefix: 'Visit the ', suffix: ' at dawn', color: 'green' as const, note: 'SECRET NOTE' };
    const script = restoreHighlightsScript([highlight]);
    assert.ok(!script.includes('SECRET NOTE') && !script.includes('h1'), 'no note, no id in the page');
    assert.ok(!/data-vidorax|className|setAttribute\(/.test(script));
    const run = (code: string) => vm.runInNewContext(code, { document, window, NodeFilter: { SHOW_TEXT: 4 }, JSON });
    run(script);
    const marks = () => all(body).filter((n) => n.nodeName === 'MARK');
    assert.equal(marks().length, 1);
    assert.deepEqual(marks()[0].attributeNames(), ['style'], 'only the inline colour');
    assert.equal(marks()[0].style.backgroundColor, 'rgb(165, 214, 167)');
    assert.equal(textOf(marks()[0]), 'Lahore Fort');
    assert.equal(textOf(body), 'Visit the Lahore Fort at dawn. Lahore Fort again.', 'the text is unchanged');
    run(script);
    assert.equal(marks().length, 1, 'restoring again adds nothing');
    assert.deepEqual(JSON.parse(posted[1]), { type: 'vidorax_annotate', kind: 'restored', found: 1, of: 1 });
    run(removeHighlightScript(highlight));
    assert.equal(marks().length, 0);
    assert.equal(textOf(p), 'Visit the Lahore Fort at dawn. Lahore Fort again.');
    assert.doesNotThrow(() => new vm.Script(removeHighlightScript({ ...highlight, exact: '"]; alert(1); //' })));
  });

  test('page key, search and share text', () => {
    assert.equal(pageKey('https://example.com/a?x=1#part'), 'https://example.com/a?x=1');
    const h = { text: 'Badshahi Mosque', note: 'visit in winter', pageTitle: 'Lahore guide', pageUrl: 'https://example.com/lahore' };
    assert.ok(matchesHighlightQuery(h, 'mosque winter'));
    assert.ok(!matchesHighlightQuery(h, 'karachi'));
    assert.equal(shareTextFor(h), '“Badshahi Mosque”\n\nvisit in winter\n\nLahore guide\nhttps://example.com/lahore');
  });
});

describe('B23 #279 draw on page', () => {
  test('strokes, the eraser removes touched strokes, undo and redo both ways', () => {
    let s = addStroke(EMPTY_DRAWING, '#E53935', 8, [0, 0, 100, 0]);
    s = addStroke(s, '#1E88E5', 8, [0, 50, 100, 50]);
    assert.equal(s.strokes.length, 2);
    assert.equal(addStroke(s, '#000', 4, [1]), s, 'one coordinate is no stroke');
    const erased = eraseAt(s, 50, 2, 3);
    assert.deepEqual(erased.strokes.map((x) => x.color), ['#1E88E5']);
    assert.equal(eraseAt(erased, 50, 25, 3), erased, 'nothing touched: no undo step');
    const undone = undo(erased);
    assert.deepEqual(undone.strokes.map((x) => x.id), [1, 2]);
    assert.deepEqual(redo(undone).strokes.map((x) => x.id), [2]);
    assert.deepEqual(undo(undone).strokes.map((x) => x.id), [1], 'then the second stroke’s add is undone');
    assert.equal(undo(EMPTY_DRAWING), EMPTY_DRAWING);
    assert.equal(redo(EMPTY_DRAWING), EMPTY_DRAWING);
    // A new stroke after an undo drops the redo list.
    assert.equal(addStroke(undone, '#000', 4, [5, 5]).redo.length, 0);
  });

  test('paths and the export JSON', () => {
    assert.equal(strokePath([1, 2, 3, 4]), 'M1.0 2.0 L3.0 4.0');
    assert.equal(strokePath([1, 2]), 'M1.0 2.0 L1.1 2.0');
    const s = addStroke(EMPTY_DRAWING, '#43A047', 16, [1.234, 2.345]);
    assert.equal(strokesJson(s), '[{"color":"#43A047","width":16,"points":[1.2,2.3]}]');
  });
});

describe('B23 #289 page change alerts', () => {
  const page = (body: string) => `<html><head><title>News &amp; views</title><script>var x = Date.now();</script></head><body>${body}</body></html>`;
  const long = 'Lahore weather today is clear with mild winds and a high of twenty four degrees. '.repeat(4);

  test('visible text only: no scripts, styles, noscript or comments; entities decoded', () => {
    const html = page(`<style>p{}</style><!-- ad --><noscript>Enable JavaScript</noscript><p>Tom &amp; Jerry&#39;s <b>show</b></p><script>tick()</script>`);
    assert.equal(extractPageText(html), "Tom & Jerry's show");
    assert.equal(extractTitle(html), 'News & views');
  });

  test('pages that need JavaScript can’t be watched; a change is a different hash', () => {
    assert.ok(needsJavaScript(extractPageText(page('<div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript>'))));
    const first = checkFetchedPage({ ok: true, status: 200, text: page(`<p>${long}</p>`), contentType: 'text/html' }, '');
    assert.equal(first.status, 'changed');
    const hash = first.status === 'changed' ? first.hash : '';
    assert.equal(checkFetchedPage({ ok: true, status: 200, text: page(`<p>${long}</p><script>changing()</script>`), contentType: 'text/html' }, hash).status, 'same', 'scripts don’t count');
    assert.equal(checkFetchedPage({ ok: true, status: 200, text: page(`<p>${long} Update.</p>`), contentType: 'text/html' }, hash).status, 'changed');
    assert.equal(checkFetchedPage({ ok: true, status: 200, text: page('<div id="app"></div>'), contentType: 'text/html' }, hash).status, 'cannotWatch');
    assert.equal(checkFetchedPage({ ok: true, status: 500, text: '', contentType: 'text/html' }, hash).status, 'failed');
    assert.equal(checkFetchedPage({ ok: true, status: 200, text: '%PDF', contentType: 'application/pdf' }, hash).status, 'cannotWatch');
    assert.equal(hashText('a'), hashText('a'));
    assert.notEqual(hashText('ab'), hashText('ba'));
    assert.match(hashText(long), /^[0-9a-f]{16}$/);
  });

  test('every 6 hours by default, at least 1; Wi-Fi only by default', () => {
    assert.equal(clampAlertHours(undefined), 6);
    assert.equal(clampAlertHours(0), 1);
    assert.equal(clampAlertHours(1000), 168);
    assert.equal(clampAlertHours('12'), 12);
    assert.ok(connectionAllows('wifi', true, true));
    assert.ok(connectionAllows('ethernet', true, true));
    assert.ok(!connectionAllows('cellular', true, true));
    assert.ok(connectionAllows('cellular', true, false));
    assert.ok(!connectionAllows('wifi', false, false));
  });
});

describe('B23 #263 language detection and the translate offer', () => {
  const urdu = 'پاکستان کا دارالحکومت اسلام آباد ہے اور لاہور اس کا دوسرا بڑا شہر ہے جہاں بہت سی تاریخی عمارتیں ہیں';
  const arabic = 'القاهرة هي عاصمة مصر وأكبر مدنها وتقع على ضفاف نهر النيل وهي مدينة قديمة جدا ومعروفة';
  const persian = 'تهران پایتخت ایران است و بزرگترین شهر این کشور به شمار می رود که در شمال کشور قرار گرفته';

  test('<html lang>, then the script; Urdu letters tell Urdu from Arabic and Persian', () => {
    assert.equal(languageFromAttribute('ur-PK'), 'ur');
    assert.equal(languageFromAttribute('zh_Hant'), 'zh');
    assert.equal(languageFromAttribute(''), null);
    assert.equal(languageFromText(urdu), 'ur');
    assert.equal(languageFromText(arabic), 'ar');
    assert.equal(languageFromText(persian), 'fa');
    assert.equal(languageFromText('Москва — столица России и крупнейший город страны'), 'ru');
    assert.equal(languageFromText('東京は日本の首都であり、最大の都市です。ここには多くの人が住んでいます。'), 'ja');
    assert.equal(languageFromText('The quick brown fox jumps over the lazy dog many times over'), null, 'Latin: unknown');
    assert.equal(languageFromText('اردو'), null, 'too little text');
    assert.equal(detectPageLanguage({ lang: 'en', sample: urdu }), 'ur', 'a page marked en but written in Urdu');
    assert.equal(detectPageLanguage({ lang: 'fr', sample: 'Bonjour à tous' }), 'fr');
    assert.equal(detectPageLanguage({ lang: 'ar', sample: urdu }), 'ar', 'a non-English lang attribute is trusted');
  });

  test('once per site, never for the app’s language, Never lists, off, incognito', () => {
    const base = { language: 'ar', appLanguage: 'en', host: 'news.example', offeredHosts: new Set<string>(), neverLanguages: [], neverSites: [], enabled: true, incognito: false };
    assert.ok(shouldOfferTranslate(base));
    assert.ok(!shouldOfferTranslate({ ...base, appLanguage: 'ar' }));
    assert.ok(!shouldOfferTranslate({ ...base, offeredHosts: new Set(['news.example']) }));
    assert.ok(!shouldOfferTranslate({ ...base, neverLanguages: ['ar'] }));
    assert.ok(!shouldOfferTranslate({ ...base, neverSites: ['news.example'] }));
    assert.ok(!shouldOfferTranslate({ ...base, enabled: false }));
    assert.ok(!shouldOfferTranslate({ ...base, incognito: true }));
    assert.ok(!shouldOfferTranslate({ ...base, language: null }));
    assert.deepEqual(parseStringList('["ar","ar","fa",3]'), ['ar', 'fa']);
    assert.deepEqual(parseStringList('nope'), []);
  });
});

// ---- a tiny DOM for the highlight scripts (text nodes, elements, splitText, a text TreeWalker) ----
type FakeNode = {
  nodeName: string;
  data: string;
  parentNode: FakeNode | null;
  childNodes: FakeNode[];
  style: Record<string, string>;
  attributeNames: () => string[];
  splitText: (offset: number) => FakeNode;
  insertBefore: (n: FakeNode, ref: FakeNode | null) => void;
  appendChild: (n: FakeNode) => void;
  removeChild: (n: FakeNode) => void;
  normalize: () => void;
  readonly firstChild: FakeNode | undefined;
};

function makeNode(nodeName: string, data = ''): FakeNode {
  const node: FakeNode = {
    nodeName,
    data,
    parentNode: null,
    childNodes: [],
    style: {},
    attributeNames: () => (Object.keys(node.style).length ? ['style'] : []),
    splitText(offset) {
      const rest = makeNode('#text', node.data.slice(offset));
      node.data = node.data.slice(0, offset);
      const parent = node.parentNode!;
      parent.insertBefore(rest, parent.childNodes[parent.childNodes.indexOf(node) + 1] ?? null);
      return rest;
    },
    insertBefore(n, ref) {
      n.parentNode?.removeChild(n);
      const at = ref ? node.childNodes.indexOf(ref) : node.childNodes.length;
      node.childNodes.splice(at, 0, n);
      n.parentNode = node;
    },
    appendChild(n) {
      node.insertBefore(n, null);
    },
    removeChild(n) {
      node.childNodes.splice(node.childNodes.indexOf(n), 1);
      n.parentNode = null;
    },
    normalize() {
      for (let i = node.childNodes.length - 1; i > 0; i--) {
        const a = node.childNodes[i - 1];
        const b = node.childNodes[i];
        if (a.nodeName === '#text' && b.nodeName === '#text') {
          a.data += b.data;
          node.removeChild(b);
        }
      }
    },
    get firstChild() {
      return node.childNodes[0];
    },
  };
  return node;
}

function all(root: FakeNode): FakeNode[] {
  return root.childNodes.flatMap((c) => [c, ...all(c)]);
}

function textOf(root: FakeNode): string {
  return all(root).filter((n) => n.nodeName === '#text').map((n) => n.data).join('');
}

function fakeDom(texts: string[]) {
  const body = makeNode('BODY');
  const p = makeNode('P');
  body.appendChild(p);
  for (const t of texts) p.appendChild(makeNode('#text', t));
  const document = {
    body,
    createElement: (name: string) => makeNode(name.toUpperCase()),
    createTreeWalker: (root: FakeNode) => {
      const list = all(root).filter((n) => n.nodeName === '#text');
      let i = 0;
      return { nextNode: () => list[i++] ?? null };
    },
  };
  return { document, body, p };
}
