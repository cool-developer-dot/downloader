import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { buildMediaDetectionInjectedScript } from './injected-script.ts';

/**
 * Naming the video file and the audio file of a split MediaSource player, as the page observation does it: the
 * observation source is cut from the injected script and run against a fake player and fake requests.
 *
 * The case that matters here is a player that appends a *copy* of what it fetched (Bilibili's desktop player hands
 * `appendBuffer` a fresh ArrayBuffer), which loses the identity the WeakMap matches on.
 */

type Files = { v: string | null; a: string | null };
type FakeBuffer = { appendBuffer: (data: ArrayBuffer) => void };
type FakeMediaSource = { addSourceBuffer: (mime: string) => FakeBuffer; __vidoraxFiles?: Files };
type FakeXhr = {
  open: (method: string, url: string) => void;
  send: () => void;
  addEventListener: (name: string, fn: () => void) => void;
  responseType: string;
  response: ArrayBuffer | null;
  responseURL: string;
  finish: (url: string, bytes: ArrayBuffer) => void;
  deliverWithoutListeners: (url: string, bytes: ArrayBuffer) => ArrayBuffer | null;
};

/** The page pieces the observation hooks. Only what it touches is modelled. */
function fakeWindow() {
  function SourceBufferCtor() {}
  SourceBufferCtor.prototype.appendBuffer = function appendBuffer() {};

  function MediaSourceCtor() {}
  MediaSourceCtor.prototype.addSourceBuffer = function addSourceBuffer() {
    return new (SourceBufferCtor as unknown as new () => FakeBuffer)();
  };

  function XhrCtor() {
    this.listeners = [];
    this.responseType = '';
    this._response = null;
    this.responseURL = '';
  }
  XhrCtor.prototype.open = function open(_method: string, url: string) {
    this.responseURL = url;
  };
  XhrCtor.prototype.send = function send() {};
  // The bytes are read through a getter, as the real XMLHttpRequest serves them.
  Object.defineProperty(XhrCtor.prototype, 'response', {
    configurable: true,
    get(): ArrayBuffer | null {
      return this._response ?? null;
    },
  });
  XhrCtor.prototype.addEventListener = function addEventListener(name: string, fn: () => void) {
    if (name === 'load') this.listeners.push(fn);
  };
  /** The response arrives: what the hooked `send` listens for. */
  XhrCtor.prototype.finish = function finish(url: string, bytes: ArrayBuffer) {
    this.responseType = 'arraybuffer';
    this.responseURL = url;
    this._response = bytes;
    this.listeners.slice().forEach((fn: () => void) => fn());
  };
  /** The page's own handler ran first and took the bytes: our load listener has not run yet. */
  XhrCtor.prototype.deliverWithoutListeners = function deliverWithoutListeners(url: string, bytes: ArrayBuffer) {
    this.responseType = 'arraybuffer';
    this.responseURL = url;
    this._response = bytes;
    return this.response;
  };

  return {
    MediaSource: MediaSourceCtor,
    SourceBuffer: SourceBufferCtor,
    XMLHttpRequest: XhrCtor,
    URL: { createObjectURL: () => 'blob:fake' },
  } as unknown as Record<string, unknown>;
}

function loadObservation() {
  const script = buildMediaDetectionInjectedScript();
  const start = script.indexOf('  function vidoraxMseObservation() {');
  const returnState = script.indexOf('    return state;', start);
  assert.ok(start > 0 && returnState > start, 'vidoraxMseObservation in the observer');
  const source = script.slice(start, script.indexOf('  }', returnState) + 4);

  const window = fakeWindow();
  // The page's globals are the same objects as window's: the source reaches some of them by bare name.
  const context = vm.createContext({
    window,
    navigator: {},
    XMLHttpRequest: window.XMLHttpRequest,
    MediaSource: window.MediaSource,
    SourceBuffer: window.SourceBuffer,
    URL: window.URL,
    WeakMap,
    ArrayBuffer,
    Uint8Array,
    Date,
    Object,
    Math,
    String,
  });
  vm.runInContext(`${source}\nvidoraxMseObservation();`, context);
  return window;
}

/** Bytes that look like one file's fragment: a stable, file-specific leading pattern. */
function bytesFor(seed: number, length: number): ArrayBuffer {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (seed * 31 + i * 7) % 251;
  return out.buffer;
}

/** What a copying player hands to appendBuffer: the response's identity is gone, its bytes are not. */
function copyOf(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0);
}

const VIDEO = 'https://cdn.test/42382331523-1-100022.m4s';
const AUDIO = 'https://cdn.test/42382331523-1-30216.m4s';

function answer(window: Record<string, unknown>, url: string, bytes: ArrayBuffer): void {
  const Xhr = window.XMLHttpRequest as unknown as new () => FakeXhr;
  const xhr = new Xhr();
  xhr.open('GET', url);
  xhr.send();
  xhr.finish(url, bytes);
}

function play(options: { videoBytes: ArrayBuffer; audioBytes: ArrayBuffer; copy: boolean }): Files | null {
  const window = loadObservation();
  answer(window, VIDEO, options.videoBytes);
  answer(window, AUDIO, options.audioBytes);

  const Ms = window.MediaSource as unknown as new () => FakeMediaSource;
  const ms = new Ms();
  const videoBuffer = ms.addSourceBuffer('video/mp4; codecs="avc1.640028"');
  const audioBuffer = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  const hand = (bytes: ArrayBuffer) => (options.copy ? copyOf(bytes) : bytes);
  videoBuffer.appendBuffer(hand(options.videoBytes));
  audioBuffer.appendBuffer(hand(options.audioBytes));
  // The player's own object comes from the page's realm: compared here as plain values.
  const files = ms.__vidoraxFiles;
  return files ? { v: files.v ?? null, a: files.a ?? null } : null;
}

describe('a split player’s two files are named even when the player copies the bytes', () => {
  it('the fetched buffers themselves name each file (identity)', () => {
    assert.deepEqual(play({ videoBytes: bytesFor(1, 4096), audioBytes: bytesFor(2, 2048), copy: false }), {
      v: VIDEO,
      a: AUDIO,
    });
  });

  it('a copy of the fetched bytes still names each file (Bilibili’s desktop player)', () => {
    assert.deepEqual(play({ videoBytes: bytesFor(3, 4096), audioBytes: bytesFor(4, 2048), copy: true }), {
      v: VIDEO,
      a: AUDIO,
    });
  });

  it('two files that answered the very same bytes name neither', () => {
    const same = bytesFor(5, 4096);
    assert.equal(play({ videoBytes: same, audioBytes: copyOf(same), copy: true }), null);
  });

  it('a page that takes the bytes before our load listener runs still names the file', () => {
    const window = loadObservation();
    const bytes = bytesFor(8, 4096);
    const Xhr = window.XMLHttpRequest as unknown as new () => FakeXhr;
    const xhr = new Xhr();
    xhr.open('GET', VIDEO);
    xhr.send();
    // The page reads xhr.response and appends a copy, all before any load listener of ours is called.
    const taken = xhr.deliverWithoutListeners(VIDEO, bytes);
    assert.equal(taken, bytes);

    const Ms = window.MediaSource as unknown as new () => FakeMediaSource;
    const ms = new Ms();
    ms.addSourceBuffer('video/mp4; codecs="avc1.640028"').appendBuffer(copyOf(bytes));
    assert.equal(ms.__vidoraxFiles?.v, VIDEO);
  });

  it('bytes no request answered name nothing', () => {
    const window = loadObservation();
    answer(window, VIDEO, bytesFor(6, 4096));
    const Ms = window.MediaSource as unknown as new () => FakeMediaSource;
    const ms = new Ms();
    ms.addSourceBuffer('video/mp4; codecs="avc1.640028"').appendBuffer(bytesFor(7, 4096));
    assert.equal(ms.__vidoraxFiles ?? null, null);
  });
});
