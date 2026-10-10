import type {
  MediaContainer,
  ProgressiveAudioContainer,
  ProgressiveVideoContainer,
} from '../types';

/** Progressive video extensions — candidate signals only. */
export const PROGRESSIVE_VIDEO_EXTENSIONS = [
  'mp4',
  'webm',
  'mov',
  'm4v',
  'mkv',
  'avi',
  'mpeg',
  'mpg',
  'ts',
  'm2ts',
  '3gp',
  '3g2',
  'f4v',
  'divx',
  'flv',
  'wmv',
] as const satisfies readonly ProgressiveVideoContainer[];

/** Strong video extensions — extension alone may reach medium confidence. */
export const STRONG_VIDEO_EXTENSIONS = [
  'mp4',
  'webm',
  'mov',
  'm4v',
  'mkv',
  'avi',
  'mpeg',
  'mpg',
  '3gp',
  '3g2',
  'f4v',
  'divx',
  'flv',
  'wmv',
] as const;

/** Weak extensions — never classify from extension alone (.ts segments). */
export const WEAK_MEDIA_EXTENSIONS = ['ts', 'm2ts'] as const;

/** Progressive audio extensions. */
export const PROGRESSIVE_AUDIO_EXTENSIONS = [
  'mp3',
  'm4a',
  'aac',
  'ogg',
] as const satisfies readonly ProgressiveAudioContainer[];

/** Streaming manifest extensions. */
export const STREAM_EXTENSIONS = ['m3u8', 'mpd'] as const;

export const ALL_MEDIA_EXTENSIONS = [
  ...PROGRESSIVE_VIDEO_EXTENSIONS,
  ...PROGRESSIVE_AUDIO_EXTENSIONS,
  ...STREAM_EXTENSIONS,
] as const;

export const EXTENSION_TO_CONTAINER: Record<string, MediaContainer> = {
  mp4: 'mp4',
  webm: 'webm',
  mov: 'mov',
  m4v: 'm4v',
  mkv: 'mkv',
  avi: 'avi',
  mpeg: 'mpeg',
  mpg: 'mpg',
  ts: 'ts',
  m2ts: 'm2ts',
  '3gp': '3gp',
  '3g2': '3g2',
  f4v: 'f4v',
  divx: 'divx',
  flv: 'flv',
  wmv: 'wmv',
  mp3: 'mp3',
  m4a: 'm4a',
  aac: 'aac',
  ogg: 'ogg',
  m3u8: 'hls',
  mpd: 'dash',
};

export const EXTENSION_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  f4v: 'video/x-f4v',
  divx: 'video/divx',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  m3u8: 'application/vnd.apple.mpegurl',
  mpd: 'application/dash+xml',
};

export const MIME_TO_EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'video/avi': 'avi',
  'video/mpeg': 'mpeg',
  'video/mp2t': 'ts',
  'video/3gpp': '3gp',
  'video/3gpp2': '3g2',
  'video/x-f4v': 'f4v',
  'video/divx': 'divx',
  'video/x-divx': 'divx',
  'video/x-flv': 'flv',
  'video/x-ms-wmv': 'wmv',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'application/vnd.apple.mpegurl': 'm3u8',
  'application/x-mpegurl': 'm3u8',
  'audio/mpegurl': 'm3u8',
  'application/dash+xml': 'mpd',
};

/** Non-media MIME prefixes / exact types to reject early. */
export const REJECT_MIME_PREFIXES = [
  'image/',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/json',
  'font/',
  'application/font',
  'text/html',
  'text/xml',
] as const;

export const REJECT_MIME_EXACT = new Set([
  'application/octet-stream', // alone — not enough without other signals
  'text/vtt',
  'application/x-subrip',
]);

/** Schemes rejected for security — never treat as downloadable media. */
export const BLOCKED_MEDIA_SCHEMES = [
  'javascript:',
  'blob:',
  'file:',
  'data:',
  'about:',
  'vidorax:',
  'intent:',
  'market:',
  'content:',
] as const;

export const ALLOWED_MEDIA_SCHEMES = ['http:', 'https:'] as const;

/** Debounce / batching tunables for low-end Android. */
export const DETECTION_TIMING = {
  mutationBatchMs: 250,
  rescanDebounceMs: 400,
  manifestFetchTimeoutMs: 8_000,
  manifestMaxBytes: 512_000,
  mimeProbeTimeoutMs: 5_000,
  mimeProbeMaxBytes: 0,
  redirectMaxHops: 5,
  redirectTimeoutMs: 6_000,
  maxCandidatesPerBatch: 40,
  maxDetectedPerPage: 80,
  performancePollMs: 1_500,
  probeCacheTtlMs: 60_000,
  maxConcurrentProbes: 3,
  maxProbesPerPage: 24,
  nativeEventDedupeMs: 1_500,
  bridgeThrottleMs: 200,
} as const;

export const CONFIDENCE = {
  /** Extension / URL path candidate without corroboration. */
  baseUrlMatch: 0.42,
  /** Strong container extension (mp4/webm/…) without MIME yet. */
  strongExtBoost: 0.08,
  mimeBoost: 0.18,
  mimeVerifiedBoost: 0.35,
  domElementBoost: 0.2,
  dimensionsBoost: 0.05,
  durationBoost: 0.05,
  manifestBoost: 0.15,
  manifestVerifiedBoost: 0.4,
  nativeNetworkBoost: 0.12,
  jsNetworkBoost: 0.1,
  /** Keyword-only URLs stay below accept threshold. */
  keywordOnly: 0.25,
  max: 0.99,
  /** Raised bar: extension alone needs strongExt or another signal. */
  minAccept: 0.5,
} as const;

export const FUTURE_STREAM_PROTOCOLS = ['cmaf'] as const;

export const MEDIA_DETECTION_VERSION = '2.0.0';
