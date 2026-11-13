import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { tabAudioScript, tabVolumeFraction } from './tab-audio-script.ts';
import {
  DEFAULT_TAB_SLEEP_AFTER,
  normalizeTabSleepAfter,
  tabSleepAfterMs,
  tabsToSleep,
  tabWakeCounts,
} from './tab-sleep.ts';

/** A page with HTMLMediaElement's native volume / muted accessors (validated like the browser's). */
function fakePage() {
  const nativeVolume = new WeakMap<object, number>();
  const nativeMuted = new WeakMap<object, boolean>();
  const posted: unknown[] = [];
  const context: Record<string, unknown> = { WeakMap, Object, Math, posted };
  vm.createContext(context);
  vm.runInContext(
    `
    function HTMLMediaElement() {}
    Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
      configurable: true, enumerable: true,
      get: function () { return __nv(this); },
      set: function (v) { if (!(v >= 0 && v <= 1)) throw new Error('IndexSizeError'); __setNv(this, v); },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
      configurable: true, enumerable: true,
      get: function () { return __nm(this); },
      set: function (v) { __setNm(this, !!v); },
    });
    HTMLMediaElement.prototype.play = function () { return 'played'; };
    var window = this;
    var elements = [];
    var document = { querySelectorAll: function () { return elements; } };
    `,
    context,
  );
  Object.assign(context, {
    __nv: (el: object) => nativeVolume.get(el) ?? 1,
    __setNv: (el: object, v: number) => nativeVolume.set(el, v),
    __nm: (el: object) => nativeMuted.get(el) ?? false,
    __setNm: (el: object, v: boolean) => nativeMuted.set(el, v),
  });
  const make = (inDocument = true) => {
    const el = vm.runInContext('new HTMLMediaElement()', context) as object;
    if (inDocument) (vm.runInContext('elements', context) as object[]).push(el);
    return el;
  };
  const read = (el: object, prop: 'volume' | 'muted') => (el as Record<string, unknown>)[prop];
  const write = (el: object, prop: 'volume' | 'muted', value: unknown) => {
    (el as Record<string, unknown>)[prop] = value;
  };
  return {
    run: (script: string) => vm.runInContext(script, context),
    make,
    read,
    write,
    native: (el: object) => ({ volume: nativeVolume.get(el) ?? 1, muted: nativeMuted.get(el) ?? false }),
    posted,
  };
}

describe('B3 tab sound script (node:vm page)', () => {
  test('mute: elements play muted while the page still reads its own values', () => {
    const page = fakePage();
    const video = page.make();
    page.run(tabAudioScript(true, 100));
    assert.deepEqual(page.native(video), { volume: 1, muted: true });
    assert.equal(page.read(video, 'muted'), false);
    page.run(tabAudioScript(false, 100));
    assert.deepEqual(page.native(video), { volume: 1, muted: false });
  });

  test('volume scales what the page sets; the page reads back its value', () => {
    const page = fakePage();
    const audio = page.make();
    page.run(tabAudioScript(false, 50));
    assert.equal(page.native(audio).volume, 0.5);
    page.write(audio, 'volume', 0.8);
    assert.equal(page.read(audio, 'volume'), 0.8);
    assert.ok(Math.abs(page.native(audio).volume - 0.4) < 1e-9);
    // The page's own invalid value still throws for the page.
    assert.throws(() => page.write(audio, 'volume', 2));
  });

  test('the page muting stays muted after the tab is unmuted', () => {
    const page = fakePage();
    const video = page.make();
    page.run(tabAudioScript(true, 100));
    page.write(video, 'muted', true);
    page.run(tabAudioScript(false, 100));
    assert.equal(page.native(video).muted, true);
    assert.equal(page.read(video, 'muted'), true);
  });

  test('play() applies the tab settings to elements outside the document (new Audio())', () => {
    const page = fakePage();
    page.run(tabAudioScript(true, 30));
    const detached = page.make(false);
    assert.equal((detached as { play: () => string }).play(), 'played');
    assert.deepEqual(page.native(detached), { volume: 0.3, muted: true });
  });

  test('installing twice keeps one wrapper and the latest values', () => {
    const page = fakePage();
    const el = page.make();
    page.run(tabAudioScript(false, 40));
    page.run(tabAudioScript(false, 20));
    page.write(el, 'volume', 1);
    assert.ok(Math.abs(page.native(el).volume - 0.2) < 1e-9);
  });

  test('values put in are a flag and a number; nothing is posted', () => {
    const script = tabAudioScript(true, 250);
    assert.match(script, /S\.muted = true;/);
    assert.match(script, /S\.volume = 1;/);
    assert.doesNotMatch(script, /postMessage|ReactNativeWebView|fetch\(|cookie|localStorage/);
    assert.equal(tabVolumeFraction(-5), 0);
    assert.equal(tabVolumeFraction(Number.NaN), 1);
  });
});

describe('B3 tab sleep', () => {
  const tabs = [
    { id: 'front', lastActiveAt: 0 },
    { id: 'old', lastActiveAt: 0 },
    { id: 'recent', lastActiveAt: 50 * 60_000 },
    { id: 'music', lastActiveAt: 0 },
  ];
  const base = { tabs, activeTabId: 'front', nowMs: 60 * 60_000, isPlaying: (id: string) => id === 'music' };

  test('default is off (today); choices map to minutes', () => {
    assert.equal(DEFAULT_TAB_SLEEP_AFTER, 'off');
    assert.equal(normalizeTabSleepAfter('forever'), 'off');
    assert.equal(tabSleepAfterMs('off'), null);
    assert.equal(tabSleepAfterMs('30m'), 30 * 60_000);
  });

  test('only live, unused tabs sleep; never the tab in front or one playing sound', () => {
    assert.deepEqual(
      tabsToSleep({ ...base, mountedTabIds: ['front', 'old', 'recent', 'music'], afterMs: 30 * 60_000 }),
      ['old'],
    );
    assert.deepEqual(tabsToSleep({ ...base, mountedTabIds: ['front', 'old'], afterMs: null }), []);
    assert.deepEqual(tabsToSleep({ ...base, mountedTabIds: ['front'], afterMs: 1 }), []);
  });

  test('awake = live pages, asleep = the rest', () => {
    assert.deepEqual(tabWakeCounts(6, ['a', 'b'], ['a', 'b', 'c', 'd', 'e', 'f']), { awake: 2, asleep: 4 });
    assert.deepEqual(tabWakeCounts(1, ['a', 'gone'], ['a']), { awake: 1, asleep: 0 });
  });
});
