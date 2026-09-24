import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import type {
  DownloadRecord,
  EnqueueRequest,
  ProbeFailure,
  ProbeRequest,
  ProbeResult,
} from '@modules/vidorax-media/src/VidoraMedia.types';

import type { DownloadStatus } from '@/api/types';

import type { V2EnginePort } from './engine-port';
import { handOffVerifiedVariant, resetV2HandoffForTests } from './handoff';
import type { V2DownloadEntry } from './projection';
import { downloadRecord, PAGE_URL, qualityOption, requestContext } from './test-fixtures';

const DOWNLOADABLE_HLS: ProbeResult = {
  ok: true,
  kind: 'hls',
  finalUrl: 'https://cdn.example/v/720/index.m3u8',
  contentType: 'application/vnd.apple.mpegurl',
  container: 'ts',
  sizeBytes: null,
  resumable: true,
  variants: [],
  audioTracks: [],
  durationMs: 60_000,
};

function refusal(reason: ProbeFailure, httpStatus: number | null = null): ProbeResult {
  return { ok: false, reason, httpStatus, message: null };
}

type Harness = {
  enqueued: EnqueueRequest[];
  probed: ProbeRequest[];
  applied: V2DownloadEntry[];
  statuses: Map<string, DownloadStatus>;
  current: boolean;
  deps: Parameters<typeof handOffVerifiedVariant>[1];
};

function harness(
  options: {
    enqueue?: (request: EnqueueRequest) => Promise<DownloadRecord>;
    probe?: (request: ProbeRequest) => Promise<ProbeResult>;
  } = {},
): Harness {
  const state: Harness = {
    enqueued: [],
    probed: [],
    applied: [],
    statuses: new Map(),
    current: true,
    deps: undefined as never,
  };
  const engine = {
    probe: async (request: ProbeRequest) => {
      state.probed.push(request);
      return options.probe ? options.probe(request) : DOWNLOADABLE_HLS;
    },
    enqueue: async (request: EnqueueRequest) => {
      state.enqueued.push(request);
      if (options.enqueue) {
        return options.enqueue(request);
      }
      const record = downloadRecord({ id: `dl-${state.enqueued.length}` });
      state.statuses.set(record.id, 'QUEUED');
      return record;
    },
  } as unknown as V2EnginePort;
  state.deps = {
    engine,
    applyEntries: (entries) => state.applied.push(...entries),
    statusOf: (id) => state.statuses.get(id) ?? null,
    isOfferCurrent: () => state.current,
  };
  return state;
}

const variant = {
  title: 'Instagram Reel',
  pageUrl: PAGE_URL,
  thumbnailUrl: null,
  requestContext: requestContext(),
};

beforeEach(() => {
  resetV2HandoffForTests();
});

describe('browser CTA → v2 DownloadEngine', () => {
  test('1: a single verified variant is enqueued exactly as verified', async () => {
    const h = harness();
    const option = qualityOption();
    const result = await handOffVerifiedVariant({ ...variant, option, variantKey: 'k1' }, h.deps);

    assert.equal(result.ok, true);
    assert.equal(h.enqueued.length, 1);
    const request = h.enqueued[0]!;
    assert.equal(request.url, option.sourceUrl, 'the exact verified source is handed over');
    assert.equal(request.kind, 'progressive');
    assert.equal(request.site, 'instagram');
    assert.equal(request.pageUrl, PAGE_URL);
    assert.equal(request.qualityLabel, '720p');
    assert.equal(request.estimatedBytes, 5_242_880);
    assert.equal(request.request.useCookies, true, 'native attaches cookies itself');
    assert.equal(request.request.referer, PAGE_URL);
    assert.ok(request.request.userAgent);
    assert.deepEqual(Object.keys(request.request.headers ?? {}), ['Accept'], 'no Cookie/Authorization/UA header');
    assert.equal(h.applied.length, 1, 'the accepted record is mirrored into Downloads immediately');
    assert.equal(h.applied[0]?.item.id, result.ok && result.downloadId);
  });

  test('2: with several qualities only the selected variant is enqueued', async () => {
    const h = harness();
    const selected = qualityOption({
      id: 'progressive-1080',
      label: '1080p',
      height: 1080,
      width: 1920,
      sourceUrl: 'https://scontent.cdninstagram.com/o/1080p?token=zzz',
    });
    await handOffVerifiedVariant({ ...variant, option: selected, variantKey: 'k1080' }, h.deps);

    assert.deepEqual(
      h.enqueued.map((request) => request.url),
      [selected.sourceUrl],
    );
    assert.equal(h.enqueued[0]?.qualityLabel, '1080p');
  });

  test('3: an offer that is no longer current is never enqueued', async () => {
    const h = harness();
    h.current = false;
    const result = await handOffVerifiedVariant({ ...variant, option: qualityOption(), variantKey: 'k1' }, h.deps);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'STALE_OFFER');
    assert.equal(h.enqueued.length, 0);
  });

  test('4: a rapid double tap enqueues once', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({
      enqueue: async () => {
        await gate;
        return downloadRecord({ id: 'dl-1' });
      },
    });
    const option = qualityOption();
    const first = handOffVerifiedVariant({ ...variant, option, variantKey: 'same' }, h.deps);
    const second = await handOffVerifiedVariant({ ...variant, option, variantKey: 'same' }, h.deps);
    release();
    const firstResult = await first;

    assert.equal(firstResult.ok, true);
    assert.equal(second.ok, false);
    assert.equal(!second.ok && second.reason, 'IN_FLIGHT');
    assert.equal(h.enqueued.length, 1);

    // A later tap on the same variant reuses the accepted download instead of starting a second one.
    h.statuses.set('dl-1', 'DOWNLOADING');
    const third = await handOffVerifiedVariant({ ...variant, option, variantKey: 'same' }, h.deps);
    assert.deepEqual(third, { ok: true, downloadId: 'dl-1', deduped: true });
    assert.equal(h.enqueued.length, 1);
  });

  test('5: audio-only, segments and blob sources never reach the engine', async () => {
    const cases: { option: ReturnType<typeof qualityOption>; reason: string }[] = [
      { option: qualityOption({ streamType: 'AUDIO', isAudioOnly: true, container: 'm4a', hasVideo: false, sourceUrl: 'https://cdn.example/a/track.m4a' }), reason: 'UNSUPPORTED_SOURCE' },
      { option: qualityOption({ sourceUrl: 'https://cdn.example/v/seg-00012.m4s' }), reason: 'UNSUPPORTED_SOURCE' },
      { option: qualityOption({ sourceUrl: 'blob:https://www.instagram.com/2b2f1b' }), reason: 'UNSUPPORTED_SOURCE' },
    ];
    for (const { option, reason } of cases) {
      const h = harness();
      const result = await handOffVerifiedVariant({ ...variant, option, variantKey: option.sourceUrl }, h.deps);
      assert.equal(result.ok, false, option.sourceUrl);
      assert.equal(!result.ok && result.reason, reason, option.sourceUrl);
      assert.equal(h.enqueued.length, 0, option.sourceUrl);
      assert.ok(!result.ok && result.message.length > 0, 'the user is told truthfully');
    }
  });

  test('a progressive variant is never re-probed at tap time (Phase 10 stays)', async () => {
    const h = harness();
    await handOffVerifiedVariant({ ...variant, option: qualityOption(), variantKey: 'k1' }, h.deps);
    assert.equal(h.probed.length, 0);
    assert.equal(h.enqueued.length, 1);
  });

  test('a non-downloadable option analysed as protected is refused as protected, not as "no longer available"', async () => {
    const h = harness();
    const option = qualityOption({ downloadable: false, unavailableReason: 'ENCRYPTED_MEDIA' });
    const result = await handOffVerifiedVariant({ ...variant, option, variantKey: 'drm' }, h.deps);
    assert.equal(!result.ok && result.reason, 'PROTECTED');
    assert.match(!result.ok ? result.message : '', /protected/);
    assert.equal(h.enqueued.length, 0);
  });

  test('an observed Origin travels in its own field; secrets never cross the bridge', async () => {
    const h = harness();
    const ctx = requestContext({
      headers: { Origin: 'https://www.example.com', Cookie: 'sid=SECRET', Authorization: 'Bearer SECRET', 'X-Requested-With': 'x' },
    });
    await handOffVerifiedVariant({ ...variant, requestContext: ctx, option: qualityOption(), variantKey: 'o' }, h.deps);
    const sent = h.enqueued[0]!.request;
    assert.equal(sent.origin, 'https://www.example.com');
    assert.deepEqual(Object.keys(sent.headers ?? {}), ['X-Requested-With']);
    assert.ok(!JSON.stringify(sent).includes('SECRET'));
  });

  test('a refused enqueue never falls back to another downloader', async () => {
    const h = harness({
      enqueue: async () => {
        throw Object.assign(new Error('blocked'), { code: 'ERR_POLICY_BLOCKED' });
      },
    });
    const result = await handOffVerifiedVariant({ ...variant, option: qualityOption(), variantKey: 'k1' }, h.deps);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'ENQUEUE_REJECTED');
    assert.equal(h.applied.length, 0);
  });
});

describe('Phase 12A — HLS goes to the engine only when the native classifier says DOWNLOADABLE', () => {
  const hls = (overrides: Partial<ReturnType<typeof qualityOption>> = {}) =>
    qualityOption({
      id: 'hls-720',
      label: '720p',
      streamType: 'HLS',
      isHls: true,
      isProgressive: false,
      container: 'hls',
      mimeType: 'application/vnd.apple.mpegurl',
      sourceUrl: 'https://cdn.example/v/720/index.m3u8?token=abc',
      height: 720,
      ...overrides,
    });

  test('a downloadable stream is classified once, then enqueued as hls exactly as verified', async () => {
    const h = harness();
    const option = hls();
    const result = await handOffVerifiedVariant({ ...variant, option, variantKey: 'hls' }, h.deps);

    assert.equal(result.ok, true);
    assert.equal(h.probed.length, 1);
    assert.equal(h.probed[0]!.kind, 'hls');
    assert.equal(h.probed[0]!.url, option.sourceUrl);
    assert.deepEqual(h.probed[0]!.request, h.enqueued[0]!.request, 'classified with the same session context');
    const request = h.enqueued[0]!;
    assert.equal(request.kind, 'hls');
    assert.equal(request.url, option.sourceUrl, 'the token-bearing playlist URL is kept as verified');
    assert.deepEqual(request.variant, { maxHeight: 720 }, 'a multivariant playlist resolves to the chosen quality');
    assert.deepEqual(h.probed[0]!.variant, request.variant, 'the chosen quality is the one classified');
    assert.equal(request.request.useCookies, true);
    assert.equal(request.qualityLabel, '720p');
  });

  const refusals: { failure: ProbeResult; reason: string; message: RegExp }[] = [
    { failure: refusal('DRM_PROTECTED'), reason: 'PROTECTED', message: /protected/ },
    { failure: refusal('LIVE_UNSUPPORTED'), reason: 'LIVE_UNSUPPORTED', message: /Live streams/ },
    { failure: refusal('UNSUPPORTED_FORMAT'), reason: 'UNSUPPORTED_SOURCE', message: /format/ },
    { failure: refusal('NOT_MEDIA'), reason: 'UNSUPPORTED_SOURCE', message: /format/ },
    { failure: refusal('HTTP_403', 403), reason: 'SOURCE_EXPIRED', message: /Open the video page again/ },
    { failure: refusal('HTTP_404', 404), reason: 'SOURCE_EXPIRED', message: /Open the video page again/ },
    { failure: refusal('NETWORK'), reason: 'SOURCE_UNREACHABLE', message: /connection/ },
    { failure: refusal('HTTP_ERROR', 503), reason: 'SOURCE_UNREACHABLE', message: /connection/ },
  ];
  for (const { failure, reason, message } of refusals) {
    test(`${!failure.ok && failure.reason} is refused as ${reason} and never enqueued`, async () => {
      const h = harness({ probe: async () => failure });
      const result = await handOffVerifiedVariant({ ...variant, option: hls(), variantKey: `r-${reason}` }, h.deps);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.reason, reason);
      assert.match(!result.ok ? result.message : '', message);
      assert.equal(h.enqueued.length, 0);
      assert.equal(h.applied.length, 0);
    });
  }

  test('a stream the page itself marked unavailable is still classified by native, truthfully', async () => {
    const h = harness({ probe: async () => refusal('LIVE_UNSUPPORTED') });
    const result = await handOffVerifiedVariant(
      { ...variant, option: hls({ downloadable: false, unavailableReason: null }), variantKey: 'live' },
      h.deps,
    );
    assert.equal(!result.ok && result.reason, 'LIVE_UNSUPPORTED');
  });

  test('an offer that changes while the stream is being classified is not enqueued', async () => {
    const h = harness({
      probe: async () => {
        h.current = false;
        return DOWNLOADABLE_HLS;
      },
    });
    const result = await handOffVerifiedVariant({ ...variant, option: hls(), variantKey: 'stale' }, h.deps);
    assert.equal(!result.ok && result.reason, 'STALE_OFFER');
    assert.equal(h.enqueued.length, 0);
  });

  test('a classifier error is reported, never swallowed into an enqueue', async () => {
    const h = harness({
      probe: async () => {
        throw Object.assign(new Error('bad'), { code: 'ERR_INVALID_REQUEST' });
      },
    });
    const result = await handOffVerifiedVariant({ ...variant, option: hls(), variantKey: 'err' }, h.deps);
    assert.equal(!result.ok && result.reason, 'ENQUEUE_REJECTED');
    assert.equal(h.enqueued.length, 0);
  });

  test('a media playlist URL without a known height is enqueued without a variant ceiling', async () => {
    const h = harness();
    await handOffVerifiedVariant(
      { ...variant, option: hls({ height: null, sourceUrl: 'https://cdn.example/live/x.m3u8' }), variantKey: 'nh' },
      h.deps,
    );
    assert.equal(h.enqueued[0]!.variant, undefined);
  });
});

describe('Phase 12B — DASH goes to the engine only when the native classifier says DOWNLOADABLE', () => {
  const DOWNLOADABLE_DASH: ProbeResult = {
    ok: true,
    kind: 'dash',
    finalUrl: 'https://cdn.example/d/manifest.mpd?sig=1',
    contentType: 'application/dash+xml',
    container: 'mp4',
    sizeBytes: 5_000_000,
    resumable: true,
    variants: [],
    audioTracks: [],
    durationMs: 10_000,
  };

  const dash = (overrides: Partial<ReturnType<typeof qualityOption>> = {}) =>
    qualityOption({
      id: 'dash-720',
      label: '720p',
      streamType: 'DASH',
      isHls: false,
      isProgressive: false,
      container: 'mp4',
      mimeType: 'video/mp4',
      sourceUrl: 'https://cdn.example/d/manifest.mpd?sig=1',
      height: 720,
      representationId: 'av-720',
      ...overrides,
    });

  test('a downloadable quality is classified for its exact representation, then enqueued as dash', async () => {
    const h = harness({ probe: async () => DOWNLOADABLE_DASH });
    const option = dash();
    const result = await handOffVerifiedVariant({ ...variant, option, variantKey: 'dash' }, h.deps);

    assert.equal(result.ok, true);
    assert.equal(h.probed.length, 1);
    assert.equal(h.probed[0]!.kind, 'dash');
    assert.equal(h.probed[0]!.url, option.sourceUrl);
    const request = h.enqueued[0]!;
    assert.equal(request.kind, 'dash');
    assert.equal(request.url, option.sourceUrl, 'the manifest URL, never a representation file URL that can expire');
    assert.deepEqual(request.variant, { videoId: 'av-720', maxHeight: 720 }, 'the exact representation the user picked');
    assert.deepEqual(h.probed[0]!.variant, request.variant, 'the representation classified is the one enqueued');
    assert.deepEqual(h.probed[0]!.request, request.request, 'classified with the same session context');
  });

  const refusals: { failure: ProbeResult; reason: string }[] = [
    { failure: refusal('DRM_PROTECTED'), reason: 'PROTECTED' },
    { failure: refusal('LIVE_UNSUPPORTED'), reason: 'LIVE_UNSUPPORTED' },
    { failure: refusal('UNSUPPORTED_FORMAT'), reason: 'UNSUPPORTED_SOURCE' },
    { failure: refusal('NETWORK'), reason: 'SOURCE_UNREACHABLE' },
    { failure: refusal('HTTP_ERROR', 503), reason: 'SOURCE_UNREACHABLE' },
    { failure: refusal('HTTP_403', 403), reason: 'SOURCE_EXPIRED' },
  ];
  for (const { failure, reason } of refusals) {
    test(`DASH ${!failure.ok && failure.reason} is refused as ${reason} and never enqueued`, async () => {
      const h = harness({ probe: async () => failure });
      const result = await handOffVerifiedVariant({ ...variant, option: dash(), variantKey: `d-${reason}` }, h.deps);
      assert.equal(!result.ok && result.reason, reason);
      assert.equal(h.enqueued.length, 0);
    });
  }

  test('an MPD the page analysed as a plain file is still classified as DASH before anything is enqueued', async () => {
    // The typical case: separate audio and video tracks, which only muxing could turn into one file.
    const h = harness({ probe: async () => refusal('UNSUPPORTED_FORMAT') });
    const option = qualityOption({ sourceUrl: 'https://cdn.example/v/manifest.mpd' });
    const result = await handOffVerifiedVariant({ ...variant, option, variantKey: 'mpd-as-file' }, h.deps);

    assert.equal(!result.ok && result.reason, 'UNSUPPORTED_SOURCE');
    assert.equal(h.probed[0]!.kind, 'dash');
    assert.equal(h.enqueued.length, 0);
  });

  test('a quality without a representation id is classified and enqueued by its height ceiling', async () => {
    const h = harness({ probe: async () => DOWNLOADABLE_DASH });
    await handOffVerifiedVariant({ ...variant, option: dash({ representationId: null }), variantKey: 'noid' }, h.deps);
    assert.deepEqual(h.enqueued[0]!.variant, { maxHeight: 720 });
  });
});
