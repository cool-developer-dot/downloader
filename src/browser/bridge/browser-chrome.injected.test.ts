/**
 * Pull-to-refresh in the injected browser-chrome script: a downward drag at the top of the page refreshes it, but not
 * when the drag scrolls an inner scroller back (a reel viewer, a chat list) or the page keeps the drag for itself.
 * Runs the production script in a VM context against a minimal DOM.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import { buildBrowserChromeInjectedScript } from './browser-chrome.injected';

type FakeEl = {
  nodeType: 1;
  tag: string;
  parentNode: FakeEl | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  style: { overflowY?: string; overscrollBehaviorY?: string };
};

type Listener = { fn: (event: unknown) => void; capture: boolean };

function el(tag: string, parent: FakeEl | null, extra: Partial<FakeEl> = {}): FakeEl {
  return { nodeType: 1, tag, parentNode: parent, scrollTop: 0, scrollHeight: 0, clientHeight: 0, style: {}, ...extra };
}

function createPage() {
  const html = el('html', null, { scrollHeight: 664, clientHeight: 664 });
  const body = el('body', html);
  const posted: string[] = [];
  const listeners = { document: new Map<string, Listener[]>(), window: new Map<string, Listener[]>() };
  const add = (target: 'document' | 'window') => (type: string, fn: (e: unknown) => void, options?: unknown) => {
    const capture = options === true || Boolean((options as { capture?: boolean } | undefined)?.capture);
    const list = listeners[target].get(type) ?? [];
    list.push({ fn, capture });
    listeners[target].set(type, list);
  };
  const document = {
    documentElement: html,
    body,
    scrollingElement: html,
    head: { appendChild() {} },
    title: '',
    createElement: () => ({ setAttribute() {}, textContent: '' }),
    addEventListener: add('document'),
    removeEventListener() {},
  };
  const window: Record<string, unknown> = {
    scrollY: 0,
    pageYOffset: 0,
    ReactNativeWebView: { postMessage: (data: string) => posted.push(JSON.parse(data).type) },
    addEventListener: add('window'),
    removeEventListener() {},
  };
  const context = vm.createContext({
    window,
    document,
    location: { href: 'https://site.example/page' },
    history: { pushState() {}, replaceState() {} },
    getComputedStyle: (node: FakeEl) => node.style,
    setTimeout,
    clearTimeout,
    Date,
    JSON,
  });
  window.window = window;
  vm.runInContext(buildBrowserChromeInjectedScript(), context);

  const pathOf = (target: FakeEl) => {
    const path: unknown[] = [];
    for (let n: FakeEl | null = target; n; n = n.parentNode) path.push(n);
    return [...path, document, window];
  };
  const dispatch = (type: string, target: FakeEl, clientY: number, page?: (event: { defaultPrevented: boolean }) => void) => {
    const event = {
      type,
      target,
      touches: type === 'touchend' ? [] : [{ clientX: 100, clientY }],
      defaultPrevented: false,
      composedPath: () => pathOf(target),
    };
    for (const { fn, capture } of listeners.document.get(type) ?? []) if (capture) fn(event);
    page?.(event);
    for (const { fn, capture } of listeners.window.get(type) ?? []) if (!capture) fn(event);
  };
  /** A downward drag of `distance` px on `target`. */
  const pullDown = (target: FakeEl, distance = 200, page?: (event: { defaultPrevented: boolean }) => void) => {
    dispatch('touchstart', target, 100);
    for (let y = 120; y <= 100 + distance; y += 20) dispatch('touchmove', target, y, page);
    dispatch('touchend', target, 100 + distance);
  };
  const refreshes = () => posted.filter((type) => type === 'pull_to_refresh').length;
  return { html, body, window, pullDown, refreshes };
}

test('a downward drag at the top of a normal page refreshes it', () => {
  const page = createPage();
  const paragraph = el('p', page.body);
  page.pullDown(paragraph);
  assert.equal(page.refreshes(), 1);
});

test('no refresh once the page itself is scrolled down', () => {
  const page = createPage();
  page.window.scrollY = 300;
  page.pullDown(el('p', page.body));
  assert.equal(page.refreshes(), 0);
});

test('a drag inside an inner scroller scrolled away from its top scrolls it back instead of refreshing', () => {
  const page = createPage();
  // A reel viewer: the document never scrolls, its reels live in one scroll-snap container.
  const viewer = el('div', page.body, { scrollHeight: 5972, clientHeight: 664, scrollTop: 664, style: { overflowY: 'auto' } });
  const reel = el('video', el('div', viewer));
  page.pullDown(reel);
  assert.equal(page.refreshes(), 0);

  // Back at its first item, the drag reaches the page again.
  viewer.scrollTop = 0;
  page.pullDown(reel);
  assert.equal(page.refreshes(), 1);
});

test('a scroller or page that opts out with overscroll-behavior-y is never refreshed by a pull', () => {
  const page = createPage();
  const list = el('div', page.body, {
    scrollHeight: 3000,
    clientHeight: 600,
    style: { overflowY: 'scroll', overscrollBehaviorY: 'contain' },
  });
  page.pullDown(el('li', list));
  assert.equal(page.refreshes(), 0);

  const other = createPage();
  other.html.style.overscrollBehaviorY = 'none';
  other.pullDown(el('p', other.body));
  assert.equal(other.refreshes(), 0);
});

test('a drag the page handles itself (preventDefault) is not a pull', () => {
  const page = createPage();
  const canvas = el('canvas', page.body);
  page.pullDown(canvas, 200, (event) => {
    event.defaultPrevented = true;
  });
  assert.equal(page.refreshes(), 0);
});
