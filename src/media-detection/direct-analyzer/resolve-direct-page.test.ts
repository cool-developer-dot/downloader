import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { PageFetchResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { DirectMediaCandidate } from './extract-page-media';
import {
  analyzePastedLink,
  outcomeForFetchFailure,
  type DirectAnalyzerPorts,
  type DirectFetchMode,
  type DirectVerification,
} from './resolve-direct-page';

type Call = { url: string; mode: DirectFetchMode; commitCookies: boolean };

const doc = (body: string, finalUrl: string, redirects = 0): PageFetchResult => ({
  kind: 'document',
  finalUrl,
  status: 200,
  contentType: 'text/html',
  body,
  truncated: false,
  redirects,
  elapsedMs: 5,
});
const fail = (code: Extract<PageFetchResult, { kind: 'failure' }>['code'], status: number | null = null): PageFetchResult => ({
  kind: 'failure',
  code,
  status,
  redirects: 0,
  elapsedMs: 5,
});

const OG = (url: string, type = 'video/mp4') =>
  `<html><head><meta property="og:video" content="${url}"><meta property="og:video:type" content="${type}"></head></html>`;

function harness(
  pages: Partial<Record<DirectFetchMode, PageFetchResult | ((url: string) => PageFetchResult)>>,
  verify: (candidates: DirectMediaCandidate[], pageUrl: string) => DirectVerification<string> = (candidates) => ({
    ok: true,
    offer: candidates.map((c) => c.url).join(','),
    sourceKind: 'progressive',
    variantCount: candidates.length,
  }),
) {
  const calls: Call[] = [];
  const verified: { candidates: DirectMediaCandidate[]; pageUrl: string }[] = [];
  const ports: DirectAnalyzerPorts<string> = {
    fetchPage: async ({ url, mode, commitCookies }) => {
      calls.push({ url, mode, commitCookies });
      const page = pages[mode];
      if (!page) return fail('NETWORK');
      return typeof page === 'function' ? page(url) : page;
    },
    verify: async ({ candidates, pageUrl }) => {
      verified.push({ candidates, pageUrl });
      return verify(candidates, pageUrl);
    },
  };
  return { ports, calls, verified };
}

async function run(url: string, h: ReturnType<typeof harness>, extra: { signal?: AbortSignal; desktopRetry?: boolean } = {}) {
  let released = 0;
  const result = await analyzePastedLink<string>({
    url,
    signal: extra.signal ?? new AbortController().signal,
    ports: h.ports,
    desktopRetry: extra.desktopRetry,
    onPageFetched: () => {
      released += 1;
    },
  });
  return { result, released };
}

describe('pasted link → direct analyzer', () => {
  test('a direct MP4 page is resolved from its declared video and verified', async () => {
    const h = harness({ tab: doc(OG('https://cdn.example/v.mp4'), 'https://site.example/watch/abc123') });
    const { result, released } = await run('https://site.example/watch/abc123', h);
    assert.equal(result.status, 'SUPPORTED');
    assert.equal(result.offer, 'https://cdn.example/v.mp4');
    assert.equal(result.evidence, 'declared');
    assert.equal(result.pageFetched, true);
    assert.equal(released, 1, 'the tab is released exactly once');
    assert.deepEqual(h.calls, [{ url: 'https://site.example/watch/abc123', mode: 'tab', commitCookies: true }]);
  });

  test('a direct file URL is verified as itself', async () => {
    const h = harness({
      tab: { kind: 'media', finalUrl: 'https://cdn.example/files/clip.mov', status: 200, contentType: 'video/quicktime', contentLength: 1000, redirects: 1, elapsedMs: 3 },
    });
    const { result } = await run('https://short.example/x', h);
    assert.equal(result.status, 'SUPPORTED');
    assert.equal(result.evidence, 'direct');
    assert.equal(h.verified[0]!.candidates[0]!.kind, 'progressive');
    assert.equal(h.verified[0]!.pageUrl, 'https://cdn.example/files/clip.mov');
  });

  test('a pasted HLS manifest is verified as HLS', async () => {
    const h = harness({
      tab: { kind: 'media', finalUrl: 'https://cdn.example/live/master.m3u8', status: 200, contentType: 'application/vnd.apple.mpegurl', contentLength: null, redirects: 0, elapsedMs: 3 },
    });
    await run('https://cdn.example/live/master.m3u8', h);
    assert.equal(h.verified[0]!.candidates[0]!.kind, 'hls');
  });

  test('redirects: the page is read at its final URL and its links resolve against it', async () => {
    const h = harness({ tab: doc(OG('/media/v.webm'), 'https://www.site.example/video/x9y8z7', 2) });
    const { result } = await run('https://sho.rt/x9y8z7', h);
    assert.equal(result.finalUrl, 'https://www.site.example/video/x9y8z7');
    assert.equal(h.verified[0]!.candidates[0]!.url, 'https://www.site.example/media/v.webm');
  });

  test('timeout and 5xx are transient; 4xx and redirect loops leave the page to the WebView', async () => {
    const cases: [PageFetchResult, string, string][] = [
      [fail('TIMEOUT'), 'TRANSIENT_FAILURE', 'FETCH_TIMEOUT'],
      [fail('NETWORK'), 'TRANSIENT_FAILURE', 'FETCH_NETWORK'],
      [fail('HTTP_ERROR', 503), 'TRANSIENT_FAILURE', 'HTTP_503'],
      [fail('HTTP_ERROR', 429), 'TRANSIENT_FAILURE', 'HTTP_429'],
      [fail('HTTP_ERROR', 404), 'UNRESOLVED', 'HTTP_404'],
      [fail('REDIRECT_LOOP'), 'UNRESOLVED', 'REDIRECT_LOOP'],
      [fail('TOO_MANY_REDIRECTS'), 'UNRESOLVED', 'TOO_MANY_REDIRECTS'],
      [fail('UNSAFE_URL'), 'INVALID_MEDIA', 'UNSAFE_URL'],
      [fail('UNSUPPORTED_CONTENT'), 'INVALID_MEDIA', 'NOT_MEDIA'],
      [fail('POLICY_BLOCKED'), 'UNSUPPORTED', 'POLICY_BLOCKED'],
    ];
    for (const [fetched, status, reason] of cases) {
      const h = harness({ tab: fetched });
      const { result, released } = await run('https://site.example/v/abc123', h);
      assert.deepEqual([result.status, result.reason], [status, reason], reason);
      assert.equal(released, 1);
      assert.equal(h.verified.length, 0, 'nothing is verified after a failed fetch');
    }
    assert.deepEqual(outcomeForFetchFailure('HTTP_ERROR', 403), { status: 'UNRESOLVED', reason: 'HTTP_403' });
  });

  test('YouTube and private addresses are refused before any request', async () => {
    for (const [url, status] of [
      ['https://m.youtube.com/watch?v=abc', 'UNSUPPORTED'],
      ['https://youtu.be/abc', 'UNSUPPORTED'],
      ['http://192.168.1.10/video.mp4', 'INVALID_MEDIA'],
      ['http://localhost:8080/v', 'INVALID_MEDIA'],
      ['ftp://site.example/v.mp4', 'INVALID_MEDIA'],
    ] as const) {
      const h = harness({ tab: doc(OG('https://cdn.example/v.mp4'), url) });
      const { result, released } = await run(url, h);
      assert.equal(result.status, status, url);
      assert.equal(h.calls.length, 0, url);
      assert.equal(released, 1, url);
    }
  });

  test('a page naming no video is retried as the desktop site, and resolved there', async () => {
    const desktopJson = JSON.stringify({ media: { code: 'AbCdEfGh12', video_versions: [{ url: 'https://cdn.example/o1/reel.mp4?oh=1' }] } });
    const h = harness({
      tab: doc('<html><head><meta property="og:title" content="Reel"></head><body>Open the app</body></html>', 'https://social.example/reel/AbCdEfGh12/'),
      desktop: doc(`<html><body><script type="application/json">${desktopJson}</script></body></html>`, 'https://social.example/reel/AbCdEfGh12/'),
    });
    const { result } = await run('https://social.example/reel/AbCdEfGh12/', h);
    assert.equal(result.status, 'SUPPORTED');
    assert.deepEqual(h.calls.map((c) => [c.mode, c.commitCookies]), [['tab', true], ['desktop', false]]);
    assert.equal(result.extraction?.title, 'Reel', 'the tab page\'s title is kept');
    assert.equal(h.verified[0]!.pageUrl, 'https://social.example/reel/AbCdEfGh12/');
  });

  test('an unresolved page is left to the WebView pipeline (UNRESOLVED), after both attempts', async () => {
    const h = harness({
      tab: doc('<html><body>no video here</body></html>', 'https://news.example/story/12345'),
      desktop: doc('<html><body>still none</body></html>', 'https://news.example/story/12345'),
    });
    const { result } = await run('https://news.example/story/12345', h);
    assert.deepEqual([result.status, result.reason], ['UNRESOLVED', 'NO_MEDIA_IN_PAGE']);
    assert.equal(h.verified.length, 0);
  });

  test('several unrelated videos: ambiguous, never a guess', async () => {
    const body = '<video src="https://cdn.example/a.mp4"></video><video src="https://cdn.example/b.mp4"></video>';
    const h = harness({ tab: doc(`<html><body>${body}</body></html>`, 'https://blog.example/post/one'), desktop: doc(`<html><body>${body}</body></html>`, 'https://blog.example/post/one') });
    const { result } = await run('https://blog.example/post/one', h);
    assert.deepEqual([result.status, result.reason], ['UNRESOLVED', 'AMBIGUOUS_MEDIA']);
  });

  test('a declared embedded player page is read one level deep', async () => {
    const playerConfig = JSON.stringify({ request: { files: { progressive: [{ url: 'https://vod.example/76979871/720.mp4', quality: '720p' }] } }, video: { id: 76979871 } });
    const h = harness({
      tab: doc(
        '<html><head><meta property="og:title" content="Film"><meta name="twitter:player" content="https://player.example/video/76979871"></head></html>',
        'https://vid.example/76979871',
      ),
      player: doc(`<html><body><script>window.playerConfig = ${playerConfig};</script></body></html>`, 'https://player.example/video/76979871'),
    });
    const { result } = await run('https://vid.example/76979871', h);
    assert.equal(result.status, 'SUPPORTED');
    assert.deepEqual(h.calls.map((c) => c.mode), ['tab', 'player']);
    assert.equal(result.offer, 'https://vod.example/76979871/720.mp4');
    assert.equal(result.extraction?.title, 'Film');
  });

  test('an embedded YouTube player is refused by policy', async () => {
    const h = harness({
      tab: doc('<html><head><meta property="og:video" content="https://www.youtube.com/embed/xyz"><meta property="og:video:type" content="text/html"></head></html>', 'https://blog.example/post/yt'),
    });
    const { result } = await run('https://blog.example/post/yt', h);
    assert.deepEqual([result.status, result.reason], ['UNSUPPORTED', 'POLICY_BLOCKED']);
    assert.equal(h.calls.length, 1);
  });

  test('protected and live pages are typed as such', async () => {
    const protectedMpd =
      '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period><AdaptationSet mimeType="video/mp4"><ContentProtection schemeIdUri="urn:uuid:edef8ba9"/></AdaptationSet></Period></MPD>';
    const protectedPage = `<html><body><script type="application/json">${JSON.stringify({ v: { id: 'abc12345', dash_manifest: protectedMpd } })}</script></body></html>`;
    let h = harness({ tab: doc(protectedPage, 'https://site.example/v/abc12345') });
    assert.equal((await run('https://site.example/v/abc12345', h)).result.status, 'PROTECTED');

    const livePage = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'VideoObject', publication: { isLiveBroadcast: true }, embedUrl: 'https://site.example/live/embed' })}</script></head></html>`;
    h = harness({ tab: doc(livePage, 'https://site.example/live/ch1x9'), player: doc('<html></html>', 'https://site.example/live/embed') });
    assert.equal((await run('https://site.example/live/ch1x9', h)).result.status, 'LIVE_UNSUPPORTED');
  });

  test('the classifier\'s refusal is the result (protected, live, unsupported)', async () => {
    for (const outcome of ['PROTECTED', 'LIVE_UNSUPPORTED', 'UNSUPPORTED', 'INVALID_MEDIA', 'TRANSIENT_FAILURE'] as const) {
      const h = harness({ tab: doc(OG('https://cdn.example/v.m3u8', 'application/x-mpegURL'), 'https://site.example/v/abc123') }, () => ({
        ok: false,
        outcome,
        reason: `R_${outcome}`,
      }));
      const { result } = await run('https://site.example/v/abc123', h);
      assert.deepEqual([result.status, result.reason], [outcome, `R_${outcome}`]);
      assert.equal(result.offer, null);
    }
  });

  test('a link superseded while its page loads is STALE and verifies nothing', async () => {
    const controller = new AbortController();
    const h = harness({
      tab: (url) => {
        controller.abort();
        return doc(OG('https://cdn.example/v.mp4'), url);
      },
    });
    const { result, released } = await run('https://site.example/v/abc123', h, { signal: controller.signal });
    assert.equal(result.status, 'STALE');
    assert.equal(h.verified.length, 0);
    assert.equal(released, 1);
  });

  test('Video 1 → Video 2 → Video 3: each analysis sees only its own page', async () => {
    const pages: Record<string, string> = {
      'https://site.example/v/aaa111': OG('https://cdn.example/one.mp4'),
      'https://site.example/v/bbb222': OG('https://cdn.example/two.mp4'),
      'https://site.example/v/ccc333': OG('https://cdn.example/three.mp4'),
    };
    const h = harness({ tab: (url) => doc(pages[url]!, url) });
    const offers = [];
    for (const url of Object.keys(pages)) {
      offers.push((await run(url, h)).result.offer);
    }
    assert.deepEqual(offers, ['https://cdn.example/one.mp4', 'https://cdn.example/two.mp4', 'https://cdn.example/three.mp4']);
  });
});
