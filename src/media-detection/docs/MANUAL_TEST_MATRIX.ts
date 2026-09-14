/**
 * Manual testing matrix — Week 4 Day 3 Phase 1.
 * Detection only; no download actions expected.
 */

export const MANUAL_TEST_MATRIX = [
  {
    id: 'MP4-01',
    case: 'Direct MP4 URL navigation',
    steps: 'Open https://example.com/sample.mp4 (or known public MP4)',
    expect: 'detectedMedia contains category=video, container=mp4',
  },
  {
    id: 'MP3-01',
    case: 'HTML5 audio element',
    steps: 'Open a page with <audio src="*.mp3">',
    expect: 'category=audio, container=mp3 via DOM observer',
  },
  {
    id: 'HLS-01',
    case: 'HLS master playlist',
    steps: 'Open a page that loads *.m3u8',
    expect: 'category=stream, container=hls; qualities populated after enrich',
  },
  {
    id: 'HLS-02',
    case: 'Encrypted HLS',
    steps: 'Load AES-128 HLS with EXT-X-KEY',
    expect: 'isDrm=true, detectionError encrypted_hls; no crash',
  },
  {
    id: 'DOM-01',
    case: 'Dynamic DOM injection',
    steps: 'SPA that inserts <video> after load',
    expect: 'Mutation batch detects media without full rescan thrash',
  },
  {
    id: 'NAV-01',
    case: 'Navigation reset',
    steps: 'Detect media → navigate to new URL',
    expect: 'clearPageDetections; lastNavigation updated',
  },
  {
    id: 'DEDUP-01',
    case: 'Duplicate prevention',
    steps: 'Same MP4 reported from DOM + performance',
    expect: 'Single entry; metadata merged; duplicateUpdates increments',
  },
  {
    id: 'SEC-01',
    case: 'Blocked schemes',
    steps: 'Page references blob:/javascript: media',
    expect: 'Rejected; never posted into store',
  },
  {
    id: 'HOME-01',
    case: 'Home clears detections',
    steps: 'Detect media → tap Home',
    expect: 'detectedMedia empty; scanning false',
  },
  {
    id: 'PERF-01',
    case: 'Low-end browse',
    steps: 'Scroll media-heavy page on Android mid-range',
    expect: 'No ANR; bridge batches; browsing remains responsive',
  },
] as const;
