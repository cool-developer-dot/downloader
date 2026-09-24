import type { EnqueueRequest, RequestContext, SiteId } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { DownloadQualityOption } from '@/downloads/quality/types';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import { isLikelyMediaSegment } from '@/media-detection/services/false-positive.filter';

/** Why a verified browser variant is not handed to the v2 engine. */
export type V2HandoffRejection =
  /** Encrypted (AES/SAMPLE-AES) or DRM-protected media: never downloadable. */
  | 'PROTECTED'
  /** A live stream: there is no whole video to save. */
  | 'LIVE_UNSUPPORTED'
  /**
   * DASH that needs muxing or segment reassembly, audio-only, segments/fragments, blob/MSE, or anything else
   * outside the supported formats.
   */
  | 'UNSUPPORTED_SOURCE'
  /** The server could not be reached or answered with a temporary error: trying again can work. */
  | 'SOURCE_UNREACHABLE'
  /** The link was refused or has expired: the page has to produce a fresh one. */
  | 'SOURCE_EXPIRED'
  | 'INVALID_SOURCE';

export type V2HandoffInput = {
  /** The exact verified variant the user chose (or the only one). Never re-resolved. */
  option: DownloadQualityOption;
  title: string;
  pageUrl: string | null;
  thumbnailUrl: string | null;
  requestContext: MediaRequestContext | null;
};

export type V2EnqueueDecision =
  | { ok: true; request: EnqueueRequest }
  | { ok: false; reason: V2HandoffRejection };

/**
 * The progressive video containers the native engine can verify, name and play — MediaTypes.kt is the source
 * of this list; `unknown` is an extensionless source verified as progressive video. HLS playlists go to the
 * engine as `hls`; DASH manifests and media segments are refused separately.
 */
const PROGRESSIVE_VIDEO_CONTAINERS = new Set([
  'mp4',
  'm4v',
  'mov',
  'webm',
  'avi',
  'wmv',
  'mkv',
  'ts',
  'flv',
  '3gp',
  'unknown',
]);

/** Never crosses the bridge: native attaches cookies itself from CookieManager when `useCookies` is set. */
const SECRET_HEADERS = new Set(['cookie', 'authorization', 'proxy-authorization']);
/** Carried in dedicated `RequestContext` fields instead. */
const CONTEXT_HEADERS = new Set(['user-agent', 'referer', 'origin']);

const SITE_HOSTS: readonly (readonly [SiteId, readonly string[]])[] = [
  ['instagram', ['instagram.com']],
  ['facebook', ['facebook.com', 'fb.watch', 'fb.com']],
  ['tiktok', ['tiktok.com']],
  ['twitter', ['twitter.com', 'x.com']],
  ['reddit', ['reddit.com', 'redd.it']],
  ['vimeo', ['vimeo.com']],
  ['dailymotion', ['dailymotion.com', 'dai.ly']],
  ['twitch', ['twitch.tv']],
  ['pinterest', ['pinterest.com', 'pin.it']],
  ['snapchat', ['snapchat.com']],
  ['linkedin', ['linkedin.com']],
];

/** Library/site grouping only — never a support decision. */
export function siteIdForPage(pageUrl: string | null | undefined): SiteId {
  const host = httpUrl(pageUrl)?.hostname.toLowerCase();
  if (!host) {
    return 'web';
  }
  for (const [site, hosts] of SITE_HOSTS) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return site;
    }
  }
  return 'web';
}

function httpUrl(raw: string | null | undefined): URL | null {
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function pathExtension(url: URL): string | null {
  const last = url.pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : null;
}

function isHlsOption(option: DownloadQualityOption, source: URL): boolean {
  const ext = pathExtension(source);
  return (
    option.isHls ||
    option.streamType === 'HLS' ||
    option.container === 'hls' ||
    ext === 'm3u8' ||
    ext === 'm3u' ||
    option.mimeType?.toLowerCase().includes('mpegurl') === true
  );
}

/**
 * A DASH option: its URL is the manifest and the native classifier chose one of its representations as the file to
 * download. Recognised by the stream type the verifier gave it (the manifest may have no `.mpd` extension).
 */
function isDashOption(option: DownloadQualityOption, source: URL): boolean {
  return (
    option.streamType === 'DASH' ||
    pathExtension(source) === 'mpd' ||
    option.mimeType?.toLowerCase().includes('dash+xml') === true
  );
}

/** What a non-downloadable option's analysis already proved about it. */
function rejectionForUnavailable(option: DownloadQualityOption): V2HandoffRejection {
  if (option.sourceUrl?.startsWith('blob:')) {
    return 'UNSUPPORTED_SOURCE';
  }
  switch (option.unavailableReason) {
    case 'DRM_PROTECTED':
    case 'ENCRYPTED_MEDIA':
      return 'PROTECTED';
    case 'UNSUPPORTED_FORMAT':
    case 'UNSUPPORTED_STREAM':
    case 'NO_MEDIA':
      return 'UNSUPPORTED_SOURCE';
    case 'NETWORK_ERROR':
      return 'SOURCE_UNREACHABLE';
    default:
      return 'INVALID_SOURCE';
  }
}

function classifyProgressive(option: DownloadQualityOption, source: URL): V2HandoffRejection | null {
  const ext = pathExtension(source);
  if (ext === 'mpd' || option.mimeType?.toLowerCase().includes('dash')) {
    return 'UNSUPPORTED_SOURCE';
  }
  if (option.isAudioOnly || option.streamType === 'AUDIO' || option.mediaType === 'audio' || option.hasVideo === false) {
    return 'UNSUPPORTED_SOURCE';
  }
  if (option.streamType !== 'PROGRESSIVE' && option.isProgressive !== true) {
    return 'UNSUPPORTED_SOURCE';
  }
  if (!PROGRESSIVE_VIDEO_CONTAINERS.has(option.container)) {
    return 'UNSUPPORTED_SOURCE';
  }
  if (isLikelyMediaSegment(source.toString(), ext)) {
    return 'UNSUPPORTED_SOURCE';
  }
  return null;
}

/** The engine's request context for a verified source: UA, Referer, Origin and headers — never a cookie value. */
export function toV2RequestContext(ctx: MediaRequestContext | null, pageUrl: string | null): RequestContext {
  const headers: Record<string, string> = {};
  let userAgent = ctx?.userAgent?.trim() || undefined;
  let origin: string | undefined;
  for (const [name, value] of Object.entries(ctx?.headers ?? {})) {
    const lower = name.toLowerCase();
    if (typeof value !== 'string') {
      continue;
    }
    if (lower === 'user-agent') {
      userAgent = userAgent ?? (value.trim() || undefined);
    }
    // An observed Origin is part of how the request was made (CORS-checked CDNs require it); it has a dedicated
    // field, so it must be carried there rather than dropped with the other context headers.
    if (lower === 'origin') {
      origin = httpUrl(value.trim())?.origin;
    }
    if (SECRET_HEADERS.has(lower) || CONTEXT_HEADERS.has(lower)) {
      continue;
    }
    headers[name] = value;
  }
  const referer = httpUrl(ctx?.referer)?.toString() ?? httpUrl(pageUrl)?.toString();
  return {
    ...(userAgent ? { userAgent } : {}),
    ...(referer ? { referer } : {}),
    ...(origin ? { origin } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    useCookies: Boolean(ctx?.cookiesRequired || ctx?.hasCookies),
  };
}

function positiveBytes(option: DownloadQualityOption): number | undefined {
  const raw = option.fileSize != null ? Number(option.fileSize) : option.estimatedFileSize;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : undefined;
}

/**
 * Builds the v2 enqueue request for exactly the chosen verified variant, or says truthfully why it cannot be
 * downloaded. Pure: no network, no re-resolution, no substitution.
 *
 * An HLS variant is handed over as `hls`: its playlist URL (the variant's own media playlist, or a multivariant
 * playlist with the chosen height as the ceiling). A DASH option is handed over as `dash`: the manifest URL with
 * the exact representation (`variant.videoId`) and its height as the ceiling. Whether either is actually
 * downloadable is the native classifier's call right before enqueue (see `handOffVerifiedVariant`).
 */
export function buildV2EnqueueRequest(input: V2HandoffInput): V2EnqueueDecision {
  const { option } = input;
  const source = httpUrl(option.sourceUrl);
  if (!source) {
    return { ok: false, reason: option.sourceUrl?.startsWith('blob:') ? 'UNSUPPORTED_SOURCE' : 'INVALID_SOURCE' };
  }
  const hls = isHlsOption(option, source);
  const dash = !hls && isDashOption(option, source);
  if (!hls) {
    if (!option.downloadable) {
      return { ok: false, reason: rejectionForUnavailable(option) };
    }
    const rejection = dash ? null : classifyProgressive(option, source);
    if (rejection) {
      return { ok: false, reason: rejection };
    }
  }
  const pageUrl = httpUrl(input.pageUrl ?? input.requestContext?.pageUrl)?.toString() ?? null;
  const thumbnailUrl = httpUrl(input.thumbnailUrl)?.toString();
  const estimatedBytes = positiveBytes(option);
  const qualityLabel = option.label?.trim();
  const stream = hls || dash;
  const maxHeight = stream && typeof option.height === 'number' && option.height > 0 ? Math.trunc(option.height) : null;
  // The exact DASH representation the user picked: downloaded as chosen, or refused — never swapped for another.
  const videoId = dash ? option.representationId?.trim() || null : null;
  return {
    ok: true,
    request: {
      url: option.sourceUrl,
      kind: hls ? 'hls' : dash ? 'dash' : 'progressive',
      ...(maxHeight || videoId
        ? { variant: { ...(videoId ? { videoId } : {}), ...(maxHeight ? { maxHeight } : {}) } }
        : {}),
      request: toV2RequestContext(input.requestContext, pageUrl),
      title: input.title.trim() || 'Video',
      site: siteIdForPage(pageUrl),
      ...(pageUrl ? { pageUrl } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(estimatedBytes ? { estimatedBytes } : {}),
      ...(qualityLabel ? { qualityLabel } : {}),
    },
  };
}

export function v2HandoffRejectionMessage(reason: V2HandoffRejection): string {
  switch (reason) {
    case 'PROTECTED':
      return 'This video is protected and can’t be downloaded.';
    case 'LIVE_UNSUPPORTED':
      return 'Live streams can’t be downloaded.';
    case 'UNSUPPORTED_SOURCE':
      return 'This video format isn’t supported for download.';
    case 'SOURCE_UNREACHABLE':
      return 'Couldn’t reach the video server. Check your connection and try again.';
    case 'SOURCE_EXPIRED':
      return 'Open the video page again to refresh the download link.';
    case 'INVALID_SOURCE':
    default:
      return 'This video is no longer available. Reload the page and try again.';
  }
}
