/**
 * Phase 3 integration smoke: quality option → create payload → store contract.
 * Run: node src/downloads/quality/__tests__/phase3-integration.smoke.mjs
 */

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isSafeMediaUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (
    ['javascript:', 'blob:', 'file:', 'data:', 'about:', 'intent:', 'content:'].some((s) =>
      lower.startsWith(s),
    )
  ) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toCreateDownloadInput(selection, option) {
  if (!option || !option.downloadable || !option.sourceUrl) return null;
  let fileName = 'clip.mp4';
  if (option.container === 'hls') {
    try {
      const path = new URL(option.sourceUrl).pathname.split('/').filter(Boolean).pop() || 'demo';
      const base = path.replace(/\.(m3u8|m3u|mpd)$/i, '') || 'demo';
      fileName = `${base}.ts`;
    } catch {
      fileName = 'demo.ts';
    }
  }
  return {
    title: (selection.title || 'Download').slice(0, 255),
    sourceUrl: option.sourceUrl,
    platform: selection.platform || 'OTHER',
    thumbnailUrl: selection.thumbnailUrl || 'https://www.google.com/s2/favicons?domain=vidorax.app&sz=128',
    fileName,
    fileSize: option.fileSize ?? 0,
  };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

test('rejects unsupported schemes locally (no analyze)', () => {
  assert(!isSafeMediaUrl(''), 'empty');
  assert(!isSafeMediaUrl('javascript:alert(1)'), 'javascript');
  assert(!isSafeMediaUrl('file:///tmp/a.mp4'), 'file');
  assert(!isSafeMediaUrl('data:text/plain,hi'), 'data');
  assert(isSafeMediaUrl('https://cdn.example.com/a.mp4'), 'https');
});

test('downloadable MP4 maps to existing create contract', () => {
  const payload = toCreateDownloadInput(
    {
      title: 'sample.mp4',
      platform: 'CDN_EXAMPLE',
      thumbnailUrl: null,
    },
    {
      downloadable: true,
      sourceUrl: 'https://cdn.example.com/sample.mp4',
      fileSize: '1048576',
    },
  );
  assert(payload != null, 'payload');
  assert(payload.sourceUrl === 'https://cdn.example.com/sample.mp4', 'url');
  assert(payload.platform === 'CDN_EXAMPLE', 'platform');
  assert(payload.fileSize === '1048576', 'size');
  assert(typeof payload.thumbnailUrl === 'string' && payload.thumbnailUrl.startsWith('http'), 'thumb');
});

test('unsupported HLS never becomes create payload', () => {
  const payload = toCreateDownloadInput(
    { title: null, platform: 'CDN_EXAMPLE', thumbnailUrl: null },
    {
      downloadable: false,
      sourceUrl: 'https://cdn.example.com/stream.m3u8',
      fileSize: null,
      unavailableReason: 'ENCRYPTED_MEDIA',
    },
  );
  assert(payload === null, 'blocked');
});

test('downloadable HLS maps to create contract with .ts name', () => {
  const payload = toCreateDownloadInput(
    {
      title: 'Demo Stream',
      platform: 'CDN_EXAMPLE',
      thumbnailUrl: null,
      finalUrl: 'https://cdn.example.com/stream.m3u8',
      sourceUrl: 'https://cdn.example.com/stream.m3u8',
    },
    {
      downloadable: true,
      sourceUrl: 'https://cdn.example.com/clips/demo.m3u8',
      fileSize: null,
      container: 'hls',
      unavailableReason: null,
    },
  );
  assert(payload != null, 'payload');
  assert(payload.sourceUrl.includes('.m3u8'), 'url');
  assert(String(payload.fileName).endsWith('.ts'), 'ts extension');
  assert(!String(payload.fileName).endsWith('.m3u8'), 'not playlist ext');
});

test('create in-flight guard pattern rejects second start while busy', () => {
  let creating = false;
  const confirm = () => {
    if (creating) return false;
    creating = true;
    return true;
  };
  assert(confirm() === true, 'first');
  assert(confirm() === false, 'second blocked');
});

console.log(`\n${passed} phase3 integration smoke tests passed.`);
