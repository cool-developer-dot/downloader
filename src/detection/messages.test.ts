import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MAX_MESSAGE_LENGTH, parseDetectorMessage } from './messages.ts';

const frame = { url: 'https://www.instagram.com/reel/C9xYz/', isMain: true, userAgent: 'Mozilla/5.0 Test' };

function message(fields: Record<string, unknown>): string {
  return JSON.stringify({ ch: 'vdx', v: 1, frame, ...fields });
}

describe('envelope', () => {
  test('returns null for other channels, versions, non-JSON and oversized strings', () => {
    assert.equal(parseDetectorMessage(JSON.stringify({ ch: 'chrome', type: 'hello' })), null);
    assert.equal(parseDetectorMessage(JSON.stringify({ ch: 'vdx', v: 2, frame, type: 'hello' })), null);
    assert.equal(parseDetectorMessage('{"ch":"vdx",'), null);
    assert.equal(parseDetectorMessage('not json'), null);
    assert.equal(parseDetectorMessage(42), null);
    assert.equal(parseDetectorMessage(message({ type: 'hello', pad: 'x'.repeat(MAX_MESSAGE_LENGTH) })), null);
  });

  test('requires a frame with an http(s) URL and a boolean isMain', () => {
    assert.equal(parseDetectorMessage(message({ type: 'hello', frame: { ...frame, url: 'about:blank' } })), null);
    assert.equal(parseDetectorMessage(message({ type: 'hello', frame: { ...frame, isMain: 'yes' } })), null);
    assert.equal(parseDetectorMessage(message({ type: 'unknown' })), null);
  });

  test('parses hello, drm and policy', () => {
    assert.deepEqual(parseDetectorMessage(message({ type: 'hello' })), { ch: 'vdx', v: 1, frame, type: 'hello' });
    assert.equal(parseDetectorMessage(message({ type: 'drm', keySystem: 'com.widevine.alpha' }))?.type, 'drm');
    assert.equal(parseDetectorMessage(message({ type: 'drm', keySystem: 7 })), null);
    assert.equal(parseDetectorMessage(message({ type: 'policy', blocked: 'youtube' }))?.type, 'policy');
    assert.equal(parseDetectorMessage(message({ type: 'policy', blocked: 'vimeo' })), null);
  });

  test('nav requires an http(s) URL and cleans the title', () => {
    assert.deepEqual(parseDetectorMessage(message({ type: 'nav', url: 'https://a.com/b', title: '  Hello \n world ' })), {
      ch: 'vdx',
      v: 1,
      frame,
      type: 'nav',
      url: 'https://a.com/b',
      title: 'Hello world',
    });
    assert.equal(parseDetectorMessage(message({ type: 'nav', url: 'javascript:void(0)' })), null);
  });
});

describe('candidates', () => {
  const candidate = {
    key: 'instagram:C9xYz',
    site: 'instagram',
    title: 'A reel',
    thumbnailUrl: 'https://scontent.cdninstagram.com/t.jpg',
    durationSec: 32.5,
    contentUrl: 'https://www.instagram.com/reel/C9xYz/',
    provenance: 'json',
    sources: [
      {
        kind: 'progressive',
        url: 'https://scontent.cdninstagram.com/v.mp4',
        width: 720,
        height: 1280,
        bitrate: 1_200_000,
        mimeType: 'video/mp4',
        hasAudio: true,
        sizeBytes: 4_000_000,
      },
      { kind: 'dash', url: 'https://www.instagram.com/reel/C9xYz/', manifestText: '<MPD></MPD>' },
      { kind: 'hls', url: 'https://a.com/master.m3u8', height: 1080 },
    ],
  };

  test('keeps valid candidates intact', () => {
    const parsed = parseDetectorMessage(message({ type: 'candidates', candidates: [candidate] }));
    assert.equal(parsed?.type, 'candidates');
    assert.deepEqual(parsed.type === 'candidates' ? parsed.candidates : null, [candidate]);
  });

  test('drops candidates with invalid required fields, keeps the rest', () => {
    const parsed = parseDetectorMessage(
      message({
        type: 'candidates',
        candidates: [
          { ...candidate, site: 'myspace' },
          { ...candidate, key: 'has space:1' },
          { ...candidate, provenance: 'guess' },
          { ...candidate, sources: [{ kind: 'progressive', url: 'blob:https://a.com/1' }] },
          { ...candidate, key: 'url:https://a.com/v.mp4', site: 'web' },
        ],
      }),
    );
    assert.equal(parsed?.type === 'candidates' ? parsed.candidates.length : -1, 1);
  });

  test('omits optional fields that are mistyped or out of range', () => {
    const parsed = parseDetectorMessage(
      message({
        type: 'candidates',
        candidates: [
          {
            ...candidate,
            title: 5,
            thumbnailUrl: 'ftp://a.com/t.jpg',
            durationSec: -1,
            sources: [
              {
                kind: 'progressive',
                url: 'https://a.com/v.mp4',
                width: '720',
                height: 1.5,
                bitrate: 0,
                hasAudio: 'yes',
                watermarked: 'no',
                sizeBytes: Number.MAX_SAFE_INTEGER,
                audioUrl: 'data:audio/mp4;base64,AA',
              },
            ],
          },
        ],
      }),
    );
    const [parsedCandidate] = parsed?.type === 'candidates' ? parsed.candidates : [];
    assert.deepEqual(parsedCandidate, {
      key: 'instagram:C9xYz',
      site: 'instagram',
      contentUrl: 'https://www.instagram.com/reel/C9xYz/',
      provenance: 'json',
      sources: [{ kind: 'progressive', url: 'https://a.com/v.mp4' }],
    });
  });

  test('caps titles, candidate and source counts, and rejects oversized or non-MPD manifests', () => {
    const many = Array.from({ length: 80 }, (_, index) => ({ ...candidate, key: `instagram:C${index}` }));
    const parsed = parseDetectorMessage(message({ type: 'candidates', candidates: many }));
    assert.equal(parsed?.type === 'candidates' ? parsed.candidates.length : -1, 50);

    const long = parseDetectorMessage(message({ type: 'candidates', candidates: [{ ...candidate, title: 'x'.repeat(1000) }] }));
    assert.equal(long?.type === 'candidates' ? long.candidates[0].title?.length : -1, 300);

    const badManifests = parseDetectorMessage(
      message({
        type: 'candidates',
        candidates: [
          {
            ...candidate,
            sources: [
              { kind: 'dash', url: 'https://a.com/', manifestText: '<html>' },
              { kind: 'dash', url: 'https://a.com/', manifestText: `<MPD>${'x'.repeat(300_000)}` },
            ],
          },
        ],
      }),
    );
    assert.deepEqual(badManifests?.type === 'candidates' ? badManifests.candidates : null, []);
  });

  test('requires candidates to be an array', () => {
    assert.equal(parseDetectorMessage(message({ type: 'candidates', candidates: {} })), null);
  });
});

describe('players', () => {
  test('keeps valid players and drops invalid ones', () => {
    const parsed = parseDetectorMessage(
      message({
        type: 'players',
        players: [
          {
            isBlob: true,
            playing: true,
            visibleRatio: 0.9,
            poster: 'https://a.com/p.jpg',
            durationSec: 30,
            width: 1080,
            height: 1920,
            mseCodecs: ['avc1.64001f', 5, 'mp4a.40.2'],
          },
          { isBlob: false, playing: 'true', visibleRatio: 1 },
          { isBlob: false, playing: false, visibleRatio: 1.5 },
          { isBlob: false, playing: false, visibleRatio: 0, src: 'blob:https://a.com/x' },
        ],
      }),
    );
    assert.deepEqual(parsed?.type === 'players' ? parsed.players : null, [
      {
        isBlob: true,
        playing: true,
        visibleRatio: 0.9,
        poster: 'https://a.com/p.jpg',
        durationSec: 30,
        width: 1080,
        height: 1920,
        mseCodecs: ['avc1.64001f', 'mp4a.40.2'],
      },
      { isBlob: false, playing: false, visibleRatio: 0 },
    ]);
  });
});
