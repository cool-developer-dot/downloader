/**
 * Media Detection Engine — Phase 1 smoke tests.
 * Run: node src/media-detection/tests/media-detection.smoke.mjs
 */

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// --- Inline mirrors of core pure logic (keep in sync with TS modules) ---

const BLOCKED = ['javascript:', 'blob:', 'file:', 'data:', 'about:', 'vidorax:'];
const ALLOWED = ['http:', 'https:'];
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v']);
const AUDIO = new Set(['mp3', 'm4a', 'aac', 'ogg']);
const STREAM = new Set(['m3u8']);
const EXT_TO_CONTAINER = {
  mp4: 'mp4', webm: 'webm', mov: 'mov', m4v: 'm4v',
  mp3: 'mp3', m4a: 'm4a', aac: 'aac', ogg: 'ogg', m3u8: 'hls',
};

function isSafeMediaUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 8192) return false;
  const lower = trimmed.toLowerCase();
  if (BLOCKED.some((s) => lower.startsWith(s))) return false;
  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED.includes(parsed.protocol.toLowerCase()) || !parsed.hostname) {
      return false;
    }
    if (isPrivateOrLocalHostname(parsed.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isPrivateOrLocalHostname(hostname) {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }
  return false;
}

function isSameDocumentUrl(a, b) {
  if (!a || !b) return false;
  try {
    const na = new URL(a.trim());
    const nb = new URL(b.trim());
    na.hash = '';
    nb.hash = '';
    for (const u of [na, nb]) {
      if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
        u.pathname = u.pathname.slice(0, -1);
      }
    }
    return na.toString() === nb.toString();
  } catch {
    return false;
  }
}

function parseBridgeEnvelope(raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 200000) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.channel !== 'vidorax-media-detection') return null;
  if (!parsed.type || parsed.payload == null || typeof parsed.payload !== 'object') {
    return null;
  }
  return parsed;
}


function parseExtension(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const last = pathname.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot <= 0) return null;
    return last.slice(dot + 1).replace(/[^a-z0-9]/g, '') || null;
  } catch {
    return null;
  }
}

function resolveCategory(ext) {
  if (!ext) return null;
  if (STREAM.has(ext)) return 'stream';
  if (VIDEO.has(ext)) return 'video';
  if (AUDIO.has(ext)) return 'audio';
  return null;
}

function parseHls(content) {
  if (!content.trim().startsWith('#EXTM3U')) return null;
  const lines = content.split(/\r?\n/);
  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  const encrypted = lines.some((l) => l.startsWith('#EXT-X-KEY'));
  const hasTarget = lines.some((l) => l.startsWith('#EXT-X-TARGETDURATION'));
  const hasEnd = lines.some((l) => l.startsWith('#EXT-X-ENDLIST'));
  return {
    playlistType: isMaster ? 'master' : hasTarget ? 'media' : 'unknown',
    isEncrypted: encrypted,
    isLive: hasTarget && !hasEnd,
  };
}

function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildId(url, container) {
  return `md_${fnv1a(`${url}|${container}`)}`;
}

function dedupeUpsert(existing, incoming) {
  const idx = existing.findIndex((m) => m.id === incoming.id);
  if (idx >= 0) {
    const next = existing.slice();
    next[idx] = { ...next[idx], ...incoming, confidence: Math.max(next[idx].confidence, incoming.confidence) };
    return { items: next, updated: true, inserted: false };
  }
  return { items: [incoming, ...existing], updated: false, inserted: true };
}

// --- Tests ---

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

test('rejects unsafe schemes', () => {
  assert(!isSafeMediaUrl('javascript:alert(1)'), 'javascript blocked');
  assert(!isSafeMediaUrl('blob:https://x/1'), 'blob blocked');
  assert(!isSafeMediaUrl('file:///tmp/a.mp4'), 'file blocked');
  assert(!isSafeMediaUrl('data:video/mp4;base64,aaa'), 'data blocked');
  assert(!isSafeMediaUrl('ftp://cdn.example/a.mp4'), 'ftp blocked');
});

test('accepts http(s) media urls', () => {
  assert(isSafeMediaUrl('https://cdn.example.com/v.mp4'), 'https ok');
  assert(isSafeMediaUrl('http://cdn.example.com/a.mp3'), 'http ok');
});

test('MP4 detection via extension', () => {
  const url = 'https://cdn.example.com/clip.mp4?token=1';
  const ext = parseExtension(url);
  assert(ext === 'mp4', 'ext mp4');
  assert(resolveCategory(ext) === 'video', 'category video');
  assert(EXT_TO_CONTAINER[ext] === 'mp4', 'container mp4');
});

test('MP3 detection via extension', () => {
  const url = 'https://cdn.example.com/track.mp3';
  assert(resolveCategory(parseExtension(url)) === 'audio', 'audio');
});

test('HLS detection via extension', () => {
  const url = 'https://cdn.example.com/live/master.m3u8';
  assert(resolveCategory(parseExtension(url)) === 'stream', 'stream');
  assert(EXT_TO_CONTAINER[parseExtension(url)] === 'hls', 'hls container');
});

test('HLS master playlist parse', () => {
  const manifest = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720
hi.m3u8
`;
  const parsed = parseHls(manifest);
  assert(parsed.playlistType === 'master', 'master');
  assert(parsed.isEncrypted === false, 'not encrypted');
});

test('Encrypted HLS flagged', () => {
  const manifest = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-KEY:METHOD=AES-128,URI="key.key"
#EXTINF:6,
seg0.ts
#EXT-X-ENDLIST
`;
  const parsed = parseHls(manifest);
  assert(parsed.isEncrypted === true, 'encrypted');
  assert(parsed.playlistType === 'media', 'media playlist');
  assert(parsed.isLive === false, 'vod');
});

test('Live HLS without ENDLIST', () => {
  const manifest = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6,
seg0.ts
`;
  assert(parseHls(manifest).isLive === true, 'live');
});

test('Deduplication updates instead of insert', () => {
  const id = buildId('https://cdn.example.com/a.mp4', 'mp4');
  const a = { id, url: 'https://cdn.example.com/a.mp4', confidence: 0.5, title: null };
  const b = { id, url: 'https://cdn.example.com/a.mp4', confidence: 0.8, title: 'Clip' };
  const first = dedupeUpsert([], a);
  assert(first.inserted && first.items.length === 1, 'insert');
  const second = dedupeUpsert(first.items, b);
  assert(second.updated && !second.inserted, 'update');
  assert(second.items.length === 1, 'no dup');
  assert(second.items[0].title === 'Clip', 'title merged');
  assert(second.items[0].confidence === 0.8, 'confidence raised');
});

test('Stable media ids', () => {
  const a = buildId('https://cdn.example.com/a.mp4', 'mp4');
  const b = buildId('https://cdn.example.com/a.mp4', 'mp4');
  assert(a === b, 'stable');
  assert(a.startsWith('md_'), 'prefix');
});

test('Unsupported extensions rejected', () => {
  assert(resolveCategory(parseExtension('https://cdn.example.com/file.pdf')) === null, 'pdf');
  assert(resolveCategory(parseExtension('https://cdn.example.com/dash.mpd')) === null, 'dash reserved');
});

test('WEBM / MOV / M4V / M4A / AAC / OGG covered', () => {
  for (const [ext, cat] of [
    ['webm', 'video'], ['mov', 'video'], ['m4v', 'video'],
    ['m4a', 'audio'], ['aac', 'audio'], ['ogg', 'audio'],
  ]) {
    assert(
      resolveCategory(parseExtension(`https://x.test/f.${ext}`)) === cat,
      `${ext} → ${cat}`,
    );
  }
});

test('rejects private / loopback hosts (SSRF)', () => {
  assert(!isSafeMediaUrl('http://127.0.0.1/a.mp4'), 'loopback');
  assert(!isSafeMediaUrl('http://localhost/a.m3u8'), 'localhost');
  assert(!isSafeMediaUrl('http://192.168.1.10/v.mp4'), 'rfc1918');
  assert(!isSafeMediaUrl('http://10.0.0.5/a.mp3'), 'class A private');
  assert(isSafeMediaUrl('https://cdn.example.com/v.mp4'), 'public ok');
});

test('same-document URL ignores hash / trailing slash', () => {
  assert(
    isSameDocumentUrl('https://ex.com/v', 'https://ex.com/v#clip'),
    'hash',
  );
  assert(
    isSameDocumentUrl('https://ex.com/v/', 'https://ex.com/v'),
    'slash',
  );
  assert(
    !isSameDocumentUrl('https://ex.com/a', 'https://ex.com/b'),
    'different paths',
  );
});

test('bridge envelope rejects foreign / malformed payloads', () => {
  assert(parseBridgeEnvelope(null) === null, 'null');
  assert(parseBridgeEnvelope('{') === null, 'bad json');
  assert(
    parseBridgeEnvelope(JSON.stringify({ channel: 'other', type: 'ready', payload: {} })) === null,
    'foreign channel',
  );
  assert(
    parseBridgeEnvelope(
      JSON.stringify({
        channel: 'vidorax-media-detection',
        type: 'ready',
        payload: {},
      }),
    )?.type === 'ready',
    'valid ready',
  );
});

console.log(`\n${passed} smoke tests passed.`);
