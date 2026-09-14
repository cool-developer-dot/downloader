import { REJECT_MIME_EXACT, REJECT_MIME_PREFIXES } from '../constants';
import { isWeakMediaExtension, parseExtensionFromUrl } from '../parsers/extension.parser';
import {
  isLikelySocialProfileAsset,
  isLikelySocialThumbnail,
} from '../platform/cdn-hosts';
import { isLikelyTikTokProgressiveMediaUrl } from '../social/tiktok-media-resource';

const ANALYTICS_HOST_HINTS = [
  'google-analytics',
  'googletagmanager',
  'doubleclick',
  'facebook.com/tr',
  'analytics',
  'scorecardresearch',
  'hotjar',
  'segment.io',
  'mixpanel',
  'sentry.io',
];

const NON_MEDIA_PATH_EXTS = new Set([
  'js',
  'css',
  'map',
  'json',
  'html',
  'htm',
  'xml',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'vtt',
  'srt',
  'ass',
  'ssa',
]);

/** HLS/DASH segment path heuristics — never surface as standalone videos. */
const SEGMENT_PATH_RE =
  /(?:^|\/)(?:seg(?:ment)?s?|chunk|frag(?:ment)?|media[_-]?\d+|index\d*)(?:[_-]|\.|\/|$)/i;

const SEGMENT_QUERY_RE = /(?:[?&](?:seg(?:ment)?|chunk|frag|byterange)=)/i;

export type FalsePositiveReason =
  | 'blocked_mime'
  | 'non_media_extension'
  | 'analytics'
  | 'hls_segment'
  | 'weak_extension_alone'
  | 'keyword_only'
  | 'subtitle'
  | 'blob_scheme'
  | null;

/**
 * Reject obvious non-media / noisy candidates before pipeline ingest.
 */
export function classifyFalsePositive(input: {
  url: string;
  mimeType?: string | null;
  /** When true, weak .ts is allowed (parent HLS context). */
  allowWeakExtension?: boolean;
  confidenceHint?: number;
}): FalsePositiveReason {
  const { url, mimeType, allowWeakExtension, confidenceHint } = input;
  const lower = url.trim().toLowerCase();

  if (lower.startsWith('blob:')) {
    return 'blob_scheme';
  }

  if (mimeType) {
    const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (
      (REJECT_MIME_PREFIXES as readonly string[]).some((p) =>
        base.startsWith(p),
      )
    ) {
      // application/dash+xml and HLS mimes are not in reject list.
      if (
        base !== 'application/dash+xml' &&
        !base.includes('mpegurl') &&
        !(base.startsWith('video/') || base.startsWith('audio/'))
      ) {
        return 'blocked_mime';
      }
    }
    if (base === 'text/vtt' || base === 'application/x-subrip') {
      return 'subtitle';
    }
    if (REJECT_MIME_EXACT.has(base) && !parseExtensionFromUrl(url)) {
      // octet-stream alone without extension — not enough
      if (base === 'application/octet-stream') {
        if (isLikelyTikTokProgressiveMediaUrl(url)) {
          // TikTok MSE Range objects often advertise octet-stream.
        } else {
          return 'blocked_mime';
        }
      }
    }
  }

  const ext = parseExtensionFromUrl(url);
  if (ext && NON_MEDIA_PATH_EXTS.has(ext)) {
    return 'non_media_extension';
  }

  if (ext === 'vtt' || ext === 'srt' || ext === 'ass' || ext === 'ssa') {
    return 'subtitle';
  }

  if (isLikelyAnalyticsUrl(url)) {
    return 'analytics';
  }

  if (isLikelySocialThumbnail(url)) {
    return 'non_media_extension';
  }

  if (isLikelySocialProfileAsset(url)) {
    return 'non_media_extension';
  }

  if (isLikelyMediaSegment(url, ext)) {
    return 'hls_segment';
  }

  if (isWeakMediaExtension(ext) && !allowWeakExtension && !mimeType) {
    return 'weak_extension_alone';
  }

  if (
    typeof confidenceHint === 'number' &&
    confidenceHint <= 0.3 &&
    !ext &&
    !mimeType
  ) {
    return 'keyword_only';
  }

  return null;
}

export function isFalsePositive(input: {
  url: string;
  mimeType?: string | null;
  allowWeakExtension?: boolean;
  confidenceHint?: number;
}): boolean {
  return classifyFalsePositive(input) != null;
}

export function isLikelyMediaSegment(
  url: string,
  extension?: string | null,
): boolean {
  const ext = extension ?? parseExtensionFromUrl(url);
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    if (/^(?:init|isinit)[-_.]?\d*\.(?:mp4|m4s|cmfv)$/i.test(last)) {
      return true;
    }
  } catch {
    // ignore
  }
  if (/(?:^|\/)(?:init|isinit)(?:[_./-]|$)/i.test(url) && (ext === 'mp4' || ext === 'm4s' || ext === 'cmfv' || ext == null)) {
    return true;
  }
  if (ext !== 'ts' && ext !== 'm2ts' && ext !== 'm4s' && ext !== 'cmfv') {
    // Path still may look like a segment without classic ext.
    if (!SEGMENT_PATH_RE.test(url) && !SEGMENT_QUERY_RE.test(url)) {
      return false;
    }
    // Only treat as segment noise when extension is weak/streaming fragment.
    return ext === 'ts' || ext === 'm2ts' || ext === 'm4s' || ext == null;
  }

  // Standalone .ts with segment-like path → segment.
  if (SEGMENT_PATH_RE.test(url) || SEGMENT_QUERY_RE.test(url)) {
    return true;
  }

  // Numeric-only filename like 12.ts / segment0001.ts
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    if (/^(?:seg(?:ment)?|chunk|frag)?[\d_-]+\.(?:ts|m2ts|m4s)$/i.test(last)) {
      return true;
    }
  } catch {
    // ignore
  }

  // Bare .ts without corroborating MIME is treated as segment noise by weak filter.
  return false;
}

function isLikelyAnalyticsUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return ANALYTICS_HOST_HINTS.some((hint) => lower.includes(hint));
}
