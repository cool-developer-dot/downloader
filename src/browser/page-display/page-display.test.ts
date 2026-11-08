import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { applyMatrix, displayMatrix, filterMatrix3, nightLightMatrix3 } from './page-display-filters.ts';
import { createPageDisplayNative } from './page-display-native.ts';
import { pageDisplayCss, pageDisplayScript } from './page-display-script.ts';
import {
  normalizePageBrightness,
  normalizePageZoom,
  normalizeTextZoom,
  parseSiteDisplays,
  resetSiteDisplay,
  resolvePageDisplay,
  serializeSiteDisplays,
  updateSiteDisplay,
  type PageDisplayGlobals,
} from './page-display-settings.ts';

const GLOBALS: PageDisplayGlobals = {
  forceDark: 'off',
  textZoom: 100,
  forceZoom: false,
  textReflow: false,
  fontStyle: 'default',
  urduNastaliq: true,
  colorFilter: 'none',
  nightLight: false,
  nightLightStrength: 50,
};

describe('page display settings (B16)', () => {
  test('values are clamped to their ranges and steps', () => {
    assert.equal(normalizeTextZoom(30), 50);
    assert.equal(normalizeTextZoom(500), 200);
    assert.equal(normalizeTextZoom(123), 120);
    assert.equal(normalizeTextZoom('150'), 100);
    assert.equal(normalizeTextZoom(Number.NaN), 100);
    assert.equal(normalizePageBrightness(-1), -1);
    assert.equal(normalizePageBrightness(2), 5);
    assert.equal(normalizePageBrightness(101), 100);
    assert.equal(normalizePageBrightness('x'), -1);
    assert.equal(normalizePageZoom(150), 150);
    assert.equal(normalizePageZoom(140), 0);
  });

  test('the per-site list: parsed safely, edited, reset, serialised', () => {
    const parsed = parseSiteDisplays(
      JSON.stringify({
        'Example.com': { textZoom: 133, zoom: 150, noForceDark: true, extra: 1 },
        'bad host!': { textZoom: 120 },
        'empty.com': {},
        'weird.com': { textZoom: 'big', zoom: 7, noForceDark: 'yes' },
      }),
    );
    assert.deepEqual(parsed, { 'example.com': { textZoom: 130, zoom: 150, noForceDark: true } });
    assert.deepEqual(parseSiteDisplays('not json'), {});
    assert.deepEqual(parseSiteDisplays('[1,2]'), {});

    let map = updateSiteDisplay({}, 'news.example', { textZoom: 150 });
    map = updateSiteDisplay(map, 'news.example', { noForceDark: true });
    assert.deepEqual(map['news.example'], { textZoom: 150, noForceDark: true });
    map = updateSiteDisplay(map, 'news.example', { textZoom: undefined, noForceDark: undefined });
    assert.equal('news.example' in map, false, 'an empty entry goes');
    map = updateSiteDisplay(map, 'a.example', { zoom: 0 });
    assert.equal('a.example' in map, false, 'zoom 0 = default, not stored');
    map = updateSiteDisplay({ 'b.example': { textZoom: 120 } }, 'c.example', { zoom: 125 });
    assert.deepEqual(resetSiteDisplay(map, 'b.example'), { 'c.example': { zoom: 125 } });
    assert.equal(serializeSiteDisplays({ 'z.example': { zoom: 125 }, 'a.example': { textZoom: 90 } }), '{"a.example":{"textZoom":90},"z.example":{"zoom":125}}');
  });

  test('a page gets the defaults with its own site changes', () => {
    const sites = { 'example.com': { textZoom: 150, zoom: 125, noForceDark: true as const } };
    const own = resolvePageDisplay({ ...GLOBALS, forceDark: 'on', textZoom: 110 }, sites, 'https://www.example.com/a', false);
    assert.equal(own.site, 'example.com');
    assert.equal(own.textZoom, 150);
    assert.equal(own.initialScale, 125);
    assert.equal(own.forceDark, false, '"Not on this site"');
    const other = resolvePageDisplay({ ...GLOBALS, forceDark: 'on', textZoom: 110 }, sites, 'https://other.org/', false);
    assert.equal(other.textZoom, 110);
    assert.equal(other.initialScale, 0);
    assert.equal(other.forceDark, true);
    assert.equal(resolvePageDisplay({ ...GLOBALS, forceDark: 'app' }, {}, 'https://x.org/', true).forceDark, true);
    assert.equal(resolvePageDisplay({ ...GLOBALS, forceDark: 'app' }, {}, 'https://x.org/', false).forceDark, false);
    assert.equal(resolvePageDisplay(GLOBALS, sites, 'about:blank', true).site, null);
  });
});

describe('colour filters and night light (#179 / #180)', () => {
  test('nothing to do = no matrix (no layer)', () => {
    assert.equal(displayMatrix('none', false, 50), null);
    assert.equal(displayMatrix('none', true, 0), null);
  });

  test('grayscale makes every colour grey', () => {
    const m = displayMatrix('grayscale', false, 50);
    const [r, g, b] = applyMatrix(m, [255, 0, 0]);
    assert.equal(r, g);
    assert.equal(g, b);
    assert.deepEqual(applyMatrix(m, [255, 255, 255]), [255, 255, 255]);
  });

  test('corrections keep grey grey and change the colours that are confused', () => {
    for (const filter of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      const m = displayMatrix(filter, false, 0);
      assert.ok(m, filter);
      assert.equal(m.length, 20);
      assert.ok(m.every((v) => Number.isFinite(v) && Math.abs(v) <= 10), `${filter} bounded`);
      const grey = applyMatrix(m, [128, 128, 128]);
      assert.ok(grey.every((v) => Math.abs(v - 128) <= 2), `${filter} keeps grey`);
    }
    const red = applyMatrix(displayMatrix('protanopia', false, 0), [200, 40, 40]);
    assert.notDeepEqual(red, [200, 40, 40]);
    const blue = applyMatrix(displayMatrix('tritanopia', false, 0), [40, 40, 200]);
    assert.notDeepEqual(blue, [40, 40, 200]);
  });

  test('night light turns blue down by its strength, after the filter', () => {
    const weak = applyMatrix(displayMatrix('none', true, 20), [255, 255, 255]);
    const strong = applyMatrix(displayMatrix('none', true, 100), [255, 255, 255]);
    assert.equal(weak[0], 255);
    assert.ok(strong[2] < weak[2] && weak[2] < 255);
    assert.deepEqual(nightLightMatrix3(0), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const both = displayMatrix('grayscale', true, 100);
    const [r, , b] = applyMatrix(both, [255, 0, 0]);
    assert.ok(r > b, 'grey first, then warmed');
    assert.equal(filterMatrix3('none').length, 9);
  });
});

describe('page display native calls', () => {
  function driver() {
    const calls: unknown[][] = [];
    return {
      calls,
      api: {
        setPageLayout: async (...args: unknown[]) => (calls.push(['layout', ...args]), true),
        setDisplayFilter: async (...args: unknown[]) => (calls.push(['filter', ...args]), true),
      },
    };
  }
  const DEFAULT = { textReflow: false, initialScale: 0, darkening: false };

  test('defaults on a WebView never touched: no call (today’s WebView)', () => {
    const d = driver();
    const native = createPageDisplayNative(() => d.api);
    assert.equal(native.applyLayout(7, DEFAULT), false);
    assert.equal(native.applyFilter(7, null), false);
    assert.equal(native.applyLayout(null, { ...DEFAULT, textReflow: true }), false);
    assert.deepEqual(d.calls, []);
  });

  test('a change is sent once; going back to the default is sent too; forget starts over', () => {
    const d = driver();
    const native = createPageDisplayNative(() => d.api);
    assert.equal(native.applyLayout(7, { ...DEFAULT, textReflow: true }), true);
    assert.equal(native.applyLayout(7, { ...DEFAULT, textReflow: true }), false);
    assert.equal(native.applyLayout(7, DEFAULT), true);
    assert.equal(native.applyFilter(7, [1, 2]), true);
    assert.equal(native.applyFilter(7, [1, 2]), false);
    assert.equal(native.applyFilter(7, null), true);
    native.forget(7);
    assert.equal(native.applyFilter(7, null), false);
    assert.deepEqual(d.calls, [
      ['layout', 7, true, 0, false],
      ['layout', 7, false, 0, false],
      ['filter', 7, [1, 2]],
      ['filter', 7, null],
    ]);
  });

  test('an older native build without the functions: nothing sent, nothing thrown', () => {
    const native = createPageDisplayNative(() => ({}));
    assert.equal(native.applyLayout(1, { ...DEFAULT, darkening: true }), false);
    assert.equal(createPageDisplayNative(() => null).applyFilter(1, [1]), false);
  });
});

describe('page display CSS (#170 / #272)', () => {
  test('nothing for the defaults except Urdu', () => {
    assert.equal(pageDisplayCss({ fontStyle: 'default', urduNastaliq: false, forceZoom: false }), '');
    const urdu = pageDisplayCss({ fontStyle: 'default', urduNastaliq: true, forceZoom: false });
    assert.ok(urdu.includes('local("Noto Nastaliq Urdu")'));
    assert.ok(urdu.includes('unicode-range: U+0600-06FF'));
    assert.ok(urdu.includes(':lang(ur)'));
    assert.ok(!/url\(/.test(urdu), 'no bundled font address (blocked)');
    assert.ok(!/body\s*,/.test(urdu), 'only Urdu text is touched');
  });

  test('font style keeps icon fonts and code', () => {
    const css = pageDisplayCss({ fontStyle: 'serif', urduNastaliq: true, forceZoom: false });
    assert.ok(css.startsWith('body, body :not('));
    for (const keep of ['i,', 'code', '[class*="icon" i]', '[class*="fa-"]', '[class*="material-icons"]', '[aria-hidden="true"]', 'svg']) {
      assert.ok(css.includes(keep), keep);
    }
    assert.ok(css.includes('font-family: serif !important'));
    // The Urdu rule comes after the font-style rule, so Urdu keeps Nastaliq.
    assert.ok(css.indexOf(':lang(ur)') > css.indexOf('font-family: serif'));
    assert.ok(css.includes('"VidoraX Nastaliq", serif'));
  });
});

/** Just enough DOM for the page-display script. */
function fakePage(viewport: string | null) {
  const nodes: Record<string, unknown>[] = [];
  const head = {
    children: nodes,
    appendChild(node: Record<string, unknown>) {
      if (node.parentNode && node.parentNode !== head) (node.parentNode as { removeChild: (n: unknown) => void }).removeChild(node);
      nodes.push(node);
      node.parentNode = head;
      node.isConnected = true;
      return node;
    },
    removeChild(node: Record<string, unknown>) {
      nodes.splice(nodes.indexOf(node), 1);
      node.parentNode = null;
      node.isConnected = false;
    },
  };
  const meta = viewport == null
    ? null
    : {
        nodeName: 'META',
        attrs: { name: 'viewport', content: viewport } as Record<string, string>,
        getAttribute(name: string) {
          return this.attrs[name] ?? null;
        },
        setAttribute(name: string, value: string) {
          this.attrs[name] = value;
        },
      };
  let observed = 0;
  const document = {
    documentElement: {},
    head,
    getElementById: (id: string) => nodes.find((n) => n.id === id) ?? null,
    createElement: (tag: string) => ({ tagName: tag.toUpperCase(), id: '', textContent: '', parentNode: null, isConnected: false }),
    querySelectorAll: () => (meta ? [meta] : []),
    addEventListener: () => undefined,
  };
  const context: Record<string, unknown> = {
    document,
    JSON,
    parseFloat,
    MutationObserver: function MutationObserver() {
      return { observe: () => (observed += 1) };
    },
  };
  context.window = context;
  vm.createContext(context);
  return { run: (s: string) => vm.runInContext(s, context), nodes, meta, context, observed: () => observed };
}

describe('page display script (node:vm)', () => {
  test('adds one style element and updates it in place', () => {
    const page = fakePage(null);
    page.run(pageDisplayScript({ fontStyle: 'sans', urduNastaliq: false, forceZoom: false }));
    assert.equal(page.nodes.length, 1);
    assert.equal(page.nodes[0].id, 'vidorax-page-display');
    assert.ok(String(page.nodes[0].textContent).includes('sans-serif'));
    page.run(pageDisplayScript({ fontStyle: 'monospace', urduNastaliq: false, forceZoom: false }));
    assert.equal(page.nodes.length, 1);
    assert.ok(String(page.nodes[0].textContent).includes('monospace'));
    page.run(pageDisplayScript({ fontStyle: 'default', urduNastaliq: false, forceZoom: false }));
    assert.equal(page.nodes.length, 0, 'removed when nothing is left to change');
  });

  test('force enable zoom rewrites the viewport tag', () => {
    const page = fakePage('width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
    page.run(pageDisplayScript({ fontStyle: 'default', urduNastaliq: false, forceZoom: true }));
    assert.equal(page.meta!.attrs.content, 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes');
    assert.equal(page.observed(), 1, 'later viewport changes are watched');
    const big = fakePage('width=device-width, maximum-scale=8');
    big.run(pageDisplayScript({ fontStyle: 'default', urduNastaliq: false, forceZoom: true }));
    assert.equal(big.meta!.attrs.content, 'width=device-width, maximum-scale=8, user-scalable=yes');
  });

  test('without force zoom the viewport is left alone, and only one global is added', () => {
    const page = fakePage('width=device-width, user-scalable=no');
    page.run(pageDisplayScript({ fontStyle: 'default', urduNastaliq: true, forceZoom: false }));
    assert.equal(page.meta!.attrs.content, 'width=device-width, user-scalable=no');
    assert.equal(page.observed(), 0);
    const added = Object.keys(page.context).filter((k) => !['document', 'JSON', 'parseFloat', 'MutationObserver', 'window'].includes(k));
    assert.deepEqual(added, ['__vidoraxDisplay']);
  });

  test('a page that breaks the DOM never sees an error', () => {
    const context: Record<string, unknown> = { document: null, JSON };
    context.window = context;
    vm.createContext(context);
    assert.doesNotThrow(() => vm.runInContext(pageDisplayScript({ fontStyle: 'serif', urduNastaliq: true, forceZoom: true }), context));
  });
});
