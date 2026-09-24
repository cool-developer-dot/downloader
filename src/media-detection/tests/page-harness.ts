/**
 * Runs the REAL injected page observer (`buildMediaDetectionInjectedScript`) inside `node:vm`
 * against a small DOM that supports exactly what the observer uses: element queries, attribute
 * and property `src`, MutationObserver (childList / subtree / attributeFilter), PerformanceObserver
 * ('resource'), IntersectionObserver, capture-phase media events on `document`, `history`
 * pushState/replaceState/popstate, and `window.ReactNativeWebView.postMessage`.
 *
 * Timers run on a manual clock so a test can say "advance 300 ms" instead of sleeping. Everything the
 * script posts is captured verbatim, which is exactly what `BrowserWebView.onMessage` hands the engine —
 * so a test can drive the whole WebView → candidate → verification → offer path with no device.
 *
 * Test-only. Never imported by app code.
 */
import vm from 'node:vm';

import { buildMediaDetectionInjectedScript, buildMediaDetectionRescanScript } from '../observers/injected-script';

export type PostedMessage = { type: string; payload: Record<string, unknown>; raw: string };

type Listener = (event: unknown) => void;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ElementInit {
  tag: string;
  attrs?: Record<string, string>;
  props?: Record<string, unknown>;
  rect?: Rect;
  style?: Record<string, string>;
  children?: ElementInit[];
}

let clockRef: ManualClock | null = null;

class ManualClock {
  now = 1_700_000_000_000;
  private nextId = 1;
  private timers: { id: number; at: number; fn: () => void }[] = [];

  setTimeout = (fn: () => void, delay?: number): number => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.now + Math.max(0, Number(delay) || 0), fn });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.timers = this.timers.filter((t) => t.id !== id);
  };

  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= until)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = Math.max(this.now, due.at);
      due.fn();
    }
    this.now = Math.max(this.now, until);
  }
}

/** Mutation records the observer batches until the next microtask-equivalent delivery. */
type MutationKind = { type: 'childList' | 'attributes'; target: FakeElement };

export class FakeElement {
  tagName: string;
  readonly attributes = new Map<string, string>();
  readonly styles: Record<string, string>;
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  ownerDocument: FakeDocument | null = null;
  rect: Rect;
  /** Media props the observer reads directly. */
  paused: boolean | null = true;
  ended = false;
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  muted = false;
  duration = Number.NaN;
  currentTime = 0;
  currentSrc = '';
  innerText = '';
  mediaKeys: unknown = null;
  /** Same-origin iframe document, when the test provides one. */
  contentDocument: FakeDocument | null = null;
  contentWindow: { document: FakeDocument } | null = null;
  /** Cross-origin iframes throw on contentDocument access, like a real browser. */
  crossOrigin = false;

  constructor(init: ElementInit, doc: FakeDocument | null) {
    this.tagName = init.tag.toUpperCase();
    this.ownerDocument = doc;
    this.rect = init.rect ?? { left: 0, top: 0, width: 0, height: 0 };
    this.styles = { ...(init.style ?? {}) };
    for (const [k, v] of Object.entries(init.attrs ?? {})) this.attributes.set(k.toLowerCase(), v);
    Object.assign(this, init.props ?? {});
    for (const childInit of init.children ?? []) this.appendChild(new FakeElement(childInit, doc));
  }

  get src(): string {
    return this.attributes.get('src') ?? '';
  }

  /** Setting `.src` reflects to the attribute, exactly as the DOM does — MutationObserver must see it. */
  set src(value: string) {
    this.setAttribute('src', value);
  }

  get allowFullscreen(): boolean {
    return this.attributes.has('allowfullscreen');
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name.toLowerCase(), String(value));
    this.ownerDocument?.recordMutation({ type: 'attributes', target: this });
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name.toLowerCase());
    this.ownerDocument?.recordMutation({ type: 'attributes', target: this });
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    child.adoptDocument(this.ownerDocument);
    this.children.push(child);
    this.ownerDocument?.recordMutation({ type: 'childList', target: this });
    return child;
  }

  removeChild(child: FakeElement): void {
    const index = this.children.indexOf(child);
    if (index < 0) return;
    this.children.splice(index, 1);
    child.parentElement = null;
    this.ownerDocument?.recordMutation({ type: 'childList', target: this });
  }

  private adoptDocument(doc: FakeDocument | null): void {
    this.ownerDocument = doc;
    for (const child of this.children) child.adoptDocument(doc);
  }

  get textContent(): string {
    return (this as unknown as { _text?: string })._text ?? '';
  }

  getBoundingClientRect(): Rect & { right: number; bottom: number } {
    return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height };
  }

  descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  /** Supports only the selector shapes the observer actually uses. */
  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter((el) => matchesSelector(el, selector));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function matchesSelector(el: FakeElement, selector: string): boolean {
  return selector
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => matchesSingle(el, part));
}

function matchesSingle(el: FakeElement, selector: string): boolean {
  const tagMatch = /^([a-z0-9]+)/i.exec(selector);
  if (tagMatch && el.tagName !== tagMatch[1]!.toUpperCase()) return false;
  for (const attr of selector.matchAll(/\[([a-zA-Z0-9_:-]+)(?:([~^*$]?=)"([^"]*)")?\]/g)) {
    const [, name, op, value] = attr;
    const actual = el.getAttribute(name!);
    if (actual == null) return false;
    if (!op) continue;
    if (op === '=' && actual !== value) return false;
    if (op === '^=' && !actual.startsWith(value!)) return false;
    if (op === '*=' && !actual.includes(value!)) return false;
  }
  return true;
}

export class FakeDocument {
  documentElement: FakeElement;
  head: FakeElement;
  body: FakeElement;
  title = 'Test page';
  URL: string;
  private readonly captureListeners = new Map<string, Listener[]>();
  private readonly mutationObservers: { observer: FakeMutationObserver; root: FakeElement }[] = [];

  constructor(url: string) {
    this.URL = url;
    this.documentElement = new FakeElement({ tag: 'html' }, this);
    this.head = this.documentElement.appendChild(new FakeElement({ tag: 'head' }, this));
    this.body = this.documentElement.appendChild(new FakeElement({ tag: 'body' }, this));
  }

  createElement(tag: string): FakeElement {
    const el = new FakeElement({ tag }, this);
    // `style.textContent = ...` is used by the app-promotion suppressor.
    (el as unknown as { textContent: string }).textContent = '';
    return el;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  querySelector(selector: string): FakeElement | null {
    return this.documentElement.querySelector(selector);
  }

  getElementsByTagName(tag: string): FakeElement[] {
    return this.documentElement.querySelectorAll(tag);
  }

  addEventListener(type: string, listener: Listener, capture?: boolean | { capture?: boolean }): void {
    if (!capture) return; // the observer only registers capture listeners on document
    const list = this.captureListeners.get(type) ?? [];
    list.push(listener);
    this.captureListeners.set(type, list);
  }

  removeEventListener(type: string, listener: Listener): void {
    const list = this.captureListeners.get(type);
    if (!list) return;
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }

  /** Media events do not bubble, but a capture listener on `document` still sees them. */
  dispatchMediaEvent(target: FakeElement, type: string): void {
    for (const listener of (this.captureListeners.get(type) ?? []).slice()) {
      listener({ type, target });
    }
  }

  registerMutationObserver(observer: FakeMutationObserver, root: FakeElement): void {
    this.mutationObservers.push({ observer, root });
  }

  unregisterMutationObserver(observer: FakeMutationObserver): void {
    for (let i = this.mutationObservers.length - 1; i >= 0; i -= 1) {
      if (this.mutationObservers[i]!.observer === observer) this.mutationObservers.splice(i, 1);
    }
  }

  recordMutation(record: MutationKind): void {
    for (const { observer, root } of this.mutationObservers.slice()) {
      if (observer.matches(record, root)) observer.enqueue(record);
    }
  }
}

class FakeMutationObserver {
  private options: { childList?: boolean; subtree?: boolean; attributes?: boolean; attributeFilter?: string[] } = {};
  private root: FakeElement | null = null;
  private doc: FakeDocument | null = null;
  private queued: MutationKind[] = [];
  private readonly callback: (records: MutationKind[]) => void;

  constructor(callback: (records: MutationKind[]) => void) {
    this.callback = callback;
  }

  observe(root: FakeElement, options: Record<string, unknown>): void {
    this.root = root;
    this.doc = root.ownerDocument;
    this.options = options as typeof this.options;
    this.doc?.registerMutationObserver(this, root);
  }

  disconnect(): void {
    this.doc?.unregisterMutationObserver(this);
    this.root = null;
    this.queued = [];
  }

  matches(record: MutationKind, root: FakeElement): boolean {
    if (record.type === 'childList' && !this.options.childList) return false;
    if (record.type === 'attributes' && !this.options.attributes) return false;
    if (record.target !== root && !this.options.subtree) return false;
    if (record.target !== root && !root.descendants().includes(record.target)) return false;
    return true;
  }

  enqueue(record: MutationKind): void {
    const first = this.queued.length === 0;
    this.queued.push(record);
    // Real delivery is a microtask; the manual clock's 0 ms timer is the same ordering guarantee here.
    if (first) clockRef?.setTimeout(() => this.deliver(), 0);
  }

  private deliver(): void {
    if (!this.queued.length) return;
    const records = this.queued;
    this.queued = [];
    this.callback(records);
  }
}

export interface HarnessOptions {
  url: string;
  title?: string;
  /** Viewport used by `viewportCenterDistance` / `isElementDisplayed`. */
  viewport?: { width: number; height: number };
}

export class PageHarness {
  readonly clock = new ManualClock();
  readonly document: FakeDocument;
  readonly messages: PostedMessage[] = [];
  /** Objects handed to `URL.createObjectURL` — a Blob or a MediaSource, as the page passed them. */
  readonly objectUrlSources: { type?: string }[] = [];
  /** Entries the page's PerformanceObserver will be handed. */
  private perfObserverCallbacks: ((entries: { name: string; initiatorType: string }[]) => void)[] = [];
  private intersectionCallbacks: ((entries: { target: FakeElement; intersectionRatio: number }[]) => void)[] = [];
  private windowListeners = new Map<string, Listener[]>();
  private readonly context: vm.Context;
  private location: { href: string };

  constructor(options: HarnessOptions) {
    clockRef = this.clock;
    this.document = new FakeDocument(options.url);
    if (options.title) this.document.title = options.title;
    this.location = { href: options.url };

    const harness = this;
    const viewport = options.viewport ?? { width: 390, height: 844 };

    const windowObject: Record<string, unknown> = {
      ReactNativeWebView: {
        postMessage: (raw: string) => {
          const parsed = JSON.parse(raw) as { type: string; payload: Record<string, unknown> };
          harness.messages.push({ type: parsed.type, payload: parsed.payload, raw });
        },
      },
      innerWidth: viewport.width,
      innerHeight: viewport.height,
      getComputedStyle: (el: FakeElement) => ({
        display: el.styles.display ?? 'block',
        visibility: el.styles.visibility ?? 'visible',
        opacity: el.styles.opacity ?? '1',
      }),
      addEventListener: (type: string, listener: Listener) => {
        const list = harness.windowListeners.get(type) ?? [];
        list.push(listener);
        harness.windowListeners.set(type, list);
      },
      removeEventListener: (type: string, listener: Listener) => {
        const list = harness.windowListeners.get(type);
        if (!list) return;
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      },
      navigator: {
        userAgent: 'VidoraX-Test',
        // The real one returns a promise for MediaKeySystemAccess; the script only observes the call.
        requestMediaKeySystemAccess: () => Promise.resolve({}),
      },
      MutationObserver: FakeMutationObserver,
      // Enough of MediaSource for a page to build an MSE player.
      MediaSource: class {
        readyState = 'closed';
        addEventListener(): void {}
        addSourceBuffer(): { appendBuffer: () => void } {
          return { appendBuffer: () => undefined };
        }
      },
      PerformanceObserver: class {
        cb: (list: { getEntries: () => { name: string; initiatorType: string }[] }) => void;
        constructor(cb: (list: { getEntries: () => { name: string; initiatorType: string }[] }) => void) {
          this.cb = cb;
        }
        observe(): void {
          harness.perfObserverCallbacks.push((entries) => this.cb({ getEntries: () => entries }));
        }
        disconnect(): void {
          harness.perfObserverCallbacks = [];
        }
      },
      IntersectionObserver: class {
        cb: (entries: { target: FakeElement; intersectionRatio: number }[]) => void;
        constructor(cb: (entries: { target: FakeElement; intersectionRatio: number }[]) => void) {
          this.cb = cb;
          harness.intersectionCallbacks.push((entries) => this.cb(entries));
        }
        observe(): void {}
        disconnect(): void {}
      },
      performance: {
        getEntriesByType: () => [] as { name: string; initiatorType: string }[],
      },
      // `URL` is a host global, not an ECMAScript intrinsic, so a fresh vm context lacks it —
      // without this every `safeUrl()` throws and no candidate is ever produced.
      // A `createObjectURL` that hands out real `blob:` strings, so the script's MSE hook is exercised.
      URL: Object.assign(
        function VidoraTestURL(this: unknown, ...args: ConstructorParameters<typeof URL>) {
          return new URL(...args);
        } as unknown as typeof URL,
        {
          createObjectURL: (source: { type?: string }) => {
            harness.objectUrlSources.push(source);
            return `blob:https://test.invalid/${harness.objectUrlSources.length}-0000-0000`;
          },
          revokeObjectURL: () => undefined,
        },
      ),
      console,
      setTimeout: this.clock.setTimeout,
      clearTimeout: this.clock.clearTimeout,
      history: {
        pushState: (..._args: unknown[]) => undefined,
        replaceState: (..._args: unknown[]) => undefined,
      },
      location: this.location,
      document: this.document,
      fetch: undefined,
      XMLHttpRequest: function XMLHttpRequestStub(this: Record<string, unknown>) {} as unknown,
    };
    (windowObject.XMLHttpRequest as { prototype: Record<string, unknown> }).prototype = {
      open() {},
      send() {},
      addEventListener() {},
    };
    windowObject.window = windowObject;
    windowObject.self = windowObject;
    windowObject.globalThis = windowObject;

    this.context = vm.createContext(windowObject);
  }

  /** Runs the production injected script, as `injectedJavaScript` does after document load. */
  inject(): void {
    vm.runInContext(buildMediaDetectionInjectedScript(), this.context, { timeout: 5_000 });
  }

  /** Runs the script again (a second WebView injection) — the re-entry guard must hold. */
  injectAgain(): void {
    this.inject();
  }

  createElement(init: ElementInit): FakeElement {
    return new FakeElement(init, this.document);
  }

  /** Appends a detached element tree into the live document (a JS-created player). */
  appendToBody(init: ElementInit): FakeElement {
    return this.document.body.appendChild(new FakeElement(init, this.document));
  }

  /**
   * A same-origin `<iframe>` whose document the page can read, holding one `<video>`.
   * Media events inside it do not reach the top document, exactly as in a browser.
   */
  appendSameOriginIframe(spec: {
    src: string;
    rect: Rect;
    video: { url: string; rect: Rect; props?: Record<string, unknown> };
  }): { frame: FakeElement; video: FakeElement; document: FakeDocument } {
    const frame = this.appendToBody({ tag: 'iframe', attrs: { src: spec.src, allowfullscreen: '' }, rect: spec.rect });
    const innerDoc = new FakeDocument(spec.src);
    const video = innerDoc.body.appendChild(
      new FakeElement(
        {
          tag: 'video',
          attrs: { src: spec.video.url },
          rect: spec.video.rect,
          props: { currentSrc: spec.video.url, videoWidth: 1280, videoHeight: 720, ...(spec.video.props ?? {}) },
        },
        innerDoc,
      ),
    );
    frame.contentDocument = innerDoc;
    frame.contentWindow = { document: innerDoc };
    return { frame, video, document: innerDoc };
  }

  fireMediaEvent(target: FakeElement, type: string): void {
    this.document.dispatchMediaEvent(target, type);
  }

  /** What a page does to build an MSE or Blob player: hand the object to `URL.createObjectURL`. */
  createObjectUrlFor(source: Record<string, unknown>): string {
    const create = vm.runInContext('URL.createObjectURL', this.context) as (o: unknown) => string;
    return create(source);
  }

  /** What a page does to start encrypted playback. Observation only — no key system is created. */
  requestMediaKeySystemAccess(keySystem = 'com.widevine.alpha'): void {
    const request = vm.runInContext(
      'navigator.requestMediaKeySystemAccess',
      this.context,
    ) as (system: string, configs: unknown[]) => unknown;
    request(keySystem, []);
  }

  fireWindowEvent(type: string, event: Record<string, unknown> = {}): void {
    for (const listener of (this.windowListeners.get(type) ?? []).slice()) listener({ type, ...event });
  }

  /** Feeds resource-timing entries to the page's PerformanceObserver. */
  emitResourceEntries(entries: { name: string; initiatorType?: string }[]): void {
    const normalized = entries.map((e) => ({ name: e.name, initiatorType: e.initiatorType ?? 'other' }));
    for (const cb of this.perfObserverCallbacks.slice()) cb(normalized);
  }

  setIntersection(pairs: { element: FakeElement; ratio: number }[]): void {
    const entries = pairs.map((p) => ({ target: p.element, intersectionRatio: p.ratio }));
    for (const cb of this.intersectionCallbacks.slice()) cb(entries);
  }

  /** An SPA route change: the page updates location then calls history.pushState. */
  spaNavigate(nextUrl: string): void {
    this.location.href = nextUrl;
    this.document.URL = nextUrl;
    const history = vm.runInContext('history', this.context) as { pushState: (...args: unknown[]) => unknown };
    history.pushState({}, '', nextUrl);
  }

  /** An in-place URL rewrite (tracking parameters, a filter): the page calls history.replaceState. */
  spaReplace(nextUrl: string): void {
    this.location.href = nextUrl;
    this.document.URL = nextUrl;
    const history = vm.runInContext('history', this.context) as { replaceState: (...args: unknown[]) => unknown };
    history.replaceState({}, '', nextUrl);
  }

  /** What the app injects to have the page report its media again (`buildMediaDetectionRescanScript`). */
  runRescanScript(): void {
    vm.runInContext(buildMediaDetectionRescanScript(), this.context, { timeout: 5_000 });
  }

  advance(ms: number): void {
    clockRef = this.clock;
    this.clock.advance(ms);
  }

  messagesOfType(type: string): PostedMessage[] {
    return this.messages.filter((m) => m.type === type);
  }

  clearMessages(): void {
    this.messages.length = 0;
  }

  get currentUrl(): string {
    return this.location.href;
  }
}
