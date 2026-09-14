/**
 * Week 7 Day 3 Phase 1 — HLS engine hardening verifier.
 * Deterministic playlist / planner / retry / persist fixtures.
 * NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-week7-day3-phase1.ts
 */

import { DownloadEngineError } from '../src/downloads/engine/errors';
import { describeHlsVariants } from '../src/downloads/engine/hls/quality';
import {
  isSegmentRetryable,
  isUnrecoverableHlsCode,
} from '../src/downloads/engine/hls/segment-retry';
import {
  parseHlsPlaylist,
  selectHlsVariant,
} from '../src/downloads/engine/hls/playlist';
import {
  planHlsSegments,
  orderedAssemblyEntries,
} from '../src/downloads/engine/hls/planner';
import { createHlsPersistGate } from '../src/downloads/engine/hls/persist-gate';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`expected ${code}`);
  } catch (error) {
    assert(error instanceof DownloadEngineError, 'engine error');
    assert(error.code === code, `got ${error.code}`);
  }
}

const BASE = 'https://cdn.example.com/video/';

async function main(): Promise<void> {
console.log('Week 7 Day 3 Phase 1 — HLS engine hardening\n');

await test('master: multiple variants with real metadata + relative URLs', () => {
  const parsed = parseHlsPlaylist(
    `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,AVERAGE-BANDWIDTH=600000,RESOLUTION=640x360,CODECS="avc1.42c01e,mp4a.40.2",FRAME-RATE=24
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5500000,AVERAGE-BANDWIDTH=4200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",FRAME-RATE=60

high/index.m3u8
`,
    BASE + 'master.m3u8',
  );
  assert(parsed.kind === 'master', 'master');
  if (parsed.kind !== 'master') {
    return;
  }
  assert(parsed.variants.length === 2, 'two variants');
  const high = parsed.variants[1];
  assert(high?.url === BASE + 'high/index.m3u8', high?.url ?? 'url');
  assert(high?.bandwidth === 5_500_000, 'bandwidth');
  assert(high?.averageBandwidth === 4_200_000, 'avg bandwidth');
  assert(high?.resolution === '1920x1080', 'resolution');
  assert(high?.codecs === 'avc1.640028,mp4a.40.2', 'codecs');
  assert(high?.frameRate === 60, 'frame rate');

  const described = describeHlsVariants(parsed.variants);
  assert(described[1]?.label === '1080p', described[1]?.label ?? 'label');
  assert(described[1]?.url === high?.url, 'raw url preserved');
});

await test('master: does not invent missing metadata', () => {
  const parsed = parseHlsPlaylist(
    `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1400000
only.m3u8
`,
    BASE + 'master.m3u8',
  );
  assert(parsed.kind === 'master', 'master');
  if (parsed.kind !== 'master') {
    return;
  }
  const only = parsed.variants[0];
  assert(parsed.variants.length === 1, 'single variant');
  assert(only?.resolution === null, 'no fake resolution');
  assert(only?.codecs === null, 'no fake codecs');
  assert(only?.frameRate === null, 'no fake fps');
  assert(describeHlsVariants(parsed.variants)[0]?.label === null, 'no fake label');
  assert(selectHlsVariant(parsed.variants).url === only?.url, 'single select');
});

await test('master: selects highest real bandwidth', () => {
  const parsed = parseHlsPlaylist(
    `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720
high.m3u8
`,
    BASE + 'master.m3u8',
  );
  assert(parsed.kind === 'master', 'master');
  if (parsed.kind !== 'master') {
    return;
  }
  const best = selectHlsVariant(parsed.variants);
  assert(best.url === BASE + 'high.m3u8', best.url);
  assert(best.height === 720, 'height');
});

await test('media: VOD relative + absolute MPEG-TS segments', () => {
  const parsed = parseHlsPlaylist(
    `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
seg0.ts
#EXTINF:6.0,
https://cdn.example.com/a/seg-b.ts
#EXT-X-ENDLIST
`,
    BASE + 'index.m3u8',
  );
  assert(parsed.kind === 'media', 'media');
  if (parsed.kind !== 'media') {
    return;
  }
  assert(parsed.segments.length === 2, 'count');
  assert(parsed.segments[0]?.url === BASE + 'seg0.ts', 'relative');
  assert(parsed.segments[1]?.url === 'https://cdn.example.com/a/seg-b.ts', 'absolute');
  assert(parsed.containerHint === 'ts', 'ts');
  assert(parsed.segments[0]?.isInitSegment === false, 'not init');
});

await test('media: fMP4 + EXT-X-MAP', () => {
  const parsed = parseHlsPlaylist(
    `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4.0,
seg0.m4s
#EXTINF:4.0,
seg1.m4s
#EXT-X-ENDLIST
`,
    BASE + 'fmp4.m3u8',
  );
  assert(parsed.kind === 'media', 'media');
  if (parsed.kind !== 'media') {
    return;
  }
  assert(parsed.containerHint === 'fmp4', 'fmp4');
  assert(parsed.initSegmentUrl === BASE + 'init.mp4', 'init');
  const plan = planHlsSegments(parsed);
  assert(plan.totalSegments === 3, 'init + 2');
  assert(plan.entries[0]?.isInitSegment === true, 'init first');
  assert(plan.entries[1]?.index === 0, 'media 0');
  assert(orderedAssemblyEntries(plan)[0]?.isInitSegment === true, 'assemble init first');
});

await test('unsupported: AES-128 encryption', () => {
  expectCode(
    () =>
      parseHlsPlaylist(
        `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key"
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
a.ts
#EXT-X-ENDLIST
`,
        BASE + 'enc.m3u8',
      ),
    'UNSUPPORTED_HLS_ENCRYPTION',
  );
});

await test('unsupported: SAMPLE-AES encryption', () => {
  expectCode(
    () =>
      parseHlsPlaylist(
        `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="https://cdn.example.com/key"
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
a.ts
#EXT-X-ENDLIST
`,
        BASE + 'saes.m3u8',
      ),
    'UNSUPPORTED_HLS_ENCRYPTION',
  );
});

await test('unsupported: FairPlay SAMPLE-AES DRM', () => {
  expectCode(
    () =>
      parseHlsPlaylist(
        `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://item",KEYFORMAT="com.apple.streamingkeydelivery"
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
a.ts
#EXT-X-ENDLIST
`,
        BASE + 'drm.m3u8',
      ),
    'UNSUPPORTED_DRM',
  );
});

await test('unsupported: live playlist without ENDLIST', () => {
  expectCode(
    () =>
      parseHlsPlaylist(
        `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
a.ts
`,
        BASE + 'live.m3u8',
      ),
    'LIVE_HLS_UNSUPPORTED',
  );
});

await test('unsupported: byte range', () => {
  expectCode(
    () =>
      parseHlsPlaylist(
        `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
#EXT-X-BYTERANGE:1000@0
a.ts
#EXT-X-ENDLIST
`,
        BASE + 'br.m3u8',
      ),
    'UNSUPPORTED_HLS_BYTERANGE',
  );
});

await test('unsupported: malformed playlist', () => {
  expectCode(() => parseHlsPlaylist('not a playlist', BASE + 'x.m3u8'), 'INVALID_HLS_PLAYLIST');
});

await test('unsupported: zero-segment VOD', () => {
  expectCode(
    () =>
      parseHlsPlaylist(
        `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-ENDLIST
`,
        BASE + 'empty.m3u8',
      ),
    'INVALID_HLS_PLAYLIST',
  );
});

await test('METHOD=NONE is not treated as encryption', () => {
  const parsed = parseHlsPlaylist(
    `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-KEY:METHOD=NONE
#EXTINF:4.0,
a.ts
#EXT-X-ENDLIST
`,
    BASE + 'none.m3u8',
  );
  assert(parsed.kind === 'media', 'media');
});

await test('planner preserves order and counts', () => {
  const parsed = parseHlsPlaylist(
    `#EXTM3U
#EXT-X-TARGETDURATION:2
#EXTINF:2.0,
a.ts
#EXTINF:2.0,
b.ts
#EXTINF:2.0,
c.ts
#EXT-X-ENDLIST
`,
    BASE + 'plan.m3u8',
  );
  assert(parsed.kind === 'media', 'media');
  if (parsed.kind !== 'media') {
    return;
  }
  const plan = planHlsSegments(parsed);
  assert(plan.mediaSegmentCount === 3, 'media count');
  assert(plan.totalSegments === 3, 'total');
  assert(plan.entries.map((e) => e.url).join(',') === `${BASE}a.ts,${BASE}b.ts,${BASE}c.ts`, 'order');
});

await test('segment retry: timeout/reset/5xx retryable; 404/DRM not', () => {
  assert(
    isSegmentRetryable(new DownloadEngineError('NETWORK_TIMEOUT', 'timeout')),
    'timeout',
  );
  assert(
    isSegmentRetryable(new DownloadEngineError('NETWORK_ERROR', 'connection reset')),
    'reset',
  );
  assert(
    isSegmentRetryable(new DownloadEngineError('HTTP_ERROR', 'HTTP 503', { httpStatus: 503 })),
    '503',
  );
  assert(
    isSegmentRetryable(new DownloadEngineError('RATE_LIMITED', '429', { httpStatus: 429 })),
    '429',
  );
  assert(
    !isSegmentRetryable(new DownloadEngineError('INVALID_RESOURCE', '404', { httpStatus: 404 })),
    '404',
  );
  assert(
    !isSegmentRetryable(new DownloadEngineError('UNSUPPORTED_DRM', 'drm')),
    'drm',
  );
  assert(
    !isSegmentRetryable(new DownloadEngineError('INVALID_HLS_PLAYLIST', 'bad')),
    'playlist',
  );
  assert(isUnrecoverableHlsCode('LIVE_HLS_UNSUPPORTED'), 'live unrecoverable');
  assert(!isUnrecoverableHlsCode('NETWORK_ERROR'), 'network recoverable');
});

await test('persistence gate: N segments and interval; force always', () => {
  const gate = createHlsPersistGate({ everyNSegments: 3, intervalMs: 10_000 });
  assert(gate.shouldPersist(1, 1_000) === false, 'too soon');
  assert(gate.shouldPersist(3, 1_100) === true, 'every N');
  assert(gate.shouldPersist(4, 1_200) === false, 'not yet');
  assert(gate.shouldPersist(4, 12_000) === true, 'interval');
  assert(gate.shouldPersist(4, 12_001, true) === true, 'force');
});

await test('BOM + CRLF playlist still parses', () => {
  const body = `\uFEFF#EXTM3U\r\n#EXT-X-TARGETDURATION:4\r\n#EXTINF:4.0,\r\na.ts\r\n#EXT-X-ENDLIST\r\n`;
  const parsed = parseHlsPlaylist(body, BASE + 'bom.m3u8');
  assert(parsed.kind === 'media', 'media');
  if (parsed.kind !== 'media') {
    return;
  }
  assert(parsed.segments.length === 1, 'one');
});

console.log(`\nday3-phase1: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
}

void main();
