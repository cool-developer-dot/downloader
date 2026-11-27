import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { buildMediaDetectionInjectedScript } from './injected-script.ts';

/**
 * Vimeo plays split DASH through MediaSource (nothing whole to save), but its own player config names an HLS master the
 * engine downloads. These tests run the observer's Vimeo block, cut from the injected script, against a fake page.
 */
type Candidate = Record<string, unknown>;

const HLS =
  'https://vod-adaptive-ak.vimeocdn.com/exp=1~acl=x~hmac=y/2c7ff520/psid=z/v2/playlist/av/primary/sub/325400372-en-x-autogen/prot/cXNyPTE/playlist.m3u8?ext-subs=1&locale=en&sf=fmp4';
const DASH = 'https://vod-adaptive-ak.vimeocdn.com/exp=1~acl=x~hmac=y/2c7ff520/psid=z/v2/playlist/av/primary/prot/cXNyPTE/playlist.json?omit=opus';
const DRM_HLS =
  'https://vod-adaptive-ak.vimeocdn.com/exp=1~acl=x~hmac=y/ccfaa6de/psid=z/drm/cbcs,derivedv2,ccfaa6de,ed7e/av/primary/playlist.m3u8';

function config(overrides: { hls?: string | null; dash?: string; title?: string; id?: number; drm?: unknown } = {}) {
  const hls = overrides.hls === undefined ? HLS : overrides.hls;
  return {
    request: {
      ...(overrides.drm ? { drm: overrides.drm } : {}),
      files: {
        progressive: [],
        ...(hls ? { hls: { default_cdn: 'akfire_interconnect_quic', separate_av: true, cdns: { akfire_interconnect_quic: { url: hls } } } } : {}),
        dash: { default_cdn: 'akfire_interconnect_quic', separate_av: true, cdns: { akfire_interconnect_quic: { url: overrides.dash ?? DASH } } },
      },
    },
    video: {
      id: overrides.id ?? 1222284165,
      title: overrides.title ?? '"Where\'s Dinner?" Surreal Horror Short Film',
      duration: 344,
      width: 1920,
      height: 1440,
      thumbs: { base: 'https://i.vimeocdn.com/video/2088-d', '640': 'https://i.vimeocdn.com/video/2088-d_640', '1280': 'https://i.vimeocdn.com/video/2088-d_1280' },
    },
  };
}

function loadVimeo(page: { host?: string; playerConfig?: unknown; resources?: string[]; fetchResult?: unknown }) {
  const script = buildMediaDetectionInjectedScript();
  const start = script.indexOf('  // ---- Vimeo player config');
  const end = script.indexOf('  // ---- end Vimeo player config ----');
  assert.ok(start > 0 && end > start, 'the Vimeo block is in the observer');
  const sent: Candidate[] = [];
  const fetched: string[] = [];
  const host = page.host ?? 'vimeo.com';
  const context = vm.createContext({
    URL,
    JSON,
    Math,
    String,
    Object,
    location: { hostname: host },
    document: { title: 'Fallback title | Vimeo' },
    pageUrl: `https://${host}/1222284165`,
    enqueue: (c: Candidate) => sent.push(c),
    safeUrl: (u: unknown) => (typeof u === 'string' && /^https?:\/\//.test(u) ? u : null),
    performance: { getEntriesByType: () => (page.resources ?? []).map((name) => ({ name })) },
    window: {
      playerConfig: page.playerConfig,
      performance: {},
      fetch: (u: string) => {
        fetched.push(u);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(page.fetchResult ?? null) });
      },
    },
  });
  vm.runInContext(script.slice(start, end), context);
  return {
    sent,
    fetched,
    fromConfig: context.vimeoFromConfig as (cfg: unknown) => boolean,
    harvest: context.harvestVimeoConfig as () => void,
    isConfigUrl: context.isVimeoConfigUrl as (u: unknown) => boolean,
  };
}

describe('Vimeo player config → the HLS master', () => {
  it('a player page (window.playerConfig) reports the HLS master with the real title, length, size and thumbnail', () => {
    const page = loadVimeo({ host: 'player.vimeo.com', playerConfig: config() });
    page.harvest();
    assert.equal(page.sent.length, 1);
    const c = page.sent[0]!;
    assert.equal(c.url, HLS);
    assert.equal(c.mimeType, 'application/x-mpegurl');
    assert.equal(c.playlistType, 'master');
    assert.equal(c.title, '"Where\'s Dinner?" Surreal Horror Short Film');
    assert.equal(c.duration, 344);
    assert.equal(c.width, 1920);
    assert.equal(c.thumbnailUrl, 'https://i.vimeocdn.com/video/2088-d_640', 'a sized thumbnail, not the full-size original');
    assert.equal(c.isDrm, false);
    assert.equal(c.detectionSource, 'js_fetch');
  });

  it('the same config twice is reported once', () => {
    const page = loadVimeo({ playerConfig: config() });
    page.harvest();
    page.harvest();
    assert.equal(page.fromConfig(config()), false);
    assert.equal(page.sent.length, 1);
  });

  it('a DRM config is reported as encrypted (stream under /drm/, or a drm block)', () => {
    const byPath = loadVimeo({});
    byPath.fromConfig(config({ hls: DRM_HLS }));
    assert.equal(byPath.sent[0]!.isDrm, true);
    const byBlock = loadVimeo({});
    byBlock.fromConfig(config({ drm: { widevine: {} }, id: 5 }));
    assert.equal(byBlock.sent[0]!.isDrm, true);
    const byDash = loadVimeo({});
    byDash.fromConfig(config({ dash: 'https://x.vimeocdn.com/drm/cenc/av/primary/playlist.mpd', id: 6 }));
    assert.equal(byDash.sent[0]!.isDrm, true);
  });

  it('a config without HLS, or garbage, reports nothing', () => {
    const page = loadVimeo({});
    assert.equal(page.fromConfig(config({ hls: null })), false);
    assert.equal(page.fromConfig(null), false);
    assert.equal(page.fromConfig({ request: {} }), false);
    assert.equal(page.fromConfig('nope'), false);
    assert.equal(page.sent.length, 0);
  });

  it('a current config (one full-size video.thumbnail_url, no thumbs) gives its 640 px size', () => {
    const page = loadVimeo({});
    const base = config();
    page.fromConfig({ ...base, video: { ...base.video, thumbs: undefined, thumbnail_url: 'https://i.vimeocdn.com/video/1209021665-f56ae1-d' } });
    assert.equal(page.sent[0]!.thumbnailUrl, 'https://i.vimeocdn.com/video/1209021665-f56ae1-d_640');
  });

  it('a missing title falls back to the page title', () => {
    const page = loadVimeo({});
    page.fromConfig(config({ title: '   ' }));
    assert.equal(page.sent[0]!.title, 'Fallback title | Vimeo');
  });

  it('vimeo.com: a config the player loaded before injection is fetched again from the resource list, once', async () => {
    const cfgUrl = 'https://player.vimeo.com/video/1222284165/config?autoplay=1&h=2c61799295&s=abc';
    const page = loadVimeo({ resources: ['https://f.vimeocdn.com/p/x.js', cfgUrl], fetchResult: config() });
    page.harvest();
    page.harvest();
    assert.deepEqual(page.fetched, [cfgUrl]);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(page.sent.length, 1);
    assert.equal(page.sent[0]!.url, HLS);
  });

  it('never runs off Vimeo', () => {
    const page = loadVimeo({ host: 'example.com', playerConfig: config(), resources: ['https://player.vimeo.com/video/1/config'] });
    page.harvest();
    assert.equal(page.sent.length, 0);
    assert.equal(page.fetched.length, 0);
  });

  it('recognises only player.vimeo.com/video/<id>/config', () => {
    const page = loadVimeo({});
    assert.equal(page.isConfigUrl('https://player.vimeo.com/video/1222284165/config?h=1'), true);
    assert.equal(page.isConfigUrl('https://player.vimeo.com/video/1222284165'), false);
    assert.equal(page.isConfigUrl('https://player.vimeo.com/video/abc/config'), false);
    assert.equal(page.isConfigUrl('https://evil.com/player.vimeo.com/video/1/config'), false);
    assert.equal(page.isConfigUrl(null), false);
  });
});
