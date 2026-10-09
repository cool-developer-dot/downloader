import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ProbeRequest, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { MediaRequestContext } from '@/downloads/types/request-context';

import type { VerifiedGeneralMediaVariant } from '../general-source';
import { directCandidateMedia, isBetterSplit, verifyDirectCandidates, type DirectVerifierDeps } from './direct-verifier';
import type { DirectMediaCandidate } from './extract-page-media';

const PAGE = 'https://social.example/reel/AbCdEfGh12/';

function candidate(url: string, extra: Partial<DirectMediaCandidate> = {}): DirectMediaCandidate {
  return {
    url,
    kind: 'progressive',
    audioUrl: null,
    evidence: 'content',
    origin: 'embedded_json',
    mimeType: null,
    width: null,
    height: null,
    bitrate: null,
    qualityLabel: null,
    durationMs: null,
    ...extra,
  };
}

function context(session: boolean): MediaRequestContext {
  return {
    pageUrl: PAGE,
    originalPageUrl: PAGE,
    referer: PAGE,
    userAgent: null,
    cookiesRequired: session,
    hasCookies: session,
    headers: {},
    capturedAt: 1,
    authMode: session ? 'SESSION_COOKIE' : 'PUBLIC',
  } as MediaRequestContext;
}

function variant(url: string, extra: Partial<VerifiedGeneralMediaVariant> = {}): VerifiedGeneralMediaVariant {
  return {
    variantId: `v:${url}`,
    resourceIdentity: url.split('?')[0]!,
    executableUrl: url,
    transport: 'progressive',
    container: 'mp4',
    mimeType: 'video/mp4',
    width: null,
    height: null,
    bitrate: null,
    qualityLabel: null,
    sizeBytes: 1_000,
    audioState: 'INCLUDED',
    downloadable: true,
    verificationEvidence: { httpStatus: 206, mimeType: 'video/mp4', contentLength: 1_000, acceptRanges: true, redirectCount: 0, signatureKind: 'mp4', usedRangeProbe: true },
    requestContext: null,
    verifiedAt: 1,
    sourceGeneration: 0,
    ...extra,
  };
}

function deps(
  answer: (url: string, session: boolean) => { ok: true; variants: VerifiedGeneralMediaVariant[] } | { ok: false; reason: string },
  probe: DirectVerifierDeps['probe'] = null,
) {
  const calls: { url: string; session: boolean }[] = [];
  const d: DirectVerifierDeps = {
    verifyCandidate: async (media, input) => {
      const session = input.requestContext.authMode === 'SESSION_COOKIE';
      calls.push({ url: media.url, session });
      return answer(media.url, session);
    },
    buildContext: async ({ session }) => context(session),
    probe,
    now: () => 42,
  };
  return { d, calls };
}

const run = (candidates: DirectMediaCandidate[], d: DirectVerifierDeps) =>
  verifyDirectCandidates(
    { candidates, pageUrl: PAGE, extraction: null, signal: new AbortController().signal, mediaIdentity: 'instagram:reel:AbCdEfGh12' },
    d,
  );

describe('direct candidates → the existing classifiers → one offer', () => {
  test('a verified progressive file becomes the offer, with the page as its context', async () => {
    const url = 'https://cdn.example/o1/reel.mp4?oh=1';
    const { d, calls } = deps((u) => ({ ok: true, variants: [variant(u, { height: 1280, width: 720 })] }));
    const result = await run([candidate(url)], d);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.offer.mediaUrl, url);
    assert.equal(result.offer.analysis.platform, 'OTHER');
    assert.equal(result.offer.analysis.variants?.length, 1);
    assert.equal(result.sourceKind, 'progressive');
    assert.deepEqual(calls, [{ url, session: false }], 'public first');
  });

  test('a link signed for the browsing session is verified again with its cookies', async () => {
    const url = 'https://v16.example.com/video/tos/abc/?mime_type=video_mp4';
    const { d, calls } = deps((u, session) => (session ? { ok: true, variants: [variant(u)] } : { ok: false, reason: 'AUTH_RESPONSE' }));
    const result = await run([candidate(url, { kind: null })], d);
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map((c) => c.session), [false, true]);
  });

  test('a split pair is proven by the engine\'s split probe and offered as one merged download', async () => {
    const probes: ProbeRequest[] = [];
    const probe = async (request: ProbeRequest): Promise<ProbeResult> => {
      probes.push(request);
      return {
        ok: true,
        kind: 'split',
        finalUrl: request.url,
        contentType: null,
        container: 'mp4',
        sizeBytes: 5_000,
        resumable: true,
        variants: [{ id: request.url, width: 1440, height: 2560, bitrate: null, frameRate: null, videoCodec: null, needsAudioMux: true, estimatedBytes: 5_000, decodable: true }],
        audioTracks: [],
        durationMs: 33_600,
        mergesAudio: true,
      };
    };
    const { d } = deps(() => ({ ok: false, reason: 'NOT_MEDIA' }), probe);
    const result = await run([candidate('https://cdn.example/v1440.mp4', { kind: 'split', audioUrl: 'https://cdn.example/a.mp4', durationMs: 33_600 })], d);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.sourceKind, 'split');
    assert.equal(probes[0]?.kind, 'split');
    assert.equal(probes[0]?.audioUrl, 'https://cdn.example/a.mp4');
    assert.equal(result.offer.analysis.variants?.[0]?.audioSourceUrl, 'https://cdn.example/a.mp4');
  });

  test('a better picture offered only as split files is listed beside the whole file', async () => {
    const probe = async (request: ProbeRequest): Promise<ProbeResult> => ({
      ok: true,
      kind: 'split',
      finalUrl: request.url,
      contentType: null,
      container: 'mp4',
      sizeBytes: 9_000,
      resumable: true,
      variants: [{ id: request.url, width: 1440, height: 2560, bitrate: null, frameRate: null, videoCodec: null, needsAudioMux: true, estimatedBytes: 9_000, decodable: true }],
      audioTracks: [],
      durationMs: 30_000,
    });
    const { d } = deps((u) => ({ ok: true, variants: [variant(u, { width: 720, height: 1280 })] }), probe);
    const result = await run(
      [candidate('https://cdn.example/muxed720.mp4'), candidate('https://cdn.example/v1440.mp4', { kind: 'split', audioUrl: 'https://cdn.example/a.mp4' })],
      d,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.sourceKind, 'mixed');
    assert.equal(result.variantCount, 2);
    assert.equal(result.offer.mediaUrl, 'https://cdn.example/muxed720.mp4', 'a single tap never picks the merge silently');
  });

  test('the whole files are offered early, before the split pair is proven, and the final result adds it', async () => {
    const order: string[] = [];
    const probe = async (request: ProbeRequest): Promise<ProbeResult> => {
      order.push('split-probe');
      return {
        ok: true,
        kind: 'split',
        finalUrl: request.url,
        contentType: null,
        container: 'mp4',
        sizeBytes: 9_000,
        resumable: true,
        variants: [{ id: request.url, width: 1440, height: 2560, bitrate: null, frameRate: null, videoCodec: null, needsAudioMux: true, estimatedBytes: 9_000, decodable: true }],
        audioTracks: [],
        durationMs: 30_000,
      };
    };
    const { d } = deps((u) => ({ ok: true, variants: [variant(u, { width: 720, height: 1280 })] }), probe);
    const result = await verifyDirectCandidates(
      {
        candidates: [candidate('https://cdn.example/v1440.mp4', { kind: 'split', audioUrl: 'https://cdn.example/a.mp4' }), candidate('https://cdn.example/muxed720.mp4')],
        pageUrl: PAGE,
        extraction: null,
        signal: new AbortController().signal,
        mediaIdentity: 'instagram:reel:AbCdEfGh12',
        onEarlyOffer: (early) => order.push(`early:${early.variantCount}`),
      },
      d,
    );
    assert.deepEqual(order, ['early:1', 'split-probe']);
    assert.equal(result.ok && result.variantCount, 2);
  });

  test('a split pair is listed only when it is a better picture than the whole files', () => {
    assert.equal(isBetterSplit(1080, 9e6, [{ height: 720, sizeBytes: 3e6 }]), true);
    assert.equal(isBetterSplit(720, 9e6, [{ height: 720, sizeBytes: 3e6 }]), false, 'same height: the whole file is enough');
    assert.equal(isBetterSplit(2560, 35_300_000, [{ height: null, sizeBytes: 7_700_000 }]), true, 'unknown height, much bigger');
    assert.equal(isBetterSplit(640, 2_500_000, [{ height: null, sizeBytes: 2_600_000 }]), false, 'unknown height, same size');
    assert.equal(isBetterSplit(1080, null, [{ height: null, sizeBytes: null }]), true);
    assert.equal(isBetterSplit(640, null, [{ height: null, sizeBytes: null }]), false);
  });

  test('the same file named twice is one quality', async () => {
    const { d } = deps((u) => ({ ok: true, variants: [variant(u.split('?')[0]!)] }));
    const result = await run([candidate('https://cdn.example/x.mp4?a=1'), candidate('https://cdn.example/x.mp4?a=2')], d);
    assert.equal(result.ok && result.variantCount, 1);
  });

  test('when nothing verifies, the strongest refusal is the outcome', async () => {
    const cases: [string[], string][] = [
      [['DRM_UNSUPPORTED', 'PROBE_FAILED'], 'PROTECTED'],
      [['LIVE_HLS_UNSUPPORTED', 'NOT_MEDIA'], 'LIVE_UNSUPPORTED'],
      [['PROBE_FAILED', 'UNSUPPORTED_FORMAT'], 'TRANSIENT_FAILURE'],
      [['UNSUPPORTED_FORMAT', 'HTML_RESPONSE'], 'UNSUPPORTED'],
      [['HTML_RESPONSE', 'NOT_MEDIA'], 'INVALID_MEDIA'],
      [['WEAK_OWNERSHIP'], 'UNRESOLVED'],
    ];
    for (const [reasons, outcome] of cases) {
      let i = 0;
      const { d } = deps(() => ({ ok: false, reason: reasons[i++ % reasons.length]! }));
      const result = await run(reasons.map((_, n) => candidate(`https://cdn.example/${n}.mp4`)), d);
      assert.equal(result.ok, false);
      if (result.ok) continue;
      assert.equal(result.outcome, outcome, reasons.join(','));
    }
  });

  test('without the native engine a split pair cannot be proven', async () => {
    const { d } = deps(() => ({ ok: false, reason: 'NOT_MEDIA' }), null);
    const result = await run([candidate('https://cdn.example/v.mp4', { kind: 'split', audioUrl: 'https://cdn.example/a.mp4' })], d);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'ENGINE_UNAVAILABLE');
  });

  test('a candidate is recorded as the detection pipeline records sources', () => {
    const media = directCandidateMedia(candidate('https://v16.example.com/video/tos/abc/?mime_type=video_mp4', { kind: null }), PAGE, null);
    assert.ok(media);
    assert.equal(media.category, 'video');
    assert.equal(media.detectionSource, 'page_analysis');
    assert.equal(media.pageUrl, PAGE);
    const hls = directCandidateMedia(candidate('https://cdn.example/master.m3u8', { kind: 'hls' }), PAGE, null);
    assert.equal(hls?.streamType, 'HLS');
  });
});
