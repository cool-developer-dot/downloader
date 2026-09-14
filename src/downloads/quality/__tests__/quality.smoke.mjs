/**
 * Phase 2 quality normalization smoke tests.
 * Run: node src/downloads/quality/__tests__/quality.smoke.mjs
 */

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

const QUALITY_RANK = {
  '2160p': 0,
  '1440p': 1,
  '1080p': 2,
  '720p': 3,
  '480p': 4,
  '360p': 5,
  '240p': 6,
  '144p': 7,
  Original: 8,
};

function labelFromHeight(height) {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  for (const tier of QUALITY_LADDER) {
    if (height >= tier.minHeight) return tier.label;
  }
  return '144p';
}

function parseHeightFromResolution(resolution) {
  if (!resolution) return null;
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(resolution.trim());
  if (!match) return null;
  const height = Number(match[2]);
  return Number.isFinite(height) && height > 0 ? height : null;
}

function resolveLabel(analysis) {
  const height = analysis.height ?? parseHeightFromResolution(analysis.resolution);
  const fromHeight = labelFromHeight(height);
  if (fromHeight) return fromHeight;
  if (analysis.mediaType === 'audio' && analysis.container !== 'unknown') {
    return analysis.container.toUpperCase();
  }
  if (analysis.resolution?.trim()) return analysis.resolution.trim();
  if (analysis.container !== 'unknown') return 'Original';
  if (analysis.mediaType) return 'Original';
  return null;
}

function isDetectedMedia(analysis) {
  return (
    analysis.mediaType != null ||
    analysis.container !== 'unknown' ||
    Boolean(analysis.mimeType && analysis.downloadable)
  );
}

function sortQualityOptions(options) {
  return options.slice().sort((a, b) => {
    const rankA = QUALITY_RANK[a.label] ?? 50;
    const rankB = QUALITY_RANK[b.label] ?? 50;
    if (rankA !== rankB) return rankA - rankB;
    return (b.height ?? 0) - (a.height ?? 0);
  });
}

function selectDefaultQualityOption(options) {
  const downloadable = options.filter((o) => o.downloadable);
  if (downloadable.length === 0) return null;
  return sortQualityOptions(downloadable)[0] ?? null;
}

function normalizeAnalysisToSelection(analysis) {
  const options = [];
  if (isDetectedMedia(analysis)) {
    const label = resolveLabel(analysis);
    if (label) {
      const sourceUrl = analysis.finalUrl || analysis.sourceUrl;
      options.push({
        id: `analysis:${sourceUrl}:${analysis.container}:${label}`,
        label,
        resolution: analysis.resolution,
        width: analysis.width,
        height: analysis.height,
        bitrate: analysis.bitrate,
        fps: analysis.fps,
        fileSize: analysis.fileSize,
        mimeType: analysis.mimeType,
        container: analysis.container,
        mediaType: analysis.mediaType,
        downloadable: analysis.downloadable === true,
        unavailableReason: analysis.downloadable ? null : analysis.unsupportedReason,
        sourceUrl,
      });
    }
  }
  return {
    title: analysis.title?.trim() || null,
    options: sortQualityOptions(options),
    unsupportedReason: analysis.unsupportedReason,
  };
}

function toCreateDownloadInput(selection, option) {
  if (!option || !option.downloadable || !option.sourceUrl) return null;
  return {
    title: selection.title || 'Download',
    sourceUrl: option.sourceUrl,
    platform: selection.platform || 'OTHER',
    fileName: 'clip.mp4',
    fileSize: option.fileSize ?? 0,
  };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

test('MP4 with one quality becomes a single downloadable option', () => {
  const selection = normalizeAnalysisToSelection({
    title: 'sample.mp4',
    sourceUrl: 'https://cdn.example.com/sample.mp4',
    finalUrl: 'https://cdn.example.com/sample.mp4',
    thumbnailUrl: null,
    mediaType: 'video',
    mimeType: 'video/mp4',
    container: 'mp4',
    duration: null,
    width: null,
    height: null,
    resolution: null,
    bitrate: null,
    fps: null,
    fileSize: '1048576',
    platform: 'CDN_EXAMPLE',
    downloadable: true,
    unsupportedReason: null,
  });
  assert(selection.options.length === 1, 'one option');
  assert(selection.options[0].label === 'Original', 'original label');
  assert(selection.options[0].downloadable === true, 'downloadable');
  assert(selection.options[0].fileSize === '1048576', 'size preserved');
  assert(selection.options[0].fps === null, 'no fabricated fps');
});

test('MP4 with verified height labels quality without inventing others', () => {
  const selection = normalizeAnalysisToSelection({
    title: null,
    sourceUrl: 'https://cdn.example.com/clip.mp4',
    finalUrl: 'https://cdn.example.com/clip.mp4',
    thumbnailUrl: null,
    mediaType: 'video',
    mimeType: 'video/mp4',
    container: 'mp4',
    duration: null,
    width: 1280,
    height: 720,
    resolution: '1280x720',
    bitrate: null,
    fps: null,
    fileSize: null,
    platform: 'CDN_EXAMPLE',
    downloadable: true,
    unsupportedReason: null,
  });
  assert(selection.options.length === 1, 'still one option from Phase 1');
  assert(selection.options[0].label === '720p', '720p from height');
  assert(selectDefaultQualityOption(selection.options)?.label === '720p', 'default');
});

test('multiple real options sort highest first and default to best downloadable', () => {
  // Synthetic multi-option list (Phase 1 returns one; model supports N).
  const options = sortQualityOptions([
    {
      id: '480',
      label: '480p',
      height: 480,
      downloadable: true,
      sourceUrl: 'https://x/480.mp4',
    },
    {
      id: '1080',
      label: '1080p',
      height: 1080,
      downloadable: true,
      sourceUrl: 'https://x/1080.mp4',
    },
    {
      id: '720',
      label: '720p',
      height: 720,
      downloadable: false,
      sourceUrl: 'https://x/720.m3u8',
    },
  ]);
  assert(options[0].label === '1080p', '1080 first');
  assert(options[1].label === '720p', '720 second');
  assert(selectDefaultQualityOption(options)?.id === '1080', 'default downloadable best');
});

test('MP3/audio uses container label', () => {
  const selection = normalizeAnalysisToSelection({
    title: null,
    sourceUrl: 'https://cdn.example.com/track.mp3',
    finalUrl: 'https://cdn.example.com/track.mp3',
    thumbnailUrl: null,
    mediaType: 'audio',
    mimeType: 'audio/mpeg',
    container: 'mp3',
    duration: null,
    width: null,
    height: null,
    resolution: null,
    bitrate: null,
    fps: null,
    fileSize: '204800',
    platform: 'CDN_EXAMPLE',
    downloadable: true,
    unsupportedReason: null,
  });
  assert(selection.options[0].label === 'MP3', 'mp3 label');
  assert(selection.options[0].downloadable === true, 'downloadable');
});

test('basic HLS is downloadable when analysis says so', () => {
  const selection = normalizeAnalysisToSelection({
    title: null,
    sourceUrl: 'https://cdn.example.com/stream.m3u8',
    finalUrl: 'https://cdn.example.com/stream.m3u8',
    thumbnailUrl: null,
    mediaType: 'stream',
    mimeType: 'application/vnd.apple.mpegurl',
    container: 'hls',
    duration: null,
    width: 1280,
    height: 720,
    resolution: '1280x720',
    bitrate: 1400000,
    fps: null,
    fileSize: null,
    platform: 'CDN_EXAMPLE',
    downloadable: true,
    unsupportedReason: null,
  });
  assert(selection.options.length === 1, 'shown as detected');
  assert(selection.options[0].downloadable === true, 'downloadable');
  assert(selectDefaultQualityOption(selection.options)?.container === 'hls', 'default hls');
});

test('encrypted HLS stays not downloadable', () => {
  const selection = normalizeAnalysisToSelection({
    title: null,
    sourceUrl: 'https://cdn.example.com/stream.m3u8',
    finalUrl: 'https://cdn.example.com/stream.m3u8',
    thumbnailUrl: null,
    mediaType: 'stream',
    mimeType: 'application/vnd.apple.mpegurl',
    container: 'hls',
    duration: null,
    width: 1280,
    height: 720,
    resolution: '1280x720',
    bitrate: 1400000,
    fps: null,
    fileSize: null,
    platform: 'CDN_EXAMPLE',
    downloadable: false,
    unsupportedReason: 'ENCRYPTED_MEDIA',
  });
  assert(selection.options.length === 1, 'shown as detected');
  assert(selection.options[0].downloadable === false, 'not downloadable');
  assert(selection.options[0].unavailableReason === 'ENCRYPTED_MEDIA', 'reason');
  assert(selectDefaultQualityOption(selection.options) === null, 'no default');
});

test('missing optional metadata stays null', () => {
  const selection = normalizeAnalysisToSelection({
    title: null,
    sourceUrl: 'https://cdn.example.com/a.mp4',
    finalUrl: 'https://cdn.example.com/a.mp4',
    thumbnailUrl: null,
    mediaType: 'video',
    mimeType: 'video/mp4',
    container: 'mp4',
    duration: null,
    width: null,
    height: null,
    resolution: null,
    bitrate: null,
    fps: null,
    fileSize: null,
    platform: 'CDN_EXAMPLE',
    downloadable: true,
    unsupportedReason: null,
  });
  const option = selection.options[0];
  assert(option.bitrate === null, 'bitrate');
  assert(option.fps === null, 'fps');
  assert(option.fileSize === null, 'size');
  assert(option.resolution === null, 'resolution');
});

test('no media yields empty options', () => {
  const selection = normalizeAnalysisToSelection({
    title: null,
    sourceUrl: 'https://example.com/page',
    finalUrl: 'https://example.com/page',
    thumbnailUrl: null,
    mediaType: null,
    mimeType: 'text/html',
    container: 'unknown',
    duration: null,
    width: null,
    height: null,
    resolution: null,
    bitrate: null,
    fps: null,
    fileSize: null,
    platform: 'EXAMPLE',
    downloadable: false,
    unsupportedReason: 'NO_MEDIA',
  });
  assert(selection.options.length === 0, 'no options');
  assert(selectDefaultQualityOption(selection.options) === null, 'no default');
});

test('create contract rejects unsupported option', () => {
  const selection = {
    title: 'clip',
    platform: 'EXAMPLE',
  };
  const unsupported = {
    downloadable: false,
    sourceUrl: 'https://cdn.example.com/stream.m3u8',
    fileSize: null,
  };
  assert(toCreateDownloadInput(selection, unsupported) === null, 'blocked');
});

test('create contract maps downloadable option', () => {
  const payload = toCreateDownloadInput(
    { title: 'sample.mp4', platform: 'CDN_EXAMPLE' },
    {
      downloadable: true,
      sourceUrl: 'https://cdn.example.com/sample.mp4',
      fileSize: '100',
      container: 'mp4',
    },
  );
  assert(payload?.sourceUrl === 'https://cdn.example.com/sample.mp4', 'url');
  assert(payload?.fileSize === '100', 'size');
  assert(payload?.platform === 'CDN_EXAMPLE', 'platform');
});

test('never invents 1080p when height missing', () => {
  const selection = normalizeAnalysisToSelection({
    title: null,
    sourceUrl: 'https://cdn.example.com/a.mp4',
    finalUrl: 'https://cdn.example.com/a.mp4',
    thumbnailUrl: null,
    mediaType: 'video',
    mimeType: 'video/mp4',
    container: 'mp4',
    duration: null,
    width: null,
    height: null,
    resolution: null,
    bitrate: null,
    fps: null,
    fileSize: null,
    platform: 'CDN_EXAMPLE',
    downloadable: true,
    unsupportedReason: null,
  });
  assert(selection.options[0].label !== '1080p', 'not fabricated');
  assert(selection.options[0].label === 'Original', 'original');
});

console.log(`\n${passed} quality smoke tests passed.`);
