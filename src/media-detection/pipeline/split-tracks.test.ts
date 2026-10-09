import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProbeRequest, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import { resolveSplitPair, splitPairAnalysis, wholeFileUrl, type SplitTrackEvidence } from './split-tracks';

const V = 'https://cdn.example.com/v/clip-video.mp4?oh=VSIG&oe=1';
const A = 'https://cdn.example.com/v/clip-audio.mp4?oh=ASIG&oe=1';
const request = { useCookies: false };

function ok(videoUrl: string, durationMs = 15_000): ProbeResult {
  return {
    ok: true,
    kind: 'split',
    finalUrl: videoUrl,
    contentType: null,
    container: 'mp4',
    sizeBytes: 2_000_000,
    resumable: true,
    variants: [{ id: videoUrl, width: 720, height: 1280, bitrate: null, frameRate: null, videoCodec: null, needsAudioMux: true, estimatedBytes: 2_000_000, decodable: true }],
    audioTracks: [],
    durationMs,
    mergesAudio: true,
  };
}

/** A classifier that knows which URL is the video and which the audio. */
function classifier(video: string, audio: string, durationMs = 15_000) {
  const calls: ProbeRequest[] = [];
  const probe = async (req: ProbeRequest): Promise<ProbeResult> => {
    calls.push(req);
    if (req.url !== video) return { ok: false, reason: 'VIDEO_TRACK_MISSING', httpStatus: null, message: null };
    if (req.audioUrl !== audio) return { ok: false, reason: 'AUDIO_TRACK_MISSING', httpStatus: null, message: null };
    return ok(video, durationMs);
  };
  return { probe, calls };
}

const buffers = (overrides: Partial<SplitTrackEvidence> = {}): SplitTrackEvidence => ({
  source: 'buffers',
  videoUrl: `${V}&bytestart=0&byteend=999`,
  audioUrl: `${A}&bytestart=0&byteend=99`,
  candidateUrls: [],
  durationMs: 15_000,
  ...overrides,
});

test('byte-range query parameters are dropped, signatures kept', () => {
  assert.equal(wholeFileUrl(`${V}&bytestart=0&byteend=65535`), V);
  assert.equal(wholeFileUrl('https://cdn.example.com/a.mp4?range=0-100&sig=x'), 'https://cdn.example.com/a.mp4?sig=x');
  assert.equal(wholeFileUrl(V), V);
});

test('the page-named pair is proven by the native classifier and becomes one split option', async () => {
  const { probe, calls } = classifier(V, A);
  const result = await resolveSplitPair({ evidence: buffers(), probe, request });
  assert.ok(result.ok);
  assert.equal(calls.length, 1);
  assert.deepEqual({ kind: calls[0]!.kind, url: calls[0]!.url, audioUrl: calls[0]!.audioUrl }, { kind: 'split', url: V, audioUrl: A });
  if (result.ok) {
    const analysis = splitPairAnalysis(result.pair, { title: 'Reel', thumbnailUrl: null, platform: 'INSTAGRAM' });
    assert.equal(analysis.variants?.[0]?.sourceUrl, V);
    assert.equal(analysis.variants?.[0]?.audioSourceUrl, A);
    assert.equal(analysis.variants?.[0]?.height, 1280);
  }
});

test('a pair whose length is not the element’s is another video: stale, never merged', async () => {
  const { probe } = classifier(V, A, 15_000);
  const result = await resolveSplitPair({ evidence: buffers({ durationMs: 42_000 }), probe, request });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.outcome, 'STALE');
});

test('native refusals keep their typed outcome', async () => {
  const cases = [
    ['DRM_PROTECTED', 'PROTECTED', true],
    ['TRACK_MISMATCH', 'STALE', false],
    ['NETWORK', 'TRANSIENT_FAILURE', false],
    ['HTTP_403', 'SOURCE_UNRESOLVED', false],
  ] as const;
  for (const [reason, outcome, proven] of cases) {
    const result = await resolveSplitPair({
      evidence: buffers(),
      probe: async () => ({ ok: false, reason, httpStatus: null, message: null }),
      request,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.outcome, outcome, reason);
      assert.equal(result.failure.proven, proven, reason);
    }
  }
});

test('network evidence with exactly two files tries both orders', async () => {
  const { probe, calls } = classifier(V, A);
  const result = await resolveSplitPair({
    evidence: { source: 'network', videoUrl: null, audioUrl: null, candidateUrls: [`${A}&bytestart=0&byteend=9`, V], durationMs: null },
    probe,
    request,
  });
  assert.ok(result.ok);
  assert.equal(calls.length, 2, 'audio-first order refused as a missing picture, then the right order');
});

test('network evidence with a third file (a prefetched next item) is never guessed', async () => {
  const { probe, calls } = classifier(V, A);
  const result = await resolveSplitPair({
    evidence: { source: 'network', videoUrl: null, audioUrl: null, candidateUrls: [V, A, 'https://cdn.example.com/v/next-video.mp4'], durationMs: null },
    probe,
    request,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.reason, 'SPLIT_AMBIGUOUS');
  assert.equal(calls.length, 0);
});

test('an abort while probing is stale', async () => {
  const controller = new AbortController();
  const result = await resolveSplitPair({
    evidence: buffers(),
    probe: async () => {
      controller.abort();
      return ok(V);
    },
    request,
    signal: controller.signal,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.outcome, 'STALE');
});
