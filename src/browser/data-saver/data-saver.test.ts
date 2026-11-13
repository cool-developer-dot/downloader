import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { autoScrollSpeedFactor, bindAutoScrollSpeedFactor } from '../scroll/auto-scroll.ts';
import {
  addBrowsingBytes,
  EMPTY_BROWSING_TRAFFIC,
  intervalBrowsingBytes,
  parseBrowsingTraffic,
  summarizeBrowsing,
  type TrafficMark,
} from './browsing-traffic.ts';
import { shouldClearCache } from './cache-limit.ts';
import { createSaverNative } from './data-saver-native.ts';
import {
  BATTERY_TAB_SLEEP_MS,
  cacheLimitBytes,
  cappedTabSleepMs,
  exceptionSite,
  imagesOffFor,
  LITE_PAGE_CSS,
  LITE_PAGE_SCRIPT,
  LITE_TAB_SLEEP_MS,
  normalizeBatterySaver,
  normalizeCacheLimit,
  parseImageExceptions,
  resolveSaverEffects,
  serializeImageExceptions,
  type SaverSettings,
} from './data-saver-settings.ts';

const OFF: SaverSettings = {
  blockImages: false,
  imageExceptions: [],
  imagesWifiOnly: false,
  dataSaver: false,
  liteMode: false,
  lightweightHome: false,
  batterySaver: 'off',
  hardwareAcceleration: true,
};
const WIFI = { onWifi: true, phonePowerSave: false };
const MOBILE = { onWifi: false, phonePowerSave: false };

describe('saver effects (B18)', () => {
  test('defaults change nothing (today’s browser)', () => {
    for (const conditions of [WIFI, MOBILE, { onWifi: false, phonePowerSave: true }]) {
      const e = resolveSaverEffects(OFF, conditions);
      assert.deepEqual(
        [e.preloadOff, e.autoplayOff, e.tabSleepCapMs, e.autoScrollFactor, e.softwareLayer, e.lightHome, e.pageAnimationsOff, e.lite, e.battery],
        [false, false, null, 1, false, false, false, false, false],
      );
      assert.equal(imagesOffFor(OFF, e, conditions, 'https://example.com/'), false);
    }
  });

  test('data saver: pictures on Wi-Fi only, no preloading, autoplay off, lite on mobile data only', () => {
    const settings = { ...OFF, dataSaver: true };
    const wifi = resolveSaverEffects(settings, WIFI);
    const mobile = resolveSaverEffects(settings, MOBILE);
    assert.equal(wifi.preloadOff, true);
    assert.equal(wifi.autoplayOff, true);
    assert.equal(wifi.lite, false);
    assert.equal(mobile.lite, true);
    assert.equal(mobile.tabSleepCapMs, LITE_TAB_SLEEP_MS);
    assert.equal(mobile.lightHome, true);
    assert.equal(imagesOffFor(settings, wifi, WIFI, 'https://a.org/'), false);
    assert.equal(imagesOffFor(settings, mobile, MOBILE, 'https://a.org/'), true);
  });

  test('block images with exceptions; Wi-Fi only; an exception always shows pictures', () => {
    const settings = { ...OFF, blockImages: true, imageExceptions: ['example.com'] };
    const e = resolveSaverEffects(settings, WIFI);
    assert.equal(imagesOffFor(settings, e, WIFI, 'https://news.org/a'), true);
    assert.equal(imagesOffFor(settings, e, WIFI, 'https://www.example.com/x'), false);
    const wifiOnly = { ...OFF, imagesWifiOnly: true, imageExceptions: ['example.com'] };
    assert.equal(imagesOffFor(wifiOnly, resolveSaverEffects(wifiOnly, MOBILE), MOBILE, 'https://news.org/'), true);
    assert.equal(imagesOffFor(wifiOnly, resolveSaverEffects(wifiOnly, WIFI), WIFI, 'https://news.org/'), false);
    assert.equal(imagesOffFor(wifiOnly, resolveSaverEffects(wifiOnly, MOBILE), MOBILE, 'https://example.com/'), false);
  });

  test('lite mode: one live tab, animations off, pictures on Wi-Fi only, light start page', () => {
    const settings = { ...OFF, liteMode: true };
    const e = resolveSaverEffects(settings, WIFI);
    assert.equal(e.lite, true);
    assert.equal(e.tabSleepCapMs, LITE_TAB_SLEEP_MS);
    assert.equal(e.pageAnimationsOff, true);
    assert.equal(e.lightHome, true);
    assert.equal(e.preloadOff, true);
    assert.equal(imagesOffFor(settings, e, MOBILE, 'https://a.org/'), true);
  });

  test('battery saver: off by default, follows the phone, or always on', () => {
    const phone = { ...OFF, batterySaver: 'phone' as const };
    assert.equal(resolveSaverEffects(phone, WIFI).battery, false);
    const saving = resolveSaverEffects(phone, { onWifi: true, phonePowerSave: true });
    assert.equal(saving.battery, true);
    assert.equal(saving.preloadOff, true);
    assert.equal(saving.tabSleepCapMs, BATTERY_TAB_SLEEP_MS);
    assert.ok(saving.autoScrollFactor < 1);
    assert.equal(resolveSaverEffects({ ...OFF, batterySaver: 'on' }, WIFI).battery, true);
    assert.equal(normalizeBatterySaver('x'), 'off');
  });

  test('hardware acceleration off = software layer; never on by default', () => {
    assert.equal(resolveSaverEffects({ ...OFF, hardwareAcceleration: false }, WIFI).softwareLayer, true);
    assert.equal(resolveSaverEffects(OFF, WIFI).softwareLayer, false);
  });

  test('the tab sleep cap shortens, never lengthens, and works with Sleep off', () => {
    assert.equal(cappedTabSleepMs(null, null), null);
    assert.equal(cappedTabSleepMs(30 * 60_000, null), 30 * 60_000);
    assert.equal(cappedTabSleepMs(null, BATTERY_TAB_SLEEP_MS), BATTERY_TAB_SLEEP_MS);
    assert.equal(cappedTabSleepMs(60_000, BATTERY_TAB_SLEEP_MS), 60_000);
  });
});

describe('image exceptions and choices', () => {
  test('sites typed any way become hosts; bad ones are refused', () => {
    assert.equal(exceptionSite('www.Example.com'), 'example.com');
    assert.equal(exceptionSite('https://news.example.org/a?b'), 'news.example.org');
    assert.equal(exceptionSite('not a site'), null);
    assert.equal(exceptionSite('javascript:alert(1)'), null);
    assert.equal(exceptionSite(''), null);
  });

  test('the list is cleaned, de-duplicated and sorted', () => {
    assert.deepEqual(parseImageExceptions('["b.com","A.com","a.com","bad host",5]'), ['a.com', 'b.com']);
    assert.deepEqual(parseImageExceptions('{'), []);
    assert.equal(serializeImageExceptions(['z.org', 'a.org']), '["a.org","z.org"]');
  });

  test('cache limit choices', () => {
    assert.equal(normalizeCacheLimit('250'), '250');
    assert.equal(normalizeCacheLimit(250), '0');
    assert.equal(cacheLimitBytes('50'), 50 * 1024 * 1024);
    assert.equal(cacheLimitBytes('0'), 0);
  });
});

describe('browsing data (#185)', () => {
  const mark = (over: Partial<TrafficMark> = {}): TrafficMark => ({
    rxBytes: 1000,
    txBytes: 100,
    bootCount: 3,
    sinceBootMs: 50_000,
    downloadedBytes: 500,
    ...over,
  });

  test('app bytes minus download bytes in the interval', () => {
    assert.equal(intervalBrowsingBytes(mark(), mark({ rxBytes: 6000, txBytes: 300, sinceBootMs: 60_000, downloadedBytes: 2500 })), 3200);
    assert.equal(intervalBrowsingBytes(mark(), mark({ rxBytes: 1500, downloadedBytes: 5000 })), 0, 'never negative');
  });

  test('never counts across a restart, a counter going down, or a download Reset', () => {
    assert.equal(intervalBrowsingBytes(mark(), mark({ bootCount: 4, rxBytes: 9000 })), null);
    assert.equal(intervalBrowsingBytes(mark(), mark({ sinceBootMs: 10, rxBytes: 9000 })), null);
    assert.equal(intervalBrowsingBytes(mark(), mark({ rxBytes: 10 })), null);
    assert.equal(intervalBrowsingBytes(mark(), mark({ txBytes: 10, rxBytes: 9000 })), null);
    assert.equal(intervalBrowsingBytes(mark(), mark({ downloadedBytes: 0, rxBytes: 9000 })), null);
    assert.equal(intervalBrowsingBytes(mark(), mark({ rxBytes: Number.NaN })), null);
  });

  test('buckets by local day and month; saved form is checked', () => {
    const at = new Date(2026, 10, 8, 12).getTime();
    let s = addBrowsingBytes(EMPTY_BROWSING_TRAFFIC, 1000, at);
    s = addBrowsingBytes(s, 500, at);
    s = addBrowsingBytes(s, 0, at);
    s = addBrowsingBytes(s, 700, new Date(2026, 10, 1, 9).getTime());
    assert.deepEqual(summarizeBrowsing(s, at), { todayBytes: 1500, monthBytes: 2200 });
    assert.deepEqual(parseBrowsingTraffic(JSON.stringify(s)), s);
    assert.deepEqual(parseBrowsingTraffic('{"days":{"2026-11-08":-5,"x":3},"months":{"2026-11":9}}').days, {});
    assert.deepEqual(parseBrowsingTraffic('nope'), EMPTY_BROWSING_TRAFFIC);
  });
});

describe('cache limit (#192)', () => {
  const MB = 1024 * 1024;
  test('clears only over the limit, and not every start when a floor stays over it', () => {
    assert.equal(shouldClearCache(120 * MB, 0, 0), false, 'Off');
    assert.equal(shouldClearCache(40 * MB, 50 * MB, 0), false);
    assert.equal(shouldClearCache(60 * MB, 50 * MB, 0), true);
    assert.equal(shouldClearCache(60 * MB, 50 * MB, 58 * MB), false, 'what clearing can’t remove');
    assert.equal(shouldClearCache(80 * MB, 50 * MB, 58 * MB), true, 'grown again');
  });
});

describe('saver native calls', () => {
  test('nothing sent to an untouched WebView; changes once; forget', () => {
    const calls: unknown[][] = [];
    const native = createSaverNative(() => ({
      setBlockNetworkImage: async (...a: unknown[]) => (calls.push(['img', ...a]), true),
      setSoftwareLayer: async (...a: unknown[]) => (calls.push(['sw', ...a]), true),
    }));
    assert.equal(native.applyImages(3, false), false);
    assert.equal(native.applySoftware(3, false), false);
    assert.equal(native.applyImages(3, true), true);
    assert.equal(native.applyImages(3, true), false);
    assert.equal(native.applyImages(3, false), true);
    assert.equal(native.applySoftware(3, true), true);
    native.forget(3);
    assert.equal(native.applyImages(3, false), false);
    assert.deepEqual(calls, [
      ['img', 3, true],
      ['img', 3, false],
      ['sw', 3, true],
    ]);
    assert.equal(createSaverNative(() => ({})).applyImages(1, true), false, 'older native build');
  });
});

describe('lite page script (node:vm) and auto scroll speed', () => {
  test('adds one style element with the reduced-motion values', () => {
    const nodes: Record<string, unknown>[] = [];
    const head = { appendChild: (n: Record<string, unknown>) => nodes.push(n) };
    const context: Record<string, unknown> = {
      JSON,
      document: {
        head,
        documentElement: head,
        getElementById: (id: string) => nodes.find((n) => n.id === id) ?? null,
        createElement: () => ({ id: '', textContent: '' }),
        addEventListener: () => undefined,
      },
    };
    vm.createContext(context);
    vm.runInContext(LITE_PAGE_SCRIPT, context);
    vm.runInContext(LITE_PAGE_SCRIPT, context);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].textContent, LITE_PAGE_CSS);
    assert.ok(LITE_PAGE_CSS.includes('0.01ms'), 'not 0s: transitionend still fires');
    const broken: Record<string, unknown> = { JSON, document: null };
    vm.createContext(broken);
    assert.doesNotThrow(() => vm.runInContext(LITE_PAGE_SCRIPT, broken));
  });

  test('auto scroll speed share is 1 unbound and clamped when bound', () => {
    assert.equal(autoScrollSpeedFactor(), 1);
    bindAutoScrollSpeedFactor(() => 0.6);
    assert.equal(autoScrollSpeedFactor(), 0.6);
    bindAutoScrollSpeedFactor(() => 0);
    assert.equal(autoScrollSpeedFactor(), 0.25);
    bindAutoScrollSpeedFactor(() => {
      throw new Error('x');
    });
    assert.equal(autoScrollSpeedFactor(), 1);
    bindAutoScrollSpeedFactor(null);
    assert.equal(autoScrollSpeedFactor(), 1);
  });
});
