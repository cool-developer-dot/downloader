import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import vm from 'node:vm';

import { tabAudioScript } from '../tab-sound/tab-audio-script.ts';
import { createBlockingNative } from './blocking-native.ts';
import {
  AUTOPLAY_BLOCK_ALL_SCRIPT,
  DEFAULT_AUTOPLAY,
  autoplayNeedsTap,
  matchingSite,
  normalizeAutoplay,
  parseAutoplaySites,
  parseSiteList,
  resolveAutoplay,
  serializeAutoplaySites,
  serializeSiteList,
  siteCovers,
  siteFromInput,
  withAutoplayForSite,
} from './blocking-settings.ts';
import {
  EMPTY_SITE_LIMITS,
  localDayKey,
  nextChangeAt,
  nextLocalMidnight,
  normalizeFocusMinutesChoice,
  siteBlockReason,
  tickSeconds,
  timedSiteFor,
  usedSeconds,
  withUsage,
  type SiteLimitsState,
} from './site-limits.ts';

describe('B14 settings: sites and autoplay', () => {
  test('sites typed any way become one key; a site covers its subdomains, by label', () => {
    assert.equal(siteFromInput(' https://WWW.Example.com/page?x=1 '), 'example.com');
    assert.equal(siteFromInput('m.example.com'), 'm.example.com');
    assert.equal(siteFromInput('not a site'), null);
    assert.equal(siteFromInput(''), null);
    assert.ok(siteCovers('example.com', 'news.example.com'));
    assert.ok(!siteCovers('example.com', 'notexample.com'));
    assert.equal(matchingSite('https://a.b.example.com/x', ['example.com', 'b.example.com']), 'b.example.com');
    assert.equal(matchingSite('vidorax://home', ['example.com']), null);
  });

  test('site lists are cleaned, deduplicated and capped', () => {
    assert.deepEqual(parseSiteList('["Example.com","www.example.com","bad host",3,"x.org"]'), ['example.com', 'x.org']);
    assert.deepEqual(parseSiteList('not json'), []);
    assert.deepEqual(parseSiteList('{"a":1}'), []);
    assert.equal(parseSiteList(JSON.stringify(Array.from({ length: 400 }, (_, i) => `s${i}.com`))).length, 300);
    assert.equal(serializeSiteList(['a.com', 'a.com']), '["a.com"]');
  });

  test('per-site autoplay: valid policies only; set and remove', () => {
    assert.deepEqual(parseAutoplaySites('{"www.a.com":"all","b.com":"loud","bad host":"allow"}'), { 'a.com': 'all' });
    const sites = withAutoplayForSite({}, 'a.com', 'allow');
    assert.equal(serializeAutoplaySites(sites), '{"a.com":"allow"}');
    assert.deepEqual(withAutoplayForSite(sites, 'a.com', null), {});
    assert.equal(normalizeAutoplay('loud'), 'sound');
  });

  test('autoplay: the default is today’s (a tap before sound, no script); site wins, then Data saver, then global', () => {
    assert.equal(DEFAULT_AUTOPLAY, 'sound');
    assert.equal(autoplayNeedsTap('sound'), true);
    assert.equal(autoplayNeedsTap('all'), true);
    assert.equal(autoplayNeedsTap('allow'), false);
    const sites = { 'video.example': 'allow' } as const;
    assert.equal(resolveAutoplay('https://www.video.example/x', 'sound', sites, true), 'allow');
    assert.equal(resolveAutoplay('https://news.example/x', 'sound', sites, true), 'all', 'B18 data saver hook');
    assert.equal(resolveAutoplay('https://news.example/x', 'allow', sites, false), 'allow');
    assert.equal(resolveAutoplay('https://news.example/x', DEFAULT_AUTOPLAY, {}, false), 'sound');
  });
});

/** A small page with HTMLMediaElement, events and navigator.userActivation for the page scripts. */
function fakePage() {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const nativePlays: unknown[] = [];
  class HTMLMediaElement {
    paused = true;
    _volume = 1;
    _muted = false;
    get volume() {
      return this._volume;
    }
    set volume(v: number) {
      this._volume = v;
    }
    get muted() {
      return this._muted;
    }
    set muted(v: boolean) {
      this._muted = v;
    }
    play() {
      nativePlays.push(this);
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  const activation = { isActive: false };
  const document = {
    addEventListener(type: string, fn: (event: unknown) => void) {
      (listeners[type] ??= []).push(fn);
    },
    querySelectorAll: () => [],
  };
  const window: Record<string, unknown> = {
    HTMLMediaElement,
    addEventListener: (type: string, fn: (event: unknown) => void) => (listeners[`w:${type}`] ??= []).push(fn),
  };
  const context = vm.createContext({
    window,
    document,
    HTMLMediaElement,
    navigator: { userActivation: activation },
    Promise,
    WeakSet,
    WeakMap,
    Date,
    Object,
    DOMException: class extends Error {
      constructor(message: string, name: string) {
        super(message);
        this.name = name;
      }
    },
    Error,
  });
  window.HTMLMediaElement = HTMLMediaElement;
  const run = (code: string) => vm.runInContext(code, context);
  const autoplayStarts = (el: InstanceType<typeof HTMLMediaElement>) => {
    el.paused = false;
    for (const fn of listeners.play ?? []) fn({ target: el });
  };
  return { HTMLMediaElement, activation, nativePlays, run, autoplayStarts };
}

describe('B14 Block all autoplay page script (node:vm)', () => {
  for (const order of ['autoplay first', 'tab audio first'] as const) {
    test(`nothing plays without a tap; a tap plays; works with B3's tab audio (${order})`, async () => {
      const page = fakePage();
      if (order === 'autoplay first') {
        page.run(AUTOPLAY_BLOCK_ALL_SCRIPT);
        page.run(tabAudioScript(false, 50));
      } else {
        page.run(tabAudioScript(false, 50));
        page.run(AUTOPLAY_BLOCK_ALL_SCRIPT);
      }
      const video = new page.HTMLMediaElement();
      await assert.rejects(Promise.resolve(video.play()), (error: Error) => error.name === 'NotAllowedError');
      assert.equal(page.nativePlays.length, 0);

      // A muted video starting by itself (the autoplay attribute) is paused at once.
      const muted = new page.HTMLMediaElement();
      muted.muted = true;
      page.autoplayStarts(muted);
      assert.equal(muted.paused, true);

      // With a tap, it plays — through B3's wrapper (volume at 50 %).
      page.activation.isActive = true;
      await video.play();
      assert.equal(page.nativePlays.length, 1);
      assert.equal(video._volume, 0.5, "B3's tab volume applied");
      // The same element may play again later without a new tap (resume, next track).
      page.activation.isActive = false;
      await video.play();
      assert.equal(page.nativePlays.length, 2);
    });
  }

  test('installed once per page; never throws without media support', () => {
    const page = fakePage();
    page.run(AUTOPLAY_BLOCK_ALL_SCRIPT);
    const wrapped = page.HTMLMediaElement.prototype.play;
    page.run(AUTOPLAY_BLOCK_ALL_SCRIPT);
    assert.equal(page.HTMLMediaElement.prototype.play, wrapped);
    assert.doesNotThrow(() => vm.runInContext(AUTOPLAY_BLOCK_ALL_SCRIPT, vm.createContext({ window: {} })));
  });
});

describe('B14 site blocker, time limits, focus mode', () => {
  const NOW = new Date(2026, 10, 9, 14, 30).getTime();
  const base: SiteLimitsState = {
    ...EMPTY_SITE_LIMITS,
    blockedSites: ['blocked.example'],
    timeLimits: { 'limited.example': 1 },
    usageDay: localDayKey(NOW),
    usage: {},
    focusSites: ['social.example'],
    focusEndsAt: null,
  };

  test('#276 a blocked site (and its subdomains) never opens; others do', () => {
    assert.deepEqual(siteBlockReason('https://m.blocked.example/a', base, NOW), { kind: 'blocked', site: 'blocked.example' });
    assert.equal(siteBlockReason('https://other.example/', base, NOW), null);
    assert.equal(siteBlockReason('vidorax://home', base, NOW), null);
  });

  test('#278 focus sites are blocked only until the timer ends', () => {
    const focus = { ...base, focusEndsAt: NOW + 25 * 60_000 };
    assert.deepEqual(siteBlockReason('https://social.example/', focus, NOW), {
      kind: 'focus',
      site: 'social.example',
      until: NOW + 25 * 60_000,
    });
    assert.equal(siteBlockReason('https://social.example/', focus, NOW + 25 * 60_000), null, 'ended');
    assert.equal(siteBlockReason('https://social.example/', base, NOW), null, 'focus off');
    assert.equal(nextChangeAt(focus, NOW), NOW + 25 * 60_000);
  });

  test('#277 a used-up daily limit blocks until midnight; a new day starts at zero', () => {
    const almost = withUsage(base, 'limited.example', 59, NOW);
    assert.equal(siteBlockReason('https://limited.example/', almost, NOW), null);
    const used = withUsage(almost, 'limited.example', 1, NOW);
    assert.equal(usedSeconds(used, 'limited.example', NOW), 60);
    assert.deepEqual(siteBlockReason('https://www.limited.example/x', used, NOW), {
      kind: 'time-limit',
      site: 'limited.example',
      minutes: 1,
      until: nextLocalMidnight(NOW),
    });
    assert.equal(nextChangeAt(used, NOW), nextLocalMidnight(NOW));
    const tomorrow = nextLocalMidnight(NOW) + 1000;
    assert.equal(siteBlockReason('https://limited.example/', used, tomorrow), null);
    const next = withUsage(used, 'limited.example', 5, tomorrow);
    assert.equal(next.usageDay, localDayKey(tomorrow));
    assert.equal(usedSeconds(next, 'limited.example', tomorrow), 5);
    assert.equal(timedSiteFor('https://a.limited.example/', base), 'limited.example');
  });

  test('the clock: gaps are capped (sleep, background) and never negative', () => {
    assert.equal(tickSeconds(null, NOW, 20_000), 0);
    assert.equal(tickSeconds(NOW - 15_000, NOW, 20_000), 15);
    assert.equal(tickSeconds(NOW - 3_600_000, NOW, 20_000), 20);
    assert.equal(tickSeconds(NOW + 5_000, NOW, 20_000), 0);
    assert.equal(withUsage(base, 'limited.example', -4, NOW).usage['limited.example'], 0);
  });

  test('local days and midnight; focus minute choices', () => {
    assert.equal(localDayKey(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05');
    assert.equal(nextLocalMidnight(new Date(2026, 0, 5, 23, 59).getTime()), new Date(2026, 0, 6).getTime());
    assert.equal(normalizeFocusMinutesChoice(1), '1');
    assert.equal(normalizeFocusMinutesChoice('7'), '25');
  });
});

describe('B14 native calls (only on a change; nothing while off)', () => {
  function driver() {
    const calls: unknown[][] = [];
    const api = {
      setContentBlocking: (...args: unknown[]) => void calls.push(['rules', ...args]),
      setBlockingPage: async (...args: unknown[]) => {
        calls.push(['page', ...args]);
        return true;
      },
      getBlockedCount: async (tag: number) => (tag === 1 ? 7 : -3),
    };
    return { calls, api };
  }

  test('off by default sends nothing; changes are sent once', () => {
    const { calls, api } = driver();
    const native = createBlockingNative(() => api);
    assert.equal(native.setRules(false, false, []), false);
    assert.equal(native.setPage(1, 'example.com'), false, 'no page while off');
    assert.equal(native.setRules(true, false, ['b.com', 'a.com']), true);
    assert.equal(native.setRules(true, false, ['a.com', 'b.com']), false, 'same set');
    assert.equal(native.setPage(1, 'example.com'), true);
    assert.equal(native.setPage(1, 'example.com'), false);
    assert.equal(native.setRules(false, false, []), true, 'turning off is sent');
    assert.equal(native.setPage(1, 'other.com'), false);
    assert.deepEqual(calls, [
      ['rules', true, false, ['b.com', 'a.com']],
      ['page', 1, 'https://example.com/'],
      ['rules', false, false, []],
    ]);
  });

  test('blocked count: a number ≥ 0; missing module or view → 0', async () => {
    const { api } = driver();
    const native = createBlockingNative(() => api);
    assert.equal(await native.blockedCount(1), 7);
    assert.equal(await native.blockedCount(2), 0);
    assert.equal(await native.blockedCount(null), 0);
    assert.equal(await createBlockingNative(() => null).blockedCount(1), 0);
  });
});
