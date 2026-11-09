import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import {
  FORM_FIELD_SCRIPT,
  insertSnippetScript,
  parseFieldMessage,
  parseSnippets,
  serializeSnippets,
} from '../form-snippets/form-snippets.ts';
import { appForUrl, parseNeverSites, shouldOfferOpenInApp } from '../open-in-app/open-in-app.ts';
import { classifyScan, qrPath, qrRows, QR_MAX_LENGTH } from './qr-code.ts';

describe('B22 #249 QR code', () => {
  test('a square matrix with the three finder patterns; UTF-8 text fits; too long → null', () => {
    const rows = qrRows('https://ur.wikipedia.org/wiki/لاہور')!;
    assert.ok(rows.length >= 21 && (rows.length - 17) % 4 === 0, 'a QR version size');
    assert.ok(rows.every((row) => row.length === rows.length && /^[01]+$/.test(row)));
    const n = rows.length;
    // Finder patterns: a dark 7×7 ring at three corners.
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      assert.equal(rows[r].slice(c, c + 7), '1111111');
      assert.equal(rows[r + 1][c + 1], '0');
      assert.equal(rows[r + 3][c + 3], '1');
    }
    assert.deepEqual(qrRows('https://example.com/'), qrRows('https://example.com/'), 'deterministic');
    assert.equal(qrRows('x'.repeat(QR_MAX_LENGTH + 1)), null);
    assert.equal(qrRows('   '), null);
  });

  test('the SVG path draws exactly the dark modules, inside a 4-module margin', () => {
    assert.equal(qrPath(['0110', '1000']), 'M5 4h2v1h-2zM4 5h1v1h-1z');
  });
});

describe('B22 #30 scanned codes', () => {
  test('an http(s) address asks first; other addresses are text only; anything else is text', () => {
    assert.deepEqual(classifyScan('https://www.bbc.com/urdu'), { kind: 'url', url: 'https://www.bbc.com/urdu', host: 'www.bbc.com' });
    for (const unsafe of ['javascript:alert(1)', 'intent://scan/#Intent;scheme=zxing;end', 'file:///sdcard/a.txt', 'data:text/html,hi', 'myapp://open']) {
      assert.equal(classifyScan(unsafe).kind, 'unsafe', unsafe);
    }
    assert.deepEqual(classifyScan('Wi-Fi password is 1234'), { kind: 'text', text: 'Wi-Fi password is 1234' });
    assert.equal(classifyScan('Note: call me').kind, 'text');
    assert.equal(classifyScan('  ').kind, 'empty');
    assert.equal(classifyScan('https://exa mple.com').kind, 'text');
  });
});

describe('B22 #273 open in app', () => {
  test('only the six apps; the chip once per site per session, never for listed sites or missing apps', () => {
    assert.equal(appForUrl('https://m.youtube.com/watch?v=1'), 'youtube');
    assert.equal(appForUrl('https://maps.google.com/?q=Lahore'), 'maps');
    assert.equal(appForUrl('https://www.google.com/maps/place/x'), 'maps');
    assert.equal(appForUrl('https://www.google.com/search?q=x'), null);
    assert.equal(appForUrl('https://twitter.com/x'), 'x');
    assert.equal(appForUrl('http://instagram.com/'), null, 'https only');
    assert.equal(appForUrl('https://notfacebook.com/'), null);
    const base = { enabled: true, neverSites: [] as string[], shownThisSession: new Set<string>(), isInstalled: () => true };
    assert.equal(shouldOfferOpenInApp({ ...base, url: 'https://www.instagram.com/p/1' }), 'instagram');
    assert.equal(shouldOfferOpenInApp({ ...base, url: 'https://www.instagram.com/p/1', enabled: false }), null);
    assert.equal(shouldOfferOpenInApp({ ...base, url: 'https://www.instagram.com/p/1', isInstalled: () => false }), null);
    assert.equal(shouldOfferOpenInApp({ ...base, url: 'https://www.instagram.com/', neverSites: ['instagram.com'] }), null);
    assert.equal(shouldOfferOpenInApp({ ...base, url: 'https://www.instagram.com/', shownThisSession: new Set(['instagram.com']) }), null);
    assert.deepEqual(parseNeverSites('["WWW.Instagram.com","bad host","instagram.com"]'), ['instagram.com']);
  });
});

/** A small page with fields, focus events and the ReactNativeWebView channel. */
function formPage() {
  const listeners: Record<string, ((e: { target: unknown }) => void)[]> = {};
  const posted: unknown[] = [];
  class HTMLInputElement {
    tagName = 'INPUT';
    disabled = false;
    readOnly = false;
    selectionStart = 0;
    selectionEnd = 0;
    _value = '';
    events: string[] = [];
    type: string;
    attrs: Record<string, string>;
    name: string;
    id: string;
    constructor(type = 'text', attrs: Record<string, string> = {}, name = '', id = '') {
      this.type = type;
      this.attrs = attrs;
      this.name = name;
      this.id = id;
    }
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    }
    get value() {
      return this._value;
    }
    set value(v: string) {
      this._value = v;
    }
    setSelectionRange(a: number, b: number) {
      this.selectionStart = a;
      this.selectionEnd = b;
    }
    dispatchEvent(e: { type: string }) {
      this.events.push(e.type);
      return true;
    }
  }
  class HTMLTextAreaElement extends HTMLInputElement {}
  const document = {
    activeElement: null as unknown,
    addEventListener(type: string, fn: (e: { target: unknown }) => void) {
      (listeners[type] ??= []).push(fn);
    },
  };
  const window: Record<string, unknown> = {
    HTMLInputElement,
    HTMLTextAreaElement,
    ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) },
  };
  const context = vm.createContext({ window, document, setTimeout: (fn: () => void) => fn(), Object, Event: class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    }, JSON, String });
  const focus = (el: unknown) => {
    document.activeElement = el;
    for (const fn of listeners.focusin ?? []) fn({ target: el });
  };
  return { context, posted, focus, HTMLInputElement, document };
}

describe('B22 #274 form snippets', () => {
  test('snippets are cleaned, deduplicated and capped', () => {
    assert.deepEqual(parseSnippets('["  12 Mall Road, Lahore ", "", "12 Mall Road, Lahore", 5]'), ['12 Mall Road, Lahore']);
    assert.equal(parseSnippets(JSON.stringify(Array.from({ length: 30 }, (_, i) => `s${i}`))).length, 20);
    assert.equal(parseSnippets(JSON.stringify(['x'.repeat(900)]))[0].length, 500);
    assert.equal(serializeSnippets(['a', 'a']), '["a"]');
  });

  test('the page reports the field kind only — never password, one-time-code or card fields', () => {
    const page = formPage();
    vm.runInContext(FORM_FIELD_SCRIPT, page.context);
    const I = page.HTMLInputElement;
    page.focus(new I('email', {}, 'email'));
    page.focus(new I('password', {}, 'pass'));
    page.focus(new I('text', { autocomplete: 'one-time-code' }));
    page.focus(new I('text', { autocomplete: 'cc-number' }));
    page.focus(new I('tel', {}, 'cardnumber'));
    page.focus(new I('text', {}, 'cvv'));
    page.focus(new I('text', {}, 'city'));
    assert.deepEqual(page.posted, [
      { type: 'vidorax_form_field', kind: 'email' },
      { type: 'vidorax_form_field', kind: null },
      { type: 'vidorax_form_field', kind: 'text' },
    ]);
    // Nothing but the kind: no value, name or address.
    assert.ok(page.posted.every((m) => Object.keys(m as object).sort().join() === 'kind,type'));
    assert.deepEqual(parseFieldMessage(JSON.stringify({ type: 'vidorax_form_field', kind: 'search' })), { kind: 'search' });
    assert.deepEqual(parseFieldMessage(JSON.stringify({ type: 'vidorax_form_field', kind: 'password' })), { kind: null });
    assert.equal(parseFieldMessage('{"type":"other"}'), undefined);
  });

  test('a tap inserts at the caret with an input event; never into a password field', () => {
    const page = formPage();
    const field = new page.HTMLInputElement('text');
    field._value = 'Dear ,';
    field.selectionStart = field.selectionEnd = 5;
    page.document.activeElement = field;
    vm.runInContext(insertSnippetScript('Ali'), page.context);
    assert.equal(field.value, 'Dear Ali,');
    assert.equal(field.selectionStart, 8);
    assert.deepEqual(field.events, ['input']);
    const password = new page.HTMLInputElement('password');
    page.document.activeElement = password;
    vm.runInContext(insertSnippetScript('secret'), page.context);
    assert.equal(password.value, '');
  });
});
