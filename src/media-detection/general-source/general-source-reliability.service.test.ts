import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { classifyMediaResolutionOutcome } from '@/browser/media-actions/media-resolution-outcome';

import type { MediaRequestContext } from '@/downloads/types/request-context';

import type { ProbeRequest, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import { isStandaloneDownloadableQuality } from '@/browser/media-actions/verified-quality-options';
import { normalizeAnalysisToSelection } from '@/downloads/quality';
import { buildV2EnqueueRequest } from '@/downloads/v2/enqueue-request';
import { setV2EngineForTests, type V2EnginePort } from '@/downloads/v2/engine-port';

import { generalPageMediaContextStore } from '../general-media';
import type { DetectedMedia } from '../types';
import {
  buildVerifiedGeneralMediaOffer,
  dashRejectionFor,
  generalOfferToAnalysis,
  progressiveRefusalFor,
  verifyGeneralSourceCandidate,
} from './general-source-reliability.service';
import type { VerifiedGeneralMediaOffer } from './types';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  setV2EngineForTests(null);
});

/** A native classifier stand-in: records what it was asked and answers with [answer]. */
function fakeClassifier(answer: ProbeResult | ((request: ProbeRequest) => Promise<ProbeResult>)): ProbeRequest[] {
  const asked: ProbeRequest[] = [];
  setV2EngineForTests({
    probe: async (request: ProbeRequest) => {
      asked.push(request);
      return typeof answer === 'function' ? answer(request) : answer;
    },
  } as unknown as V2EnginePort);
  return asked;
}

/** A fetch stand-in serving [routes] by URL prefix (Range honoured for bytes); anything else is a test failure. */
function serveRoutes(routes: Record<string, { body: string | Uint8Array<ArrayBuffer>; type: string }>): string[] {
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    requests.push(`${method} ${url}`);
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!route) {
      throw new Error(`unexpected request ${method} ${url}`);
    }
    const bytes = typeof route.body === 'string' ? new TextEncoder().encode(route.body) : route.body;
    const range = /bytes=(\d+)-(\d*)/.exec(new Headers(init?.headers).get('Range') ?? '');
    const common = { 'Content-Type': route.type, 'Accept-Ranges': 'bytes' };
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(bytes.length - 1, range[2] ? Number(range[2]) : bytes.length - 1);
      return new Response(method === 'HEAD' ? null : bytes.slice(start, end + 1), {
        status: 206,
        headers: { ...common, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': String(end - start + 1) },
      });
    }
    return new Response(method === 'HEAD' ? null : bytes, { status: 200, headers: { ...common, 'Content-Length': String(bytes.length) } });
  }) as typeof fetch;
  return requests;
}

function mp4Box(type: string, size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i += 1) bytes[4 + i] = type.charCodeAt(i);
  return bytes;
}

/** ftyp + moov + mdat: a complete file by its structure, whatever its tracks are. */
function completeMp4(): Uint8Array<ArrayBuffer> {
  const ftyp = mp4Box('ftyp', 32);
  new TextEncoder().encodeInto('isom\0\0\x02\0isomiso2avc1mp41', ftyp.subarray(8));
  const parts = [ftyp, mp4Box('moov', 2_000), mp4Box('mdat', 150_000)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const media = {
  id: 'm1',
  url: 'https://edge7.cdnhost.net/o/9f3a1c?token=abc',
  finalUrl: 'https://edge7.cdnhost.net/o/9f3a1c?token=abc',
  sourceUrl: 'https://edge7.cdnhost.net/o/9f3a1c?token=abc',
  pageUrl: 'https://news.example.org/story/42',
  category: 'video',
  streamType: 'DIRECT',
  container: 'unknown',
} as unknown as DetectedMedia;

describe('offer publication requires current-content ownership', () => {
  for (const ownershipConfidence of ['WEAK', 'REJECTED', null] as const) {
    test(`${ownershipConfidence ?? 'no'} ownership never publishes and never probes the network`, async () => {
      let fetched = 0;
      globalThis.fetch = (async () => {
        fetched += 1;
        throw new Error('must not probe');
      }) as typeof fetch;
      const result = await buildVerifiedGeneralMediaOffer({
        scope: {
          tabId: 'tab-1',
          navigationEpoch: 0,
          pageGeneration: 1,
          mediaIdentity: 'general:page',
          ownershipConfidence,
        },
        candidates: [media],
        pageUrl: media.pageUrl,
      });
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.reason, 'WEAK_OWNERSHIP');
      assert.equal(fetched, 0);
    });
  }

  test('awaiting ownership is transient, never proven unsupported', () => {
    const outcome = classifyMediaResolutionOutcome({
      rejectionReason: 'WEAK_OWNERSHIP',
      hasCandidates: true,
      allBoundedCandidatesRejected: true,
    });
    assert.equal(outcome.kind, 'TRANSIENT_UNRESOLVED');
  });
});

describe('an HLS manifest that cannot be read right now is a temporary failure, never proven unsupported', () => {
  const url = 'https://edge7.cdnhost.net/hls/9f3a1c/master.m3u8?sec=abc';
  const hls = { ...media, url, finalUrl: url, sourceUrl: url, streamType: 'HLS', container: 'hls', mimeType: 'application/vnd.apple.mpegurl' } as unknown as DetectedMedia;
  const verify = () =>
    verifyGeneralSourceCandidate(hls, {
      pageUrl: media.pageUrl,
      requestContext: { pageUrl: media.pageUrl, referer: media.pageUrl, userAgent: null, cookiesRequired: false, hasCookies: false, headers: {}, capturedAt: Date.now() },
      mediaIdentity: 'general:page',
      sourceGeneration: 1,
    });
  const expectTransient = (reason: string) => {
    const outcome = classifyMediaResolutionOutcome({ rejectionReason: reason, hasCandidates: true, allBoundedCandidatesRejected: true });
    assert.notEqual(outcome.kind, 'PROVEN_UNSUPPORTED');
  };

  test('the network failing (or the bounded fetch timing out)', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;
    const result = await verify();
    assert.equal(!result.ok && result.reason, 'PROBE_FAILED');
    expectTransient('PROBE_FAILED');
  });

  for (const status of [500, 503, 408, 429]) {
    test(`an HTTP ${status}`, async () => {
      globalThis.fetch = (async () => new Response('busy', { status, headers: { 'Content-Type': 'text/plain' } })) as typeof fetch;
      const result = await verify();
      assert.equal(!result.ok && result.reason, 'PROBE_FAILED');
    });
  }

  test('a body that is not a playlist is still invalid', async () => {
    serveRoutes({ [url]: { type: 'application/xml', body: '<?xml version="1.0"?><vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap"/>' } });
    const result = await verify();
    assert.equal(!result.ok && result.reason, 'MANIFEST_INVALID');
  });

  test('a 404 is not treated as temporary', async () => {
    globalThis.fetch = (async () => new Response('gone', { status: 404, headers: { 'Content-Type': 'text/plain' } })) as typeof fetch;
    const result = await verify();
    assert.equal(!result.ok && result.reason, 'MANIFEST_INVALID');
  });
});

describe('owned but unsupported media never becomes an offer (10)', () => {
  const requestContext: MediaRequestContext = {
    pageUrl: media.pageUrl,
    referer: media.pageUrl,
    userAgent: null,
    cookiesRequired: false,
    hasCookies: false,
    headers: {},
    capturedAt: Date.now(),
  };
  const verify = (candidate: DetectedMedia) =>
    verifyGeneralSourceCandidate(candidate, {
      pageUrl: media.pageUrl,
      requestContext,
      mediaIdentity: 'general:page',
      sourceGeneration: 1,
    });
  const expectProvenUnsupported = (reason: string) => {
    const outcome = classifyMediaResolutionOutcome({
      rejectionReason: reason,
      hasCandidates: true,
      allBoundedCandidatesRejected: true,
    });
    assert.equal(outcome.kind, 'PROVEN_UNSUPPORTED');
  };

  test('DRM', async () => {
    const result = await verify({ ...media, isDrm: true } as DetectedMedia);
    assert.equal(!result.ok && result.reason, 'DRM_UNSUPPORTED');
    expectProvenUnsupported('DRM_UNSUPPORTED');
  });

  test('isolated init segment (caught by the segment rule first)', async () => {
    const url = 'https://edge7.cdnhost.net/o/9f3a1c/init.mp4';
    const result = await verify({ ...media, url, finalUrl: url, sourceUrl: url } as DetectedMedia);
    assert.equal(!result.ok && result.reason, 'SEGMENT_RESOURCE');
    expectProvenUnsupported('SEGMENT_RESOURCE');
  });

  test('segmented DASH with separate audio (needs segment download + A/V mux)', async () => {
    // The native classifier's verdict for a SegmentTemplate manifest with a separate audio adaptation set.
    const asked = fakeClassifier({ ok: false, reason: 'UNSUPPORTED_FORMAT', httpStatus: null, message: 'separate audio and video' });
    const url = 'https://edge7.cdnhost.net/o/9f3a1c/manifest.mpd';
    // Read only after the refusal, and only for the whole files it names — segment templates name none.
    const fetched = serveRoutes({
      [url]: {
        type: 'application/dash+xml',
        body: `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period>
          <AdaptationSet mimeType="video/mp4"><SegmentTemplate media="v/$Number$.m4s" initialization="v/init.mp4"/>
            <Representation id="v1" bandwidth="1" width="1280" height="720"/></AdaptationSet>
          <AdaptationSet mimeType="audio/mp4"><SegmentTemplate media="a/$Number$.m4s" initialization="a/init.mp4"/>
            <Representation id="a1" bandwidth="1"/></AdaptationSet></Period></MPD>`,
      },
    });
    const result = await verify({ ...media, url, finalUrl: url, sourceUrl: url, streamType: 'DASH', container: 'dash' } as DetectedMedia);
    assert.equal(!result.ok && result.reason, 'DASH_UNSUPPORTED');
    assert.deepEqual(!result.ok && result.claimedFiles, []);
    assert.equal(asked[0]?.kind, 'dash', 'the verdict is the engine’s');
    assert.deepEqual(fetched, [`GET ${url}`]);
    expectProvenUnsupported('DASH_UNSUPPORTED');
  });
});

describe('Phase 12B — DASH is classified by the native engine, never by a JavaScript parser', () => {
  const manifestUrl = 'https://edge7.cdnhost.net/v/clip/manifest.mpd?sig=1';
  const dashMedia = {
    ...media,
    url: manifestUrl,
    finalUrl: manifestUrl,
    sourceUrl: manifestUrl,
    streamType: 'DASH',
    container: 'dash',
    mimeType: 'application/dash+xml',
  } as unknown as DetectedMedia;
  const requestContext: MediaRequestContext = {
    pageUrl: media.pageUrl,
    referer: media.pageUrl,
    userAgent: 'Mozilla/5.0 (Linux; Android 15)',
    cookiesRequired: false,
    hasCookies: false,
    headers: {},
    capturedAt: Date.now(),
  };
  const verifyDash = () =>
    verifyGeneralSourceCandidate(dashMedia, {
      pageUrl: media.pageUrl,
      requestContext,
      mediaIdentity: 'general:dash-page',
      sourceGeneration: 1,
    });
  const downloadable: ProbeResult = {
    ok: true,
    kind: 'dash',
    finalUrl: manifestUrl,
    contentType: 'application/dash+xml',
    container: 'mp4',
    sizeBytes: 9_000_000,
    resumable: true,
    variants: [
      { id: 'av-1080', width: 1920, height: 1080, bitrate: 5_000_000, frameRate: 30, videoCodec: 'avc1.640028', needsAudioMux: false, estimatedBytes: 6_250_000, decodable: true },
      { id: 'av-720', width: 1280, height: 720, bitrate: 2_500_000, frameRate: 30, videoCodec: 'avc1.64001f', needsAudioMux: false, estimatedBytes: 3_125_000, decodable: true },
    ],
    audioTracks: [{ id: 'av-1080:audio', language: 'en', label: null, bitrate: null, codec: 'mp4a.40.2', isDefault: true }],
    durationMs: 10_000,
  };

  test('downloadable DASH becomes one quality per representation, ready to enqueue as that representation', async () => {
    const asked = fakeClassifier(downloadable);
    const fetched = serveRoutes({
      'https://edge7.cdnhost.net/v/clip/manifest.mpd': {
        type: 'application/dash+xml',
        body: `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period><AdaptationSet mimeType="video/mp4">
          <Representation id="av-1080" bandwidth="5000000" width="1920" height="1080"><BaseURL>av-1080.mp4</BaseURL></Representation>
          <Representation id="av-720" bandwidth="2500000" width="1280" height="720"><BaseURL>av-720.mp4</BaseURL></Representation>
        </AdaptationSet></Period></MPD>`,
      },
    });
    const result = await verifyDash();

    // Read once for the files its qualities cover, so they are never offered a second time on their own.
    assert.deepEqual(fetched, [`GET ${manifestUrl}`]);
    assert.deepEqual(result.claimedFiles, ['https://edge7.cdnhost.net/v/clip/av-1080.mp4', 'https://edge7.cdnhost.net/v/clip/av-720.mp4']);
    assert.equal(asked.length, 1);
    assert.equal(asked[0]!.kind, 'dash');
    assert.equal(asked[0]!.url, manifestUrl);
    assert.equal(asked[0]!.request.referer, media.pageUrl);
    assert.equal(result.ok, true);
    const variants = result.ok ? result.variants : [];
    assert.deepEqual(variants.map((v) => v.representationId), ['av-1080', 'av-720']);
    assert.ok(variants.every((v) => v.transport === 'dash' && v.executableUrl === manifestUrl && v.container === 'mp4'));
    assert.ok(variants.every((v) => v.downloadable && v.audioState === 'INCLUDED'));
    assert.notEqual(variants[0]!.variantId, variants[1]!.variantId, 'one manifest, two distinct downloads');

    // offer → analysis → quality options → enqueue request: the representation survives every step.
    const offer = { variants } as unknown as VerifiedGeneralMediaOffer;
    const analysis = generalOfferToAnalysis(offer, variants[0]!, dashMedia);
    const options = normalizeAnalysisToSelection(analysis).options;
    const picked = options.find((option) => option.representationId === 'av-720')!;
    assert.equal(picked.streamType, 'DASH');
    assert.equal(picked.container, 'mp4', 'the representation file, not "dash"');
    assert.equal(picked.label, '720p');
    assert.equal(isStandaloneDownloadableQuality(picked), true);
    const decision = buildV2EnqueueRequest({ option: picked, title: 'Clip', pageUrl: media.pageUrl, thumbnailUrl: null, requestContext });
    assert.equal(decision.ok, true);
    const request = decision.ok ? decision.request : null;
    assert.equal(request?.kind, 'dash');
    assert.equal(request?.url, manifestUrl);
    assert.deepEqual(request?.variant, { videoId: 'av-720', maxHeight: 720 });
  });

  const verdicts: { answer: ProbeResult; reason: string; outcome: string }[] = [
    { answer: { ok: false, reason: 'DRM_PROTECTED', httpStatus: null, message: null }, reason: 'DRM_UNSUPPORTED', outcome: 'PROVEN_UNSUPPORTED' },
    { answer: { ok: false, reason: 'LIVE_UNSUPPORTED', httpStatus: null, message: null }, reason: 'LIVE_UNSUPPORTED', outcome: 'PROVEN_UNSUPPORTED' },
    { answer: { ok: false, reason: 'UNSUPPORTED_FORMAT', httpStatus: null, message: null }, reason: 'DASH_UNSUPPORTED', outcome: 'PROVEN_UNSUPPORTED' },
    { answer: { ok: false, reason: 'NETWORK', httpStatus: null, message: null }, reason: 'PROBE_FAILED', outcome: 'NETWORK_FAILURE' },
    { answer: { ok: false, reason: 'HTTP_ERROR', httpStatus: 503, message: null }, reason: 'PROBE_FAILED', outcome: 'NETWORK_FAILURE' },
  ];
  for (const { answer, reason, outcome } of verdicts) {
    test(`native ${!answer.ok && answer.reason} → ${reason} → ${outcome}`, async () => {
      fakeClassifier(answer);
      const fetched = serveRoutes({ 'https://edge7.cdnhost.net/v/clip/': { type: 'application/dash+xml', body: '<MPD/>' } });
      const result = await verifyDash();
      assert.equal(!result.ok && result.reason, reason);
      const resolved = classifyMediaResolutionOutcome({ rejectionReason: reason, hasCandidates: true, allBoundedCandidatesRejected: true });
      assert.equal(resolved.kind, outcome, 'a temporary failure is never reported as "cannot be downloaded"');
      // Only a refusal for what the stream is reads it (for the files it names); a temporary one claims nothing.
      assert.equal(fetched.length, outcome === 'PROVEN_UNSUPPORTED' ? 1 : 0);
    });
  }

  test('the verdict mapping covers every native failure', () => {
    assert.equal(dashRejectionFor('HTTP_403'), 'AUTH_REQUIRED');
    assert.equal(dashRejectionFor('HTTP_404'), 'EXPIRED_SOURCE');
    assert.equal(dashRejectionFor('NOT_MEDIA'), 'DASH_UNSUPPORTED');
    assert.equal(dashRejectionFor('POLICY_BLOCKED'), 'DASH_UNSUPPORTED');
  });

  test('a classifier that throws is a temporary failure; a build without the engine cannot download DASH', async () => {
    fakeClassifier(async () => {
      throw new Error('bridge down');
    });
    assert.equal(await verifyDash().then((r) => !r.ok && r.reason), 'PROBE_FAILED');

    setV2EngineForTests(null);
    assert.equal(await verifyDash().then((r) => !r.ok && r.reason), 'DASH_UNSUPPORTED');
  });
});

describe('Phase 12B — the engine’s classifier has the last word before a file is offered', () => {
  // A file a page's player fetched directly: complete by its structure, so the JavaScript check accepts it.
  const fileUrl = 'https://edge7.cdnhost.net/o/9f3a1c/a.mp4';
  const file = { ...media, url: fileUrl, finalUrl: fileUrl, sourceUrl: fileUrl, extension: 'mp4', detectedAt: Date.now() } as unknown as DetectedMedia;
  const requestContext: MediaRequestContext = {
    pageUrl: media.pageUrl,
    referer: media.pageUrl,
    userAgent: null,
    cookiesRequired: false,
    hasCookies: false,
    headers: {},
    capturedAt: Date.now(),
  };
  const verifyFile = () =>
    verifyGeneralSourceCandidate(file, { pageUrl: media.pageUrl, requestContext, mediaIdentity: 'general:file', sourceGeneration: 1 });

  test('a file the engine refuses for what it is (audio only) never becomes an offer', async () => {
    serveRoutes({ [fileUrl]: { type: 'video/mp4', body: completeMp4() } });
    const asked = fakeClassifier({ ok: false, reason: 'UNSUPPORTED_FORMAT', httpStatus: null, message: 'Audio only: the file has no video track' });

    const result = await verifyFile();

    assert.equal(!result.ok && result.reason, 'UNSUPPORTED_FORMAT');
    assert.deepEqual(asked.map((r) => [r.kind, r.url]), [['progressive', fileUrl]]);
    const outcome = classifyMediaResolutionOutcome({ rejectionReason: 'UNSUPPORTED_FORMAT', hasCandidates: true, allBoundedCandidatesRejected: true });
    assert.equal(outcome.kind, 'PROVEN_UNSUPPORTED');
  });

  test('a temporary engine answer, or a build without the engine, leaves the verified file offered', async () => {
    serveRoutes({ [fileUrl]: { type: 'video/mp4', body: completeMp4() } });
    fakeClassifier({ ok: false, reason: 'HTTP_ERROR', httpStatus: 503, message: null });
    assert.equal((await verifyFile()).ok, true, 'the download itself retries a 503');

    setV2EngineForTests(null);
    assert.equal((await verifyFile()).ok, true);
  });

  test('only refusals for what the file is block an offer', () => {
    assert.equal(progressiveRefusalFor('UNSUPPORTED_FORMAT'), 'UNSUPPORTED_FORMAT');
    assert.equal(progressiveRefusalFor('DRM_PROTECTED'), 'DRM_UNSUPPORTED');
    assert.equal(progressiveRefusalFor('LIVE_UNSUPPORTED'), 'LIVE_UNSUPPORTED');
    assert.equal(progressiveRefusalFor('NOT_MEDIA'), 'NOT_MEDIA');
    assert.equal(progressiveRefusalFor('POLICY_BLOCKED'), 'UNSUPPORTED_TRANSPORT');
    for (const transient of ['NETWORK', 'HTTP_ERROR', 'HTTP_403', 'HTTP_404'] as const) {
      assert.equal(progressiveRefusalFor(transient), null, transient);
    }
  });
});

describe('Phase 12B — a DASH manifest’s files follow its verdict: never offered on their own', () => {
  const pageUrl = 'https://video.example.org/watch/split';
  const base = 'https://edge7.cdnhost.net/v/split/';
  const manifestUrl = `${base}manifest.mpd?sig=m`;
  // What a player fetches of a split stream: the manifest, then each half by byte range, with its own query.
  const candidate = (url: string, extra: Record<string, unknown> = {}) =>
    ({ ...media, id: url, url, finalUrl: url, sourceUrl: url, pageUrl, extension: 'mp4', detectedAt: Date.now(), ...extra }) as unknown as DetectedMedia;
  const videoHalf = candidate(`${base}v-720.mp4?bytestart=0&byteend=956`);
  const audioHalf = candidate(`${base}a.mp4?bytestart=0&byteend=784`);
  const manifest = candidate(manifestUrl, { streamType: 'DASH', container: 'dash', mimeType: 'application/dash+xml', extension: 'mpd' });
  const splitMpd = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><Period>
  <AdaptationSet mimeType="video/mp4" contentType="video">
    <Representation id="v-720" bandwidth="1500000" width="1280" height="720" codecs="avc1.4d401f">
      <BaseURL>v-720.mp4</BaseURL><SegmentBase indexRange="797-956"><Initialization range="0-796"/></SegmentBase>
    </Representation>
  </AdaptationSet>
  <AdaptationSet mimeType="audio/mp4" contentType="audio">
    <Representation id="a-128" bandwidth="128000" codecs="mp4a.40.2">
      <BaseURL>a.mp4</BaseURL><SegmentBase indexRange="733-784"><Initialization range="0-732"/></SegmentBase>
    </Representation>
  </AdaptationSet>
</Period></MPD>`;

  function currentScope(tabId: string) {
    const context = generalPageMediaContextStore.syncFromPageUrl({ tabId, pageUrl, navigationEpoch: 0 })!;
    return {
      tabId,
      navigationEpoch: 0,
      pageGeneration: context.pageGeneration,
      mediaIdentity: 'general:split',
      ownershipConfidence: 'STRONG' as const,
    };
  }

  test('split audio/video: neither half is offered, probed or fetched — whatever order they were seen in', async () => {
    const tabId = 'tab-split-1';
    const scope = currentScope(tabId);
    // On its own the video half would pass every file check: only the manifest tells it is half a stream.
    const asked = fakeClassifier(async (request) =>
      request.kind === 'dash'
        ? { ok: false, reason: 'UNSUPPORTED_FORMAT', httpStatus: null, message: 'separate audio and video streams are not supported' }
        : { ok: true, kind: 'progressive', finalUrl: request.url, contentType: 'video/mp4', container: 'mp4', sizeBytes: 1_893_293, resumable: true, variants: [], audioTracks: [], durationMs: null },
    );
    const fetched = serveRoutes({ [`${base}manifest.mpd`]: { type: 'application/dash+xml', body: splitMpd } });

    const result = await buildVerifiedGeneralMediaOffer({ scope, candidates: [videoHalf, audioHalf, manifest], pageUrl });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'DASH_UNSUPPORTED');
    assert.deepEqual(asked.map((r) => r.kind), ['dash'], 'the halves never reach a probe');
    assert.deepEqual(fetched, [`GET ${manifestUrl}`], 'nor the network');
    const outcome = classifyMediaResolutionOutcome({ rejectionReason: 'DASH_UNSUPPORTED', hasCandidates: true, allBoundedCandidatesRejected: true });
    assert.equal(outcome.kind, 'PROVEN_UNSUPPORTED');

    // A later build for the same page reuses the refusal: nothing is fetched or probed again.
    const again = await buildVerifiedGeneralMediaOffer({ scope, candidates: [audioHalf, manifest, videoHalf], pageUrl });
    assert.equal(!again.ok && again.reason, 'DASH_UNSUPPORTED');
    assert.equal(asked.length, 1);
    assert.equal(fetched.length, 1);
    generalPageMediaContextStore.clearTab(tabId);
  });

  test('a downloadable manifest’s file is offered once — as the manifest’s quality', async () => {
    const tabId = 'tab-muxed-1';
    const scope = currentScope(tabId);
    const muxedBase = 'https://edge7.cdnhost.net/v/muxed/';
    const muxedManifest = candidate(`${muxedBase}manifest.mpd`, { streamType: 'DASH', container: 'dash', mimeType: 'application/dash+xml', extension: 'mpd' });
    const representationFile = candidate(`${muxedBase}av.mp4`);
    const asked = fakeClassifier(async (request) => ({
      ok: true,
      kind: request.kind === 'dash' ? 'dash' : 'progressive',
      finalUrl: request.url,
      contentType: request.kind === 'dash' ? 'application/dash+xml' : 'video/mp4',
      container: 'mp4',
      sizeBytes: 751_697,
      resumable: true,
      variants: request.kind === 'dash'
        ? [{ id: 'av-360', width: 640, height: 360, bitrate: 600_000, frameRate: 30, videoCodec: 'avc1.4d401e', needsAudioMux: false, estimatedBytes: 751_697, decodable: true }]
        : [],
      audioTracks: [],
      durationMs: null,
    }));
    const fetched = serveRoutes({
      [`${muxedBase}manifest.mpd`]: {
        type: 'application/dash+xml',
        body: `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period><AdaptationSet mimeType="video/mp4">
          <Representation id="av-360" bandwidth="600000" width="640" height="360" codecs="avc1.4d401e,mp4a.40.2">
            <BaseURL>av.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`,
      },
    });

    const result = await buildVerifiedGeneralMediaOffer({ scope, candidates: [representationFile, muxedManifest], pageUrl });

    assert.equal(result.ok, true);
    const offered = result.ok ? result.offer.variants : [];
    assert.deepEqual(offered.map((v) => [v.transport, v.representationId]), [['dash', 'av-360']], 'no second "Original Quality" row');
    assert.deepEqual(asked.map((r) => r.kind), ['dash']);
    assert.deepEqual(fetched, [`GET ${muxedBase}manifest.mpd`]);
    generalPageMediaContextStore.clearTab(tabId);
  });

  test('a manifest that cannot be classified right now claims nothing', async () => {
    fakeClassifier({ ok: false, reason: 'HTTP_ERROR', httpStatus: 503, message: null });
    const fetched = serveRoutes({});
    const result = await verifyGeneralSourceCandidate(manifest, {
      pageUrl,
      requestContext: { pageUrl, referer: pageUrl, userAgent: null, cookiesRequired: false, hasCookies: false, headers: {}, capturedAt: Date.now() },
      mediaIdentity: 'general:split',
      sourceGeneration: 1,
    });
    assert.equal(!result.ok && result.reason, 'PROBE_FAILED');
    assert.deepEqual(!result.ok && result.claimedFiles, []);
    assert.deepEqual(fetched, []);
  });
});

describe('HLS is classified by the engine: separate audio renditions are merged, renditions never offered alone', () => {
  const pageUrl = 'https://video.example.org/watch/hls';
  const base = 'https://edge7.cdnhost.net/hls/show/';
  const masterUrl = `${base}master.m3u8?token=t`;
  const candidate = (url: string, extra: Record<string, unknown> = {}) =>
    ({ ...media, id: url, url, finalUrl: url, sourceUrl: url, pageUrl, streamType: 'HLS', container: 'hls', mimeType: 'application/vnd.apple.mpegurl', extension: 'm3u8', detectedAt: Date.now(), ...extra }) as unknown as DetectedMedia;
  // The player loads the master first, then its rendition playlists.
  const master = candidate(masterUrl, { detectedAt: 1_000 });
  const audioRendition = candidate(`${base}audio/en/index.m3u8?token=t`, { detectedAt: 2_000 });
  const masterText = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,URI="audio/en/index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="subs/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"
v720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"
v360/index.m3u8
`;
  const context = { pageUrl, referer: pageUrl, userAgent: null, cookiesRequired: false, hasCookies: false, headers: {}, capturedAt: Date.now() };

  function currentScope(tabId: string) {
    const ctx = generalPageMediaContextStore.syncFromPageUrl({ tabId, pageUrl, navigationEpoch: 0 })!;
    return { tabId, navigationEpoch: 0, pageGeneration: ctx.pageGeneration, mediaIdentity: 'general:hls', ownershipConfidence: 'STRONG' as const };
  }

  test('a master whose variants take their sound from a rendition is offered with every quality, named exactly', async () => {
    const tabId = 'tab-hls-1';
    const scope = currentScope(tabId);
    const asked = fakeClassifier(async (request) =>
      request.kind === 'hls' && request.url === masterUrl
        ? {
            ok: true,
            kind: 'hls',
            finalUrl: masterUrl,
            contentType: 'application/vnd.apple.mpegurl',
            container: 'mp4',
            sizeBytes: null,
            resumable: true,
            variants: [
              { id: `${base}v720/index.m3u8`, width: 1280, height: 720, bitrate: 2_500_000, frameRate: null, videoCodec: 'avc1.64001f', needsAudioMux: true, estimatedBytes: 18_000_000, decodable: true },
              { id: `${base}v360/index.m3u8`, width: 640, height: 360, bitrate: 800_000, frameRate: null, videoCodec: 'avc1.4d401e', needsAudioMux: true, estimatedBytes: 6_000_000, decodable: true },
            ],
            audioTracks: [{ id: `${base}audio/en/index.m3u8`, language: 'en', label: 'English', bitrate: null, codec: 'mp4a.40.2', isDefault: true }],
            durationMs: 60_000,
            mergesAudio: true,
          }
        : { ok: false, reason: 'UNSUPPORTED_FORMAT', httpStatus: null, message: 'audio-only HLS stream' },
    );
    const fetched = serveRoutes({ [`${base}master.m3u8`]: { type: 'application/vnd.apple.mpegurl', body: masterText } });

    const result = await buildVerifiedGeneralMediaOffer({ scope, candidates: [audioRendition, master], pageUrl });

    assert.equal(result.ok, true);
    const offered = result.ok ? result.offer.variants : [];
    assert.deepEqual(
      offered.map((v) => [v.transport, v.height, v.representationId, v.executableUrl]),
      [
        ['hls', 720, `${base}v720/index.m3u8`, masterUrl],
        ['hls', 360, `${base}v360/index.m3u8`, masterUrl],
      ],
    );
    assert.ok(offered.every((v) => v.audioState === 'INCLUDED' && v.downloadable));
    assert.deepEqual(asked.map((r) => [r.kind, r.url]), [['hls', masterUrl]], 'the audio rendition is claimed by its master, never probed alone');
    assert.deepEqual(fetched, [`GET ${masterUrl}`]);
    // The chosen quality reaches the engine as the exact variant.
    const analysis = result.ok ? generalOfferToAnalysis(result.offer, result.offer.variants[0]!, master) : null;
    assert.equal(analysis?.variants?.[1]?.representationId, `${base}v360/index.m3u8`);
    generalPageMediaContextStore.clearTab(tabId);
  });

  test('refusals keep their meaning: encrypted, live, transient', async () => {
    const cases = [
      ['DRM_PROTECTED', 'DRM_UNSUPPORTED'],
      ['LIVE_UNSUPPORTED', 'LIVE_HLS_UNSUPPORTED'],
      ['NETWORK', 'PROBE_FAILED'],
      ['HTTP_403', 'AUTH_REQUIRED'],
    ] as const;
    for (const [reason, expected] of cases) {
      fakeClassifier({ ok: false, reason, httpStatus: null, message: null });
      serveRoutes({ [`${base}master.m3u8`]: { type: 'application/vnd.apple.mpegurl', body: masterText } });
      const result = await verifyGeneralSourceCandidate(master, { pageUrl, requestContext: context, mediaIdentity: 'general:hls', sourceGeneration: 1 });
      assert.equal(!result.ok && result.reason, expected, reason);
    }
  });
});
