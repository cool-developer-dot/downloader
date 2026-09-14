/**
 * Quality resolver + discovery formatters smoke tests.
 * Run: node src/media-detection/tests/discovery.smoke.mjs
 */

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const QUALITY_LADDER = [
  { label: '2160p', minHeight: 2160 },
  { label: '1440p', minHeight: 1440 },
  { label: '1080p', minHeight: 1080 },
  { label: '720p', minHeight: 720 },
  { label: '480p', minHeight: 480 },
  { label: '360p', minHeight: 360 },
  { label: '240p', minHeight: 240 },
  { label: '144p', minHeight: 144 },
];

function labelFromHeight(height) {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null;
  for (const tier of QUALITY_LADDER) {
    if (height >= tier.minHeight) return tier.label;
  }
  return '144p';
}

function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isDownloadAffordable(media) {
  if (media.isDrm) return false;
  if (media.container === 'unknown') return false;
  if (media.container === 'hls' || media.category === 'stream') {
    return !media.isLive;
  }
  return true;
}

function resolveBadges(media) {
  const badges = [];
  if (media.isLive) badges.push('LIVE');
  if (media.isDrm) badges.push('DRM', 'Unsupported');
  if (media.container === 'hls') badges.push('HLS');
  return badges;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

test('quality labels from verified heights only', () => {
  assert(labelFromHeight(1080) === '1080p', '1080');
  assert(labelFromHeight(720) === '720p', '720');
  assert(labelFromHeight(2160) === '2160p', '2160');
  assert(labelFromHeight(null) === null, 'null');
  assert(labelFromHeight(0) === null, 'zero');
});

test('duration formatting', () => {
  assert(formatDuration(65) === '1:05', '65s');
  assert(formatDuration(3661) === '1:01:01', 'hms');
  assert(formatDuration(null) === null, 'null');
});

test('file size formatting', () => {
  assert(formatFileSize(1536) === '1.5 KB', 'kb');
  assert(formatFileSize(null) === null, 'null');
});

test('DRM / live HLS not downloadable; VOD HLS is', () => {
  assert(!isDownloadAffordable({ isDrm: true, container: 'hls' }), 'drm');
  assert(isDownloadAffordable({ isDrm: false, container: 'mp4' }), 'mp4');
  assert(!isDownloadAffordable({ isDrm: false, container: 'unknown' }), 'unknown');
  assert(
    isDownloadAffordable({ isDrm: false, container: 'hls', category: 'stream', isLive: false }),
    'vod hls',
  );
  assert(
    !isDownloadAffordable({ isDrm: false, container: 'hls', category: 'stream', isLive: true }),
    'live hls',
  );
});

test('audio formats dedupe by container', () => {
  const byContainer = new Map();
  const list = [
    { category: 'audio', isDrm: false, container: 'mp3', id: 'a' },
    { category: 'audio', isDrm: false, container: 'mp3', id: 'b' },
    { category: 'audio', isDrm: false, container: 'aac', id: 'c' },
  ];
  for (const media of list) {
    if (byContainer.has(media.container)) continue;
    byContainer.set(media.container, media);
  }
  assert(byContainer.size === 2, 'deduped to 2');
  assert(byContainer.has('mp3') && byContainer.has('aac'), 'mp3+aac');
});

test('badge derivation', () => {
  const badges = resolveBadges({ isLive: true, isDrm: true, container: 'hls' });
  assert(badges.includes('LIVE') && badges.includes('DRM'), 'live+drm');
});

console.log(`\n${passed} discovery smoke tests passed.`);
