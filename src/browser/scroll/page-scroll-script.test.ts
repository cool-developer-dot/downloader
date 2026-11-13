import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { NEXT_PAGE_PREFETCH_SCRIPT, preloadAllowed, prefetchHostFor } from '../preload/preload-policy.ts';
import { autoScrollScript, scrollStepScript, scrollToEdgeScript } from './page-scroll-script.ts';

/** A page whose document scrolls: 5 000 px tall, 800 px visible. */
function fakePage(options: { height?: number; nextHref?: string | null; href?: string } = {}) {
  const height = options.height ?? 5000;
  const posted: unknown[] = [];
  const scrollCalls: { top: number; behavior: string }[] = [];
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const frames: ((t: number) => void)[] = [];
  const appended: { rel: string; href: string }[] = [];
  const root = { scrollHeight: height, clientHeight: 800, scrollTop: 0, clientWidth: 400 };
  const window: Record<string, unknown> = {
    innerHeight: 800,
    scrollY: 0,
    ReactNativeWebView: { postMessage: (raw: string) => posted.push(JSON.parse(raw)) },
    scrollTo(options: { top: number; behavior: string }) {
      scrollCalls.push({ top: options.top, behavior: options.behavior });
      const y = Math.max(0, Math.min(height - 800, options.top));
      window.scrollY = y;
      root.scrollTop = y;
    },
    requestAnimationFrame(callback: (t: number) => void) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {
      frames.length = 0;
    },
  };
  const nextEl = options.nextHref ? { getAttribute: () => options.nextHref } : null;
  const document = {
    scrollingElement: root,
    documentElement: root,
    body: {},
    head: { appendChild: (el: { rel: string; href: string }) => appended.push({ rel: el.rel, href: el.href }) },
    querySelectorAll: () => [],
    querySelector: () => nextEl,
    createElement: () => ({ rel: '', href: '' }),
    addEventListener(type: string, listener: (event: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
  };
  const location = { href: options.href ?? 'https://news.example/list?p=1', origin: 'https://news.example' };
  Object.assign(window, { document, location });
  const context = vm.createContext({
    window,
    document,
    location,
    URL,
    JSON,
    Math,
    Date,
    Object,
    getComputedStyle: () => ({ overflowY: 'visible' }),
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
  });
  let now = 0;
  return {
    run: (code: string) => vm.runInContext(code, context),
    /** Runs animation frames 16 ms apart. */
    tick(count: number) {
      for (let i = 0; i < count && frames.length > 0; i += 1) {
        now += 16;
        const callback = frames.shift()!;
        callback(now);
      }
    },
    touch: () => (listeners.touchstart ?? []).forEach((listener) => listener({})),
    window,
    posted,
    scrollCalls,
    appended,
    pendingFrames: () => frames.length,
  };
}

describe('page scroll scripts (#46, #47, #240)', () => {
  test('top and bottom scroll smoothly; a step is a share of the visible height', () => {
    const page = fakePage();
    page.run(scrollToEdgeScript('bottom'));
    assert.deepEqual(page.scrollCalls.at(-1), { top: 5000, behavior: 'smooth' });
    page.run(scrollToEdgeScript('top'));
    assert.deepEqual(page.scrollCalls.at(-1), { top: 0, behavior: 'smooth' });
    page.run(scrollStepScript(1, 0.85));
    assert.deepEqual(page.scrollCalls.at(-1), { top: 680, behavior: 'smooth' });
    page.run(scrollStepScript(-1, 5));
    assert.equal(page.scrollCalls.at(-1)!.top, 680 - 800, 'a step is at most one screen');
  });

  test('the scripts only ever contain numbers and fixed words from the app', () => {
    const script = scrollStepScript(1, Number.NaN);
    assert.match(script, /0\.85/);
    assert.doesNotMatch(autoScrollScript({ type: 'start', pixelsPerSecond: Number.POSITIVE_INFINITY }), /Infinity/);
  });
});

describe('auto scroll in the page (#54)', () => {
  test('scrolls on animation frames at the asked speed, then reports the bottom and stops', () => {
    const page = fakePage({ height: 900 });
    page.run(autoScrollScript({ type: 'start', pixelsPerSecond: 600 }));
    page.tick(5);
    assert.ok((page.window.scrollY as number) > 0);
    page.tick(200);
    assert.equal(page.window.scrollY, 100, 'stopped at the end');
    assert.deepEqual(
      page.posted.map((m) => (m as { type: string; payload: unknown }).payload),
      [{ event: 'bottom' }],
    );
    assert.equal(page.pendingFrames(), 0);
  });

  test('a touch pauses and reports it; pause / speed commands work without a second loop', () => {
    const page = fakePage();
    page.run(autoScrollScript({ type: 'start', pixelsPerSecond: 60 }));
    page.run(autoScrollScript({ type: 'start', pixelsPerSecond: 60 }));
    assert.equal(page.pendingFrames(), 1, 'one loop');
    page.tick(10);
    page.touch();
    assert.deepEqual((page.posted.at(-1) as { payload: unknown }).payload, { event: 'touched' });
    const y = page.window.scrollY;
    page.tick(10);
    assert.equal(page.window.scrollY, y, 'paused');
    page.run(autoScrollScript({ type: 'start', pixelsPerSecond: 60 }));
    page.run(autoScrollScript({ type: 'speed', pixelsPerSecond: 240 }));
    page.tick(10);
    assert.ok((page.window.scrollY as number) > (y as number));
    page.run(autoScrollScript({ type: 'stop' }));
    assert.equal(page.pendingFrames(), 0);
  });
});

describe('page preloading (#55)', () => {
  const wifi = { connected: true, type: 'wifi', expensive: false };
  const cell = { connected: true, type: 'cellular', expensive: true };

  test('Off / Wi-Fi only / Always, never with a saver on or offline', () => {
    assert.equal(preloadAllowed('wifi', wifi, false), true);
    assert.equal(preloadAllowed('wifi', cell, false), false);
    assert.equal(preloadAllowed('wifi', { ...wifi, expensive: true }, false), false, 'a metered Wi-Fi hotspot');
    assert.equal(preloadAllowed('always', cell, false), true);
    assert.equal(preloadAllowed('off', wifi, false), false);
    assert.equal(preloadAllowed('always', wifi, true), false, 'Data saver or Battery saver');
    assert.equal(preloadAllowed('always', { ...wifi, connected: false }, false), false);
  });

  test('the host of a page suggestion; none for searches or other schemes', () => {
    assert.equal(prefetchHostFor({ kind: 'history', url: 'https://en.wikipedia.org/wiki/Lahore' }), 'en.wikipedia.org');
    assert.equal(prefetchHostFor({ kind: 'exact_url', url: 'https://bücher.example/' }), 'xn--bcher-kva.example');
    assert.equal(prefetchHostFor({ kind: 'search', url: 'https://www.google.com/search?q=x' }), null);
    assert.equal(prefetchHostFor({ kind: 'history', url: 'file:///sdcard/x' }), null);
    assert.equal(prefetchHostFor(undefined), null);
  });

  test("a page's same-site next page is prefetched once", () => {
    const page = fakePage({ nextHref: '?p=2' });
    page.run(NEXT_PAGE_PREFETCH_SCRIPT);
    page.run(NEXT_PAGE_PREFETCH_SCRIPT);
    assert.deepEqual(page.appended, [{ rel: 'prefetch', href: 'https://news.example/list?p=2' }]);
  });

  test('another site, another scheme, the same page or no next link: nothing', () => {
    for (const nextHref of ['https://tracker.example/next', 'javascript:alert(1)', '#more', null]) {
      const page = fakePage({ nextHref });
      page.run(NEXT_PAGE_PREFETCH_SCRIPT);
      assert.deepEqual(page.appended, [], String(nextHref));
    }
  });
});
