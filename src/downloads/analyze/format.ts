import type {
  AnalysisUnsupportedReason,
  MediaAnalysisContainer,
  MediaAnalysisMediaType,
  MediaAnalysisResult,
  MediaAnalysisStreamType,
  MediaAnalysisVariant,
} from '@/api/types';
import { normalizeVideoMime, resolveVideoFormatHint, videoFormatFromMime } from '@/media-detection/resource/video-resource';

export function emptyAnalysis(
  sourceUrl: string,
  overrides: Partial<MediaAnalysisResult> = {},
): MediaAnalysisResult {
  return {
    title: null,
    sourceUrl,
    finalUrl: sourceUrl,
    thumbnailUrl: null,
    mediaType: null,
    mimeType: null,
    container: 'unknown',
    duration: null,
    width: null,
    height: null,
    resolution: null,
    bitrate: null,
    fps: null,
    fileSize: null,
    platform: derivePlatform(sourceUrl),
    downloadable: false,
    unsupportedReason: 'ANALYSIS_FAILED',
    variants: [],
    ...overrides,
  };
}

export function derivePlatform(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (!host) {
      return 'OTHER';
    }
    if (host.includes('youtube') || host === 'youtu.be') {
      return 'YOUTUBE';
    }
    if (host.includes('vimeo')) {
      return 'VIMEO';
    }
    if (host.includes('facebook') || host === 'fb.watch') {
      return 'FACEBOOK';
    }
    if (host.includes('instagram')) {
      return 'INSTAGRAM';
    }
    if (host.includes('tiktok')) {
      return 'TIKTOK';
    }
    if (host === 'x.com' || host.includes('twitter')) {
      return 'X';
    }
    if (host.includes('dailymotion')) {
      return 'DAILYMOTION';
    }
    return 'OTHER';
  } catch {
    return 'OTHER';
  }
}

export function parseContentType(raw: string | null): string | null {
  return normalizeVideoMime(raw);
}

export function isHlsMimeType(mime: string | null): boolean {
  return videoFormatFromMime(mime) === 'hls';
}

export function isNonMediaDocumentMime(mime: string | null): boolean {
  if (!mime) {
    return false;
  }
  return (
    mime.startsWith('text/html') ||
    mime.startsWith('text/plain') ||
    mime.startsWith('application/json') ||
    mime.startsWith('application/xml') ||
    mime.startsWith('text/xml') ||
    mime === 'application/xhtml+xml'
  );
}

/** A direct analysis that got an HTML document back: the link is a web page, not a media file. */
export function isWebPageAnalysis(analysis: Pick<MediaAnalysisResult, 'downloadable' | 'mimeType' | 'unsupportedReason'>): boolean {
  if (analysis.downloadable || analysis.unsupportedReason !== 'NO_MEDIA') {
    return false;
  }
  const mime = analysis.mimeType?.toLowerCase() ?? '';
  return mime.startsWith('text/html') || mime.startsWith('application/xhtml+xml');
}

export function resolveExtension(
  url: string,
  mime: string | null,
): string | null {
  const video = resolveVideoFormatHint({ url, mimeType: mime });
  if (video) return video === 'hls' ? 'm3u8' : video;
  try {
    const path = new URL(url).pathname.toLowerCase();
    const ext = path.includes('.') ? path.split('.').pop() ?? '' : '';
    if (ext && /^[a-z0-9]{1,8}$/.test(ext)) {
      return ext;
    }
  } catch {
    // fall through
  }
  if (!mime) {
    return null;
  }
  const map: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'application/vnd.apple.mpegurl': 'm3u8',
    'application/x-mpegurl': 'm3u8',
  };
  return map[mime] ?? null;
}

export function resolveContainer(
  extension: string | null,
  mime: string | null,
): MediaAnalysisContainer {
  const video = resolveVideoFormatHint({ extension, mimeType: mime });
  if (video) return video;
  const ext = extension?.toLowerCase() ?? '';
  if (ext === 'm3u8' || ext === 'm3u' || isHlsMimeType(mime)) {
    return 'hls';
  }
  const known: MediaAnalysisContainer[] = [
    'mp4',
    'webm',
    'mov',
    'mp3',
    'm4a',
    'aac',
    'ogg',
  ];
  if ((known as string[]).includes(ext)) {
    return ext as MediaAnalysisContainer;
  }
  if (mime?.startsWith('video/mp4')) {
    return 'mp4';
  }
  if (mime?.startsWith('video/webm')) {
    return 'webm';
  }
  if (mime?.startsWith('audio/mpeg')) {
    return 'mp3';
  }
  if (mime?.startsWith('audio/')) {
    return 'm4a';
  }
  return 'unknown';
}

export function resolveMediaType(
  container: MediaAnalysisContainer,
  mime: string | null,
): MediaAnalysisMediaType | null {
  if (container === 'hls') {
    return 'stream';
  }
  if (
    container === 'mp3' ||
    container === 'm4a' ||
    container === 'aac' ||
    container === 'ogg' ||
    mime?.startsWith('audio/')
  ) {
    return 'audio';
  }
  if (
    container === 'mp4' ||
    container === 'webm' ||
    container === 'mov' ||
    container === 'm4v' ||
    container === 'avi' ||
    container === 'wmv' ||
    mime?.startsWith('video/')
  ) {
    return 'video';
  }
  return null;
}

export function parseFileSize(contentLength: string | null): string | null {
  if (!contentLength || !/^\d+$/.test(contentLength.trim())) {
    return null;
  }
  try {
    const value = BigInt(contentLength.trim());
    if (value < 0n) {
      return null;
    }
    return value.toString();
  } catch {
    return null;
  }
}

export function contentLengthToEstimatedSize(
  contentLength: string | null,
): number | null {
  const asString = parseFileSize(contentLength);
  if (!asString) {
    return null;
  }
  try {
    const value = BigInt(asString);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    const n = Number(value);
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function extractFilenameFromContentDisposition(
  header: string | null,
): string | null {
  if (!header) {
    return null;
  }
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, '')).slice(
        0,
        180,
      );
    } catch {
      // fall through
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header);
  if (plain?.[1]) {
    return plain[1].trim().replace(/^"|"$/g, '').slice(0, 180);
  }
  return null;
}

export function stableVariantId(parts: string[]): string {
  const raw = parts.join('|');
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `v_${(hash >>> 0).toString(16)}`;
}

export function buildQualityLabel(input: {
  height?: number | null;
  streamType: MediaAnalysisStreamType;
  container?: MediaAnalysisContainer | null;
}): string {
  const height =
    typeof input.height === 'number' &&
    Number.isFinite(input.height) &&
    input.height > 0
      ? Math.trunc(input.height)
      : null;
  if (height != null) {
    return `${height}p`;
  }
  if (input.streamType === 'AUDIO') {
    if (
      input.container &&
      input.container !== 'unknown' &&
      input.container !== 'hls'
    ) {
      return input.container.toUpperCase();
    }
  }
  return 'Original Quality';
}

export function mapEngineErrorToReason(
  code: string | undefined,
): AnalysisUnsupportedReason {
  switch (code) {
    case 'UNSUPPORTED_DRM':
      return 'DRM_PROTECTED';
    case 'UNSUPPORTED_HLS_ENCRYPTION':
    case 'HLS_ENCRYPTED':
      return 'ENCRYPTED_MEDIA';
    case 'LIVE_HLS_UNSUPPORTED':
    case 'UNSUPPORTED_HLS_BYTERANGE':
    case 'HLS_UNSUPPORTED':
      return 'UNSUPPORTED_STREAM';
    case 'NETWORK_ERROR':
    case 'NETWORK_TIMEOUT':
    case 'HTTP_ERROR':
    case 'AUTH_ERROR':
      return 'NETWORK_ERROR';
    case 'INVALID_RESOURCE':
      return 'INVALID_URL';
    case 'INVALID_HLS_PLAYLIST':
      return 'UNSUPPORTED_STREAM';
    case 'CANCELLED':
      return 'ANALYSIS_FAILED';
    default:
      return 'ANALYSIS_FAILED';
  }
}

export function splitCodecs(codecs: string | null): {
  videoCodec: string | null;
  audioCodec: string | null;
} {
  if (!codecs) {
    return { videoCodec: null, audioCodec: null };
  }
  const parts = codecs
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  let videoCodec: string | null = null;
  let audioCodec: string | null = null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (
      lower.startsWith('avc') ||
      lower.startsWith('hev') ||
      lower.startsWith('hvc') ||
      lower.startsWith('vp') ||
      lower.startsWith('av01')
    ) {
      videoCodec = videoCodec ?? part;
    } else if (
      lower.startsWith('mp4a') ||
      lower.startsWith('opus') ||
      lower.startsWith('flac') ||
      lower.startsWith('ac-3') ||
      lower.startsWith('ec-3')
    ) {
      audioCodec = audioCodec ?? part;
    }
  }
  return { videoCodec, audioCodec };
}

export function estimateHlsFileSizeBytes(
  bitrate: number | null,
  durationSeconds: number | null,
): number | null {
  if (
    bitrate == null ||
    !Number.isFinite(bitrate) ||
    bitrate <= 0 ||
    durationSeconds == null ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return null;
  }
  const bytes = Math.trunc((bitrate * durationSeconds) / 8);
  if (bytes <= 0 || bytes > LOCAL_ANALYZE_MAX_ESTIMATED) {
    return null;
  }
  return bytes;
}

const LOCAL_ANALYZE_MAX_ESTIMATED = 50 * 1024 * 1024 * 1024;

export function createVariant(input: {
  sourceUrl: string;
  streamType: MediaAnalysisStreamType;
  width?: number | null;
  height?: number | null;
  resolution?: string | null;
  bitrate?: number | null;
  averageBitrate?: number | null;
  codecs?: string | null;
  container: MediaAnalysisContainer;
  mimeType?: string | null;
  estimatedFileSize?: number | null;
  frameRate?: number | null;
  downloadable: boolean;
  unsupportedReason?: AnalysisUnsupportedReason | null;
  originalIndex: number;
  /** DASH only: the representation this variant downloads. */
  representationId?: string | null;
  /** Split tracks: the audio file merged with this video-only file. */
  audioSourceUrl?: string | null;
}): MediaAnalysisVariant {
  const width =
    typeof input.width === 'number' && input.width > 0
      ? Math.trunc(input.width)
      : null;
  const height =
    typeof input.height === 'number' && input.height > 0
      ? Math.trunc(input.height)
      : null;
  const resolution =
    input.resolution ??
    (width && height ? `${width}x${height}` : null);
  const { videoCodec, audioCodec } = splitCodecs(input.codecs ?? null);
  const label = buildQualityLabel({
    height,
    streamType: input.streamType,
    container: input.container,
  });

  return {
    id: stableVariantId([
      input.sourceUrl,
      input.streamType,
      resolution ?? '',
      String(input.bitrate ?? ''),
      String(input.originalIndex),
      input.representationId ?? '',
      input.audioSourceUrl ?? '',
    ]),
    sourceUrl: input.sourceUrl,
    streamType: input.streamType,
    label,
    resolution,
    width,
    height,
    bitrate: input.bitrate ?? null,
    averageBitrate: input.averageBitrate ?? null,
    videoBitrate: null,
    audioBitrate: null,
    codecs: input.codecs ?? null,
    videoCodec,
    audioCodec,
    container: input.container,
    mimeType: input.mimeType ?? null,
    estimatedFileSize: input.estimatedFileSize ?? null,
    frameRate: input.frameRate ?? null,
    downloadable: input.downloadable,
    unsupportedReason: input.unsupportedReason ?? null,
    ...(input.representationId ? { representationId: input.representationId } : {}),
    ...(input.audioSourceUrl ? { audioSourceUrl: input.audioSourceUrl } : {}),
  };
}

export function applyPrimarySummary(
  base: MediaAnalysisResult,
  variants: MediaAnalysisVariant[],
): MediaAnalysisResult {
  const downloadable = variants.some((variant) => variant.downloadable);
  const primary =
    variants
      .filter((variant) => variant.downloadable)
      .slice()
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0] ??
    variants[0] ??
    null;

  if (!primary) {
    return {
      ...base,
      variants: [],
      downloadable: false,
      unsupportedReason: base.unsupportedReason ?? 'UNSUPPORTED_STREAM',
      width: null,
      height: null,
      resolution: null,
      bitrate: null,
      fps: null,
    };
  }

  return {
    ...base,
    variants,
    downloadable,
    unsupportedReason: downloadable ? null : base.unsupportedReason,
    width: primary.width,
    height: primary.height,
    resolution: primary.resolution,
    bitrate: primary.bitrate,
    fps: primary.frameRate,
    mimeType: primary.mimeType ?? base.mimeType,
    container:
      primary.container !== 'unknown' ? primary.container : base.container,
    fileSize:
      primary.estimatedFileSize != null
        ? String(primary.estimatedFileSize)
        : base.fileSize,
  };
}
