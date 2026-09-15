/**
 * Runs the in-page detector inside node:vm with a small fake window and document, for tests.
 *
 * The script is built from src/detection/page/src on first use, so tests never run a stale generated file.
 * Timers run on a manual clock; `settle()` lets promises and due timers run.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import type { DetectorMessage, PageCandidate, PlayerHint } from '../types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
export const BUILD_SCRIPT = join(ROOT, 'scripts/build-detector.mjs');
const FIXTURES = join(ROOT, 'src/detection/page/__fixtures__');

let builtScript: string | undefined;

export function detectorScript(): string {
  builtScript ??= execFileSync(process.execPath, [BUILD_SCRIPT, '--stdout'], { encoding: 'utf8' });
  return builtScript;
}

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

interface Timer {
  id: number;
  at: number;
  callback: () => void;
}

class ManualClock {
  now = 1_700_000_000_000;
  private nextId = 1;
  private timers: Timer[] = [];

  setTimeout = (callback: () => void, delay?: number): number => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.now + Math.max(0, Number(delay) || 0), callback });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.timers = this.timers.filter((timer) => timer.id !== id);
  };

  /** Runs every timer due by `until` in time order, including timers those callbacks schedule. */
  runUntil(until: number): void {
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.at <= until)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.now = Math.max(this.now, due.at);
      due.callback();
    }
    this.now = Math.max(this.now, until);
  }
}

type Listener = (event: unknown) => void;

class EventHub {
  private listeners: { target: object; type: string; listener: Listener }[] = [];

  add(target: object, type: string, listener: Listener): void {
    this.listeners.push({ target, type, listener });
  }

  dispatch(target: object, type: string, event: object): void {
    for (const entry of this.listeners.slice()) {
      if (entry.target === target && entry.type === type) entry.listener.call(target, { type, ...event });
    }
  }
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ElementSpec {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  /** Element properties, e.g. media state: { paused: false, videoWidth: 1280, duration: 12 }. */
  props?: Record<string, unknown>;
  rect?: Rect;
  children?: ElementSpec[];
}

export class FakeElement {
  tagName: string;
  textContent: string;
  isConnected = true;
  paused = true;
  ended = false;
  currentSrc = '';
  duration = Number.NaN;
  videoWidth = 0;
  videoHeight = 0;
  rect: Rect;
  children: FakeElement[];
  private attributes: Map<string, string>;

  constructor(spec: ElementSpec) {
    this.tagName = spec.tag.toUpperCase();
    this.textContent = spec.text ?? '';
    this.rect = spec.rect ?? { left: 0, top: 0, width: 0, height: 0 };
    this.children = (spec.children ?? []).map((child) => new FakeElement(child));
    this.attributes = new Map(Object.entries(spec.attrs ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
    Object.assign(this, spec.props);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  getElementsByTagName(tag: string): FakeElement[] {
    return descendants(this.children).filter((element) => element.tagName === tag.toUpperCase());
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
}

function descendants(elements: FakeElement[]): FakeElement[] {
  return elements.flatMap((element) => [element, ...descendants(element.children)]);
}

export interface FetchReply {
  body?: string | ReadableStream<Uint8Array>;
  contentType?: string;
  headers?: Record<string, string>;
  status?: number;
  /** Final response URL; defaults to the requested URL. */
  url?: string;
}

export interface XhrReply {
  url: string;
  body: string;
  responseType?: '' | 'text' | 'json' | 'arraybuffer' | 'blob' | 'document';
  contentType?: string;
}

export interface FakeXhr {
  responseType: string;
  readonly responseText: string;
  readonly response: unknown;
  /** How many times the page (or the detector) read responseText or response. */
  bodyReads: number;
  open(method: string, url: string): void;
  send(): void;
}

export interface TapStats {
  clones: number;
  cancels: number;
}

export interface PageOptions {
  url: string;
  title?: string;
  elements?: ElementSpec[];
  readyState?: 'loading' | 'interactive' | 'complete';
  /** Whether window.ReactNativeWebView exists at start. Default true. */
  bridge?: boolean;
  /** Replaces the bridge's postMessage, e.g. to make it throw. */
  postMessage?: (message: string) => void;
  /** False simulates a cross-origin child frame whose window.top access throws. Default true. */
  isMain?: boolean;
  viewport?: { width: number; height: number };
}

export interface DetectorPage {
  window: Record<string, unknown>;
  document: { title: string; readyState: string };
  clock: ManualClock;
  /** Every string passed to ReactNativeWebView.postMessage. */
  raw: string[];
  messages: DetectorMessage[];
  tapStats: TapStats;
  elements(tag: string): FakeElement[];
  candidates(): PageCandidate[];
  playerMessages(): PlayerHint[][];
  attachBridge(): void;
  /** Runs the detector script again in the same window. */
  inject(): void;
  addElements(specs: ElementSpec[]): FakeElement[];
  domContentLoaded(): Promise<void>;
  load(): Promise<void>;
  /** Lets promises settle and runs timers due within `ms` of the current time. */
  settle(ms?: number): Promise<void>;
  fetch(url: string, reply: FetchReply): Promise<Response>;
  xhr(reply: XhrReply): Promise<FakeXhr>;
  mediaEvent(element: FakeElement, type: string): Promise<void>;
  navigate(url: string, method?: 'pushState' | 'replaceState'): Promise<void>;
}

function setLocation(location: Record<string, string>, href: string): void {
  const url = new URL(href);
  Object.assign(location, {
    href: url.href,
    origin: url.origin,
    protocol: url.protocol,
    host: url.host,
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  });
}

function instrumentResponse(response: Response, stats: TapStats): void {
  const clone = response.clone.bind(response);
  Object.defineProperty(response, 'clone', {
    value: () => {
      stats.clones += 1;
      const copy = clone();
      const body = copy.body;
      if (body) {
        const getReader = body.getReader.bind(body);
        Object.defineProperty(body, 'getReader', {
          value: () => {
            const reader = getReader();
            const cancel = reader.cancel.bind(reader);
            Object.defineProperty(reader, 'cancel', {
              value: (reason?: unknown) => {
                stats.cancels += 1;
                return cancel(reason);
              },
            });
            return reader;
          },
        });
      }
      return copy;
    },
  });
}

export function loadDetector(options: PageOptions): DetectorPage {
  const clock = new ManualClock();
  const events = new EventHub();
  const raw: string[] = [];
  const messages: DetectorMessage[] = [];
  const tapStats: TapStats = { clones: 0, cancels: 0 };
  const tree: FakeElement[] = (options.elements ?? []).map((spec) => new FakeElement(spec));
  const location: Record<string, string> = {};
  setLocation(location, options.url);

  const document = {
    title: options.title ?? '',
    readyState: options.readyState ?? 'loading',
    documentElement: { clientWidth: options.viewport?.width ?? 400, clientHeight: options.viewport?.height ?? 800 },
    getElementsByTagName: (tag: string) => descendants(tree).filter((element) => element.tagName === tag.toUpperCase()),
    addEventListener: (type: string, listener: Listener) => events.add(document, type, listener),
    removeEventListener: () => undefined,
  };

  const bridge = {
    postMessage:
      options.postMessage ??
      ((message: string) => {
        raw.push(message);
        messages.push(JSON.parse(message) as DetectorMessage);
      }),
  };

  let nextReply: FetchReply = {};
  const originalFetch = (input: string | { url: string }) => {
    const requested = typeof input === 'string' ? input : input.url;
    const reply = nextReply;
    const headers = new Headers(reply.headers);
    if (reply.contentType) headers.set('content-type', reply.contentType);
    const response = new Response(reply.body ?? '', { status: reply.status ?? 200, headers });
    Object.defineProperty(response, 'url', { value: reply.url ?? new URL(requested, location.href).href });
    instrumentResponse(response, tapStats);
    return Promise.resolve(response);
  };

  class PageURL extends URL {}
  let objectUrls = 0;
  Object.defineProperty(PageURL, 'createObjectURL', {
    value: () => `blob:${location.origin}/object-${++objectUrls}`,
    writable: true,
    configurable: true,
  });

  class FakeMediaSource {
    addSourceBuffer(type: string) {
      return { type };
    }
  }

  class FakeMediaElement {
    setMediaKeys() {
      return Promise.resolve();
    }
  }

  class FakeXMLHttpRequest implements FakeXhr {
    responseType = '';
    responseURL = '';
    status = 0;
    bodyReads = 0;
    private body = '';
    private parsed: unknown = null;
    private contentType: string | null = null;
    private loadListeners: Listener[] = [];

    get responseText(): string {
      this.bodyReads += 1;
      if (this.responseType !== '' && this.responseType !== 'text') throw new Error('InvalidStateError');
      return this.body;
    }

    get response(): unknown {
      this.bodyReads += 1;
      if (this.responseType === 'json') return this.parsed;
      return this.responseType === '' || this.responseType === 'text' ? this.body : null;
    }

    open(_method: string, _url: string): void {}

    send(): void {}

    addEventListener(type: string, listener: Listener): void {
      if (type === 'load' && !this.loadListeners.includes(listener)) this.loadListeners.push(listener);
    }

    getResponseHeader(name: string): string | null {
      return name.toLowerCase() === 'content-type' ? this.contentType : null;
    }

    respond(reply: XhrReply): void {
      this.status = 200;
      this.responseURL = reply.url;
      this.body = reply.body;
      this.contentType = reply.contentType ?? null;
      this.parsed = reply.responseType === 'json' ? JSON.parse(reply.body) : null;
      this.loadListeners.forEach((listener) => listener.call(this, { type: 'load' }));
    }
  }

  const window: Record<string, unknown> = {
    location,
    document,
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
      requestMediaKeySystemAccess: (keySystem: string) => Promise.resolve({ keySystem }),
    },
    history: {
      pushState: (_state: unknown, _title: string, url: string) => setLocation(location, new URL(url, location.href).href),
      replaceState: (_state: unknown, _title: string, url: string) => setLocation(location, new URL(url, location.href).href),
    },
    innerWidth: options.viewport?.width ?? 400,
    innerHeight: options.viewport?.height ?? 800,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    URL: PageURL,
    TextDecoder,
    Date: class extends Date {
      static now() {
        return clock.now;
      }
    },
    fetch: originalFetch,
    XMLHttpRequest: FakeXMLHttpRequest,
    MediaSource: FakeMediaSource,
    HTMLMediaElement: FakeMediaElement,
    addEventListener: (type: string, listener: Listener) => events.add(window, type, listener),
    removeEventListener: () => undefined,
  };
  window.window = window;
  window.self = window;
  if (options.isMain === false) {
    Object.defineProperty(window, 'top', {
      get() {
        throw new Error('SecurityError: cross-origin frame');
      },
    });
  } else {
    window.top = window;
  }
  if (options.bridge !== false) window.ReactNativeWebView = bridge;

  vm.createContext(window);
  const script = new vm.Script(detectorScript(), { filename: 'detector.js' });
  script.runInContext(window);

  const page: DetectorPage = {
    window,
    document,
    clock,
    raw,
    messages,
    tapStats,
    elements: (tag) => document.getElementsByTagName(tag),
    candidates: () => messages.flatMap((message) => (message.type === 'candidates' ? message.candidates : [])),
    playerMessages: () => messages.flatMap((message) => (message.type === 'players' ? [message.players] : [])),
    attachBridge: () => {
      window.ReactNativeWebView = bridge;
    },
    inject: () => script.runInContext(window),
    addElements: (specs) => {
      const added = specs.map((spec) => new FakeElement(spec));
      tree.push(...added);
      return added;
    },
    async domContentLoaded() {
      document.readyState = 'interactive';
      events.dispatch(document, 'DOMContentLoaded', { target: document });
      await page.settle();
    },
    async load() {
      document.readyState = 'complete';
      events.dispatch(window, 'load', { target: window });
      await page.settle();
    },
    async settle(ms = 0) {
      const until = clock.now + ms;
      for (let round = 0; round < 25; round++) {
        await new Promise((resolve) => setImmediate(resolve));
        clock.runUntil(until);
      }
    },
    async fetch(url, reply) {
      nextReply = reply;
      const response = await (window.fetch as (input: string) => Promise<Response>)(url);
      await page.settle();
      return response;
    },
    async xhr(reply) {
      const Xhr = window.XMLHttpRequest as new () => FakeXMLHttpRequest;
      const request = new Xhr();
      request.responseType = reply.responseType ?? '';
      request.open('GET', reply.url);
      request.send();
      request.respond(reply);
      await page.settle();
      return request;
    },
    async mediaEvent(element, type) {
      events.dispatch(document, type, { target: element });
      await page.settle();
    },
    async navigate(url, method = 'pushState') {
      const history = window.history as Record<string, (state: unknown, title: string, url: string) => void>;
      history[method](null, '', url);
      await page.settle();
    },
  };
  return page;
}
