import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import {
  appendConsole,
  CONSOLE_CAPTURE_SCRIPT,
  CONSOLE_LIMIT,
  DEFAULT_TAB_DEVTOOLS,
  devtoolsDocumentStartScript,
  devtoolsUserAgent,
  emulatedWidth,
  matchesUrl,
  matchPatternSource,
  parseDevtoolsMessage,
  parseUserScriptHeader,
  UA_IPAD,
  UA_IPHONE,
  userScriptsAtEnd,
  userScriptSnippet,
  viewportScript,
  type UserScript,
} from './devtools-core.ts';
import { evalCommand, NETWORK_COMMAND, SOURCE_COMMAND, STORAGE_READ_COMMAND, inspectCommand, storageDeleteCommand } from './devtools-commands.ts';

const script = (over: Partial<UserScript> = {}): UserScript => ({
  id: 's1',
  name: 'Recolour',
  code: 'document.body.style.background = "pink";',
  matches: ['*://*.example.com/*'],
  runAt: 'start',
  enabled: true,
  allowIncognito: false,
  ...over,
});

describe('B19: tools off means nothing at all is injected', () => {
  test('no console capture, no viewport, no user scripts while off — whatever is set up', () => {
    const tab = { uaMode: 'iphone' as const, customUa: '', device: { presetId: '768', rotated: false } };
    const scripts = [script(), script({ id: 's2', runAt: 'end' }), script({ id: 's3', allowIncognito: true })];
    assert.equal(devtoolsDocumentStartScript({ enabled: false, tab, scripts, incognito: false }), '');
    assert.equal(devtoolsDocumentStartScript({ enabled: false, tab, scripts, incognito: true }), '');
    assert.deepEqual(userScriptsAtEnd({ enabled: false, scripts, incognito: false }), []);
    assert.equal(devtoolsUserAgent(tab, false), undefined, 'and the user agent is the tab’s own');
  });

  test('BrowserWebView injects devtools code only through the gated builders', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/browser/components/BrowserContainer/BrowserWebView.tsx'), 'utf8');
    // The page scripts themselves are never referenced directly there.
    for (const name of ['CONSOLE_CAPTURE_SCRIPT', 'userScriptSnippet', 'viewportScript']) assert.ok(!source.includes(name), name);
    assert.ok(source.includes('devtoolsDocumentStartScript({ enabled: devtoolsOn'));
    assert.ok(source.includes('userScriptsAtEnd({ enabled: devtoolsOn'));
    assert.ok(source.includes('devtoolsUserAgent(tabDevtools, devtoolsOn)'));
    // The panel's commands go through runInPage, which refuses while off.
    const service = fs.readFileSync(path.join(process.cwd(), 'src/browser/devtools/devtools.service.ts'), 'utf8');
    assert.match(service, /export function runInPage\(tabId: string, script: string\): boolean \{\s+if \(!isDevtoolsEnabled\(\)\) return false;/);
  });

  test('on: console capture first, the emulated width, and start-time scripts for the tab', () => {
    const tab = { ...DEFAULT_TAB_DEVTOOLS, device: { presetId: '412', rotated: true } };
    const out = devtoolsDocumentStartScript({ enabled: true, tab, scripts: [script(), script({ id: 'e', runAt: 'end' })], incognito: false });
    assert.ok(out.startsWith(CONSOLE_CAPTURE_SCRIPT));
    assert.ok(out.includes("'width=915'"), 'rotated 412 × 915');
    assert.equal((out.match(/new Function/g) ?? []).length, 1, 'only the start-time script');
    assert.equal(devtoolsDocumentStartScript({ enabled: true, tab: null, scripts: [script()], incognito: true }).includes('new Function'), false, 'never in incognito unless allowed');
    assert.equal(devtoolsDocumentStartScript({ enabled: true, tab: null, scripts: [script({ allowIncognito: true })], incognito: true }).includes('new Function'), true);
  });
});

describe('B19 #226 / #227 user agent and device', () => {
  test('modes, custom (one line), device presets win, rotate and reset', () => {
    assert.equal(devtoolsUserAgent({ ...DEFAULT_TAB_DEVTOOLS, uaMode: 'iphone' }, true), UA_IPHONE);
    assert.equal(devtoolsUserAgent({ ...DEFAULT_TAB_DEVTOOLS, uaMode: 'ipad' }, true), UA_IPAD);
    assert.equal(devtoolsUserAgent({ ...DEFAULT_TAB_DEVTOOLS, uaMode: 'desktop' }, true), undefined, 'desktop = the tab’s desktop mode');
    assert.equal(devtoolsUserAgent({ ...DEFAULT_TAB_DEVTOOLS, uaMode: 'custom', customUa: ' My UA\nInjected ' }, true), 'My UA Injected');
    assert.equal(devtoolsUserAgent({ ...DEFAULT_TAB_DEVTOOLS, uaMode: 'custom', customUa: '   ' }, true), undefined);
    assert.equal(devtoolsUserAgent({ uaMode: 'iphone', customUa: '', device: { presetId: '768', rotated: false } }, true), UA_IPAD);
    assert.equal(emulatedWidth({ presetId: '1440', rotated: false }), 1440);
    assert.equal(emulatedWidth({ presetId: '1440', rotated: true }), 900);
    assert.equal(emulatedWidth(null), null);
    assert.equal(emulatedWidth({ presetId: 'nope', rotated: false }), null);
  });

  test('the viewport script sets one viewport tag', () => {
    const tags: { name: string; content: string }[] = [];
    const meta = (name: string, content: string) => ({
      getAttribute: (k: string) => (k === 'content' ? content : name),
      setAttribute(k: string, v: string) {
        if (k === 'content') content = v;
        else name = v;
        this._sync();
      },
      parentNode: { removeChild: () => undefined },
      _sync() {
        tags[0] = { name, content };
      },
    });
    const existing = meta('viewport', 'width=device-width, initial-scale=1');
    const document = {
      documentElement: {},
      head: { appendChild: () => undefined },
      querySelectorAll: () => [existing],
      createElement: () => meta('', ''),
      addEventListener: () => undefined,
    };
    vm.runInContext(viewportScript(768), vm.createContext({ document }));
    assert.equal(tags[0].content, 'width=768');
  });
});

describe('B19 #199 user scripts', () => {
  test('match patterns: Chrome style, host wildcards, <all_urls>, @include globs; invalid ones refused', () => {
    assert.ok(matchesUrl(['*://*.example.com/*'], 'https://www.example.com/a'));
    assert.ok(matchesUrl(['*://*.example.com/*'], 'http://example.com/'));
    assert.ok(!matchesUrl(['*://*.example.com/*'], 'https://notexample.com/'));
    assert.ok(!matchesUrl(['*://*.example.com/*'], 'https://example.com.evil.test/'));
    assert.ok(matchesUrl(['https://news.example.org/2026/*'], 'https://news.example.org/2026/11/x'));
    assert.ok(!matchesUrl(['https://news.example.org/2026/*'], 'http://news.example.org/2026/11/x'));
    assert.ok(matchesUrl(['<all_urls>'], 'https://anything.test/'));
    assert.ok(!matchesUrl(['<all_urls>'], 'file:///sdcard/a.html'));
    assert.ok(matchesUrl(['https://*.wikipedia.org/wiki/*'], 'https://ur.wikipedia.org/wiki/لاہور'));
    assert.ok(matchesUrl(['http*://example.net/*'], 'https://example.net/x'), '@include glob');
    assert.equal(matchPatternSource('example.com'), null);
    assert.equal(matchPatternSource(''), null);
  });

  test('a .user.js header is read as text; @require / @resource are counted, never fetched', () => {
    const parsed = parseUserScriptHeader(`// ==UserScript==
// @name         Dark Example
// @match        *://*.example.com/*
// @include      https://other.test/*
// @match        not a pattern
// @run-at       document-start
// @require      https://cdn.example/lib.js
// @resource     css https://cdn.example/x.css
// ==/UserScript==
document.body.style.background = 'black';`);
    assert.deepEqual(parsed, { name: 'Dark Example', matches: ['*://*.example.com/*', 'https://other.test/*'], runAt: 'start', ignored: 2 });
    assert.deepEqual(parseUserScriptHeader('no header'), { name: '', matches: [], runAt: 'end', ignored: 0 });
  });

  test('isolated: a broken script never stops the rest of the injected code; matching is decided in the page', () => {
    const posted: { kind: string; id: string; state: string }[] = [];
    const window: Record<string, unknown> = { ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) } };
    // The sandbox's own Function / RegExp / JSON, as in a page.
    const context = vm.createContext({ window, location: { href: 'https://www.example.com/page' } });
    window.marker = 0;
    const broken = userScriptSnippet(script({ id: 'bad', code: 'this is not javascript (' }));
    const good = userScriptSnippet(script({ id: 'good', code: 'window.marker = 42;' }));
    const elsewhere = userScriptSnippet(script({ id: 'other', code: 'window.marker = -1;', matches: ['*://other.test/*'] }));
    vm.runInContext(`${broken}\n${good}\n${elsewhere}\nwindow.after = 'bundle kept running';`, context);
    assert.equal(window.marker, 42);
    assert.equal(window.after, 'bundle kept running');
    assert.deepEqual(posted.map((p) => [p.id, p.state]), [['bad', 'failed'], ['good', 'ran']]);
  });
});

describe('B19 page messages (bounded; a page can forge them, so they are only shown)', () => {
  test('cleaned and bounded; anything else ignored', () => {
    const msg = parseDevtoolsMessage(JSON.stringify({ type: 'vidorax_devtools', kind: 'console', entries: [{ level: 'warn', text: 'x'.repeat(5000), at: 5 }, { level: 'evil', text: 1 }] }));
    assert.equal(msg?.kind, 'console');
    if (msg?.kind === 'console') {
      assert.equal(msg.entries[0].text.length, 2000);
      assert.equal(msg.entries[1].level, 'log');
      assert.equal(msg.entries[1].text, '');
    }
    assert.equal(parseDevtoolsMessage('{"type":"other"}'), undefined);
    assert.equal(parseDevtoolsMessage(`{"type":"vidorax_devtools","kind":"source","text":"${'a'.repeat(400_000)}"}`), undefined);
    assert.equal(parseDevtoolsMessage('{"type":"vidorax_devtools","kind":"unknown"}'), undefined);
  });

  test('the console keeps the newest 500 per tab', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ level: 'log' as const, text: String(i), at: i }));
    const kept = appendConsole([], many);
    assert.equal(kept.length, CONSOLE_LIMIT);
    assert.equal(kept[0].text, '100');
  });
});

describe('B19 page scripts (node:vm)', () => {
  test('console capture reports messages and errors from page start, batched, and keeps the original console', async () => {
    const posted: { entries: { level: string; text: string }[] }[] = [];
    const listeners: Record<string, (e: unknown) => void> = {};
    const originals: string[] = [];
    const consoleObj = { log: (...a: unknown[]) => originals.push(a.join(' ')), info() {}, warn() {}, error() {}, debug() {} };
    const window = {
      ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) },
      addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    };
    const timers: (() => void)[] = [];
    const context = vm.createContext({ window, console: consoleObj, setTimeout: (fn: () => void) => timers.push(fn), Date, JSON, String, Error });
    vm.runInContext(CONSOLE_CAPTURE_SCRIPT, context);
    vm.runInContext(CONSOLE_CAPTURE_SCRIPT, context);
    vm.runInContext(`console.log('hello', { a: 1 }); console.warn('careful');`, context);
    listeners.error({ message: 'Boom', filename: 'app.js', lineno: 3 });
    timers.forEach((fn) => fn());
    assert.deepEqual(originals, ['hello [object Object]'], 'the page’s console still works (installed once)');
    assert.deepEqual(posted[0].entries.map((e) => [e.level, e.text]), [['log', 'hello {"a":1}'], ['warn', 'careful'], ['error', 'Boom (app.js:3)']]);
  });

  test('the user’s console line runs in the page and its result (or error) comes back', () => {
    const posted: { ok: boolean; text: string }[] = [];
    const window = { ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) }, answer: 41 };
    const context = vm.createContext({ window, JSON, String, Object });
    (context as { eval: unknown }).eval = (code: string) => vm.runInContext(code, context);
    vm.runInContext(evalCommand('window.answer + 1'), context);
    vm.runInContext(evalCommand('throw new Error("nope")'), context);
    assert.equal(posted[0].ok, true);
    assert.equal(posted[0].text, '42');
    assert.equal(posted[1].ok, false);
    assert.match(posted[1].text, /nope/);
  });

  test('every command compiles', () => {
    for (const code of [NETWORK_COMMAND, SOURCE_COMMAND, STORAGE_READ_COMMAND, inspectCommand('start'), inspectCommand('parent'), inspectCommand('stop'), storageDeleteCommand('local', 'k'), storageDeleteCommand(null, null), evalCommand('1+1')]) {
      assert.doesNotThrow(() => new vm.Script(code));
    }
  });
});
