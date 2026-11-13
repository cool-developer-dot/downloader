/**
 * The fullscreen observer in the document-start browser-chrome script: what it reports about the fullscreen video, and
 * how it keeps the page's place across fullscreen. Runs the production script in a VM context against a minimal DOM.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import { buildBrowserChromeBeforeContentScript, FULLSCREEN_RESTORE_MS } from './browser-chrome.injected';

type Handler = () => void;

type FakeNode = {
  tagName: string;
  children: FakeNode[];
  shadowRoot?: { children: FakeNode[] } | null;
  videoWidth?: number;
  videoHeight?: number;
  paused?: boolean;
  ended?: boolean;
  rect?: { width: number; height: number };
  attributes?: Record<string, string>;
  contentDocument?: { documentElement: FakeNode } | null;
  listeners: Map<string, Set<Handler>>;
  getBoundingClientRect: () => { width: number; height: number };
  getAttribute: (name: string) => string | null;
  addEventListener: (type: string, fn: Handler) => void;
  removeEventListener: (type: string, fn: Handler) => void;
  fire: (type: string) => void;
};

function node(tagName: string, init: Partial<FakeNode> = {}, children: FakeNode[] = []): FakeNode {
  const listeners = new Map<string, Set<Handler>>();
  const self: FakeNode = {
    tagName: tagName.toUpperCase(),
    children,
    listeners,
    getBoundingClientRect: () => self.rect ?? { width: 0, height: 0 },
    getAttribute: (name) => self.attributes?.[name] ?? null,
    addEventListener: (type, fn) => {
      const set = listeners.get(type) ?? new Set<Handler>();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type, fn) => {
      listeners.get(type)?.delete(fn);
    },
    fire: (type) => {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    ...init,
  };
  return self;
}

const video = (init: Partial<FakeNode> = {}) =>
  node('video', { videoWidth: 0, videoHeight: 0, paused: true, ended: false, ...init });

function createPage() {
  const posted: Record<string, unknown>[] = [];
  const scrolls: [number, number][] = [];
  const documentListeners = new Map<string, Handler[]>();
  const windowListeners = new Map<string, Handler[]>();
  const intervals = new Map<number, Handler>();
  let nextInterval = 1;
  let now = 1_000_000;

  const document = {
    fullscreenElement: null as FakeNode | null,
    documentElement: Object.assign(node('html'), { clientWidth: 411 }),
    addEventListener: (type: string, fn: Handler) => {
      documentListeners.set(type, [...(documentListeners.get(type) ?? []), fn]);
    },
  };
  const window: Record<string, unknown> = {
    scrollX: 0,
    scrollY: 0,
    innerWidth: 411,
    ReactNativeWebView: {
      postMessage: (data: string) => {
        const message = JSON.parse(data);
        if (message.type === 'fullscreen') posted.push(message.payload);
      },
    },
    scrollTo: (x: number, y: number) => {
      scrolls.push([x, y]);
      window.scrollX = x;
      window.scrollY = y;
    },
    addEventListener: (type: string, fn: Handler) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]);
    },
  };
  window.window = window;
  const context = vm.createContext({
    window,
    document,
    Date: { now: () => now },
    setInterval: (fn: Handler) => {
      const id = nextInterval++;
      intervals.set(id, fn);
      return id;
    },
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
  });
  const script = buildBrowserChromeBeforeContentScript();
  vm.runInContext(script, context);

  const fireDocument = (type: string) => documentListeners.get(type)?.forEach((fn) => fn());
  const fireWindow = (type: string) => windowListeners.get(type)?.forEach((fn) => fn());
  return {
    window,
    document,
    posted,
    scrolls,
    run: () => vm.runInContext(script, context),
    enter(element: FakeNode) {
      document.fullscreenElement = element;
      fireDocument('fullscreenchange');
      fireDocument('webkitfullscreenchange');
    },
    exit() {
      document.fullscreenElement = null;
      fireDocument('fullscreenchange');
      fireDocument('webkitfullscreenchange');
    },
    scrollTo(y: number) {
      window.scrollY = y;
      fireWindow('scroll');
    },
    touch: () => fireWindow('touchstart'),
    /** Advances the clock and runs the restore timer once per 100 ms. */
    tick(ms: number) {
      for (let elapsed = 0; elapsed < ms; elapsed += 100) {
        now += 100;
        [...intervals.values()].forEach((fn) => fn());
      }
    },
    timers: () => intervals.size,
  };
}

test('fullscreen on a video reports its size once, leaving reports inactive once', () => {
  const page = createPage();
  const element = video({ videoWidth: 1280, videoHeight: 720 });
  page.enter(element);
  page.exit();
  assert.deepEqual(page.posted, [{ active: true, width: 1280, height: 720 }, { active: false }]);
});

test('a container reports the playing video first, else the largest one', () => {
  const page = createPage();
  const big = video({ videoWidth: 1920, videoHeight: 1080, rect: { width: 400, height: 225 } });
  const playing = video({ videoWidth: 720, videoHeight: 1280, paused: false, rect: { width: 100, height: 178 } });
  page.enter(node('div', {}, [big, node('div', {}, [playing])]));
  assert.deepEqual(page.posted.at(-1), { active: true, width: 720, height: 1280 });
  page.exit();

  const small = video({ videoWidth: 640, videoHeight: 360, rect: { width: 100, height: 56 } });
  page.enter(node('div', {}, [small, big]));
  assert.deepEqual(page.posted.at(-1), { active: true, width: 1920, height: 1080 });
});

test('videos in open shadow roots and same-origin frames are found', () => {
  const page = createPage();
  const shadowVideo = video({ videoWidth: 1080, videoHeight: 1920 });
  page.enter(node('mux-player', { shadowRoot: { children: [node('div', {}, [shadowVideo])] } }));
  assert.deepEqual(page.posted.at(-1), { active: true, width: 1080, height: 1920 });
  page.exit();

  const frameVideo = video({ videoWidth: 854, videoHeight: 480 });
  page.enter(node('iframe', { contentDocument: { documentElement: node('html', {}, [frameVideo]) } }));
  assert.deepEqual(page.posted.at(-1), { active: true, width: 854, height: 480 });
});

test('a cross-origin frame reports its numeric width/height attributes, nothing for percentages', () => {
  const page = createPage();
  page.enter(node('iframe', { contentDocument: null, attributes: { width: '560', height: '315' } }));
  assert.deepEqual(page.posted.at(-1), { active: true, width: 560, height: 315 });
  page.exit();

  page.enter(node('iframe', { contentDocument: null, attributes: { width: '100%', height: '100%' } }));
  assert.deepEqual(page.posted.at(-1), { active: true });
});

test('a video without metadata reports no size, then its size when it loads; nothing after leaving', () => {
  const page = createPage();
  const element = video();
  page.enter(element);
  assert.deepEqual(page.posted, [{ active: true }]);
  element.videoWidth = 1080;
  element.videoHeight = 1920;
  element.fire('loadedmetadata');
  element.fire('resize');
  assert.deepEqual(page.posted, [{ active: true }, { active: true, width: 1080, height: 1920 }]);
  page.exit();
  element.videoWidth = 1920;
  element.videoHeight = 1080;
  element.fire('resize');
  assert.deepEqual(page.posted.at(-1), { active: false });
  assert.equal(page.posted.length, 3);
});

test('the page is scrolled back to its place once the viewport is portrait again', () => {
  const page = createPage();
  page.scrollTo(900);
  page.enter(video({ videoWidth: 1280, videoHeight: 720 }));
  // react-native-webview's video view resets the page while fullscreen; the phone turns.
  page.scrollTo(0);
  page.document.documentElement.clientWidth = 914;
  page.exit();
  page.tick(300);
  assert.deepEqual(page.scrolls, [], 'no scroll while still landscape');
  page.document.documentElement.clientWidth = 411;
  page.window.innerWidth = 615; // a page without a viewport meta, zoomed out: innerWidth follows the zoom
  page.tick(100);
  assert.deepEqual(page.scrolls, [[0, 900]]);
  // A late reset inside the window is undone again; after the window nothing runs.
  page.window.scrollY = 0;
  page.tick(100);
  assert.deepEqual(page.scrolls, [[0, 900], [0, 900]]);
  page.tick(FULLSCREEN_RESTORE_MS);
  assert.equal(page.timers(), 0);
});

test('a scroll position of 0 at entry falls back to the last one seen; a touch ends the restore', () => {
  const page = createPage();
  page.scrollTo(450);
  page.window.scrollY = 0; // reset before the page's fullscreenchange
  page.enter(video({ videoWidth: 1280, videoHeight: 720 }));
  page.exit();
  page.tick(100);
  assert.deepEqual(page.scrolls.at(-1), [0, 450]);

  page.window.scrollY = 0;
  page.touch();
  page.tick(500);
  assert.equal(page.scrolls.length, 1);
  assert.equal(page.timers(), 0);
});

test('a page at the top is left alone, and the script installs once per document', () => {
  const page = createPage();
  page.run();
  page.enter(video({ videoWidth: 1280, videoHeight: 720 }));
  page.exit();
  page.tick(500);
  assert.deepEqual(page.scrolls, []);
  assert.equal(page.posted.length, 2);
});
