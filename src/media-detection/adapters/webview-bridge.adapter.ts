import { DETECTION_TIMING } from '../constants';
import {
  MEDIA_BRIDGE_CHANNEL,
  type BridgeActiveVideoPayload,
  type BridgeActiveIframePlayerPayload,
  type BridgeBlobIndicatorPayload,
  type BridgeMediaSourceKind,
  type BridgeErrorPayload,
  type BridgeMediaCandidatePayload,
  type BridgeMutationBatchPayload,
  type BridgePageMetaPayload,
  type DetectionSource,
  type HlsPlaylistType,
  type MediaBridgeEnvelope,
  type MediaBridgeMessageType,
} from '../types';
import { isSafeMediaUrl, normalizeMediaUrl, sanitizeFiniteNumber } from '../utils';

export type ParsedBridgeMessage =
  | { type: 'ready'; payload: Record<string, never> }
  | { type: 'page_meta'; payload: BridgePageMetaPayload }
  | { type: 'media_candidate'; payload: BridgeMediaCandidatePayload }
  | { type: 'mutation_batch'; payload: BridgeMutationBatchPayload }
  | { type: 'scan_complete'; payload: Record<string, never> }
  | { type: 'error'; payload: BridgeErrorPayload }
  | { type: 'blob_indicator'; payload: BridgeBlobIndicatorPayload }
  | { type: 'active_video'; payload: BridgeActiveVideoPayload }
  | { type: 'active_iframe_player'; payload: BridgeActiveIframePlayerPayload };

const DETECTION_SOURCES = new Set<DetectionSource>([
  'dom_video',
  'dom_audio',
  'dom_source',
  'network_request',
  'performance_resource',
  'og_meta',
  'manifest',
  'navigation',
  'js_fetch',
  'js_xhr',
  'native_network',
  'mime_probe',
]);

const PLAYLIST_TYPES = new Set<HlsPlaylistType>([
  'master',
  'variant',
  'media',
  'unknown',
]);

/**
 * Safely parse a WebView onMessage payload.
 * Rejects non-channel messages, malformed JSON, and unshaped payloads.
 */
export function parseMediaBridgeMessage(
  raw: string | undefined | null,
): ParsedBridgeMessage | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  if (raw.length > 200_000) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const envelope = parsed as Partial<MediaBridgeEnvelope>;
  if (envelope.channel !== MEDIA_BRIDGE_CHANNEL) {
    return null;
  }

  const type = envelope.type as MediaBridgeMessageType | undefined;
  if (!type || envelope.payload == null || typeof envelope.payload !== 'object') {
    return null;
  }

  switch (type) {
    case 'ready':
    case 'scan_complete':
      return { type, payload: {} };
    case 'page_meta': {
      const payload = sanitizePageMeta(envelope.payload);
      return payload ? { type, payload } : null;
    }
    case 'media_candidate': {
      const payload = sanitizeCandidate(envelope.payload);
      return payload ? { type, payload } : null;
    }
    case 'mutation_batch': {
      const payload = sanitizeBatch(envelope.payload);
      return payload ? { type, payload } : null;
    }
    case 'blob_indicator': {
      const payload = sanitizeBlobIndicator(envelope.payload);
      return payload ? { type, payload } : null;
    }
    case 'active_video': {
      const payload = sanitizeActiveVideo(envelope.payload);
      return payload ? { type, payload } : null;
    }
    case 'active_iframe_player': {
      const payload = sanitizeActiveIframePlayer(envelope.payload);
      return payload ? { type, payload } : null;
    }
    case 'error': {
      const payload = sanitizeError(envelope.payload);
      return payload ? { type, payload } : null;
    }
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, max = 2_048): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, max);
}

function requiredPageUrl(value: unknown): string | null {
  const raw = optionalString(value, 8_192);
  if (!raw) {
    return null;
  }
  return normalizeMediaUrl(raw);
}

function sanitizePageMeta(raw: unknown): BridgePageMetaPayload | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const pageUrl = requiredPageUrl(obj.pageUrl);
  if (!pageUrl) {
    return null;
  }

  return {
    pageUrl,
    title: optionalString(obj.title, 500),
    description: optionalString(obj.description, 500),
    ogImage: sanitizeOptionalHttpUrl(obj.ogImage, pageUrl),
    ogVideo: sanitizeOptionalHttpUrl(obj.ogVideo, pageUrl),
    canonicalUrl: sanitizeOptionalHttpUrl(obj.canonicalUrl, pageUrl),
  };
}

function sanitizeCandidate(raw: unknown): BridgeMediaCandidatePayload | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }

  const pageUrl = requiredPageUrl(obj.pageUrl);
  if (!pageUrl) {
    return null;
  }

  const urlRaw = optionalString(obj.url, 8_192);
  if (!urlRaw) {
    return null;
  }

  // Blob URLs must never become candidates.
  if (urlRaw.toLowerCase().startsWith('blob:')) {
    return null;
  }

  let absoluteUrl: string | null = null;
  try {
    absoluteUrl = normalizeMediaUrl(new URL(urlRaw, pageUrl).toString());
  } catch {
    absoluteUrl = normalizeMediaUrl(urlRaw);
  }
  if (!absoluteUrl || !isSafeMediaUrl(absoluteUrl)) {
    return null;
  }

  const source = obj.detectionSource;
  if (typeof source !== 'string' || !DETECTION_SOURCES.has(source as DetectionSource)) {
    return null;
  }

  const playlistType =
    obj.playlistType == null
      ? null
      : typeof obj.playlistType === 'string' &&
          PLAYLIST_TYPES.has(obj.playlistType as HlsPlaylistType)
        ? (obj.playlistType as HlsPlaylistType)
        : null;

  const blobIndicator = optionalString(obj.blobIndicator, 512);
  if (blobIndicator && !blobIndicator.toLowerCase().startsWith('blob:')) {
    // ignore non-blob indicators
  }

  return {
    url: absoluteUrl,
    pageUrl,
    mimeType: optionalString(obj.mimeType, 128),
    extension: optionalString(obj.extension, 16),
    title: optionalString(obj.title, 255),
    thumbnailUrl: sanitizeOptionalHttpUrl(obj.thumbnailUrl, pageUrl),
    duration: sanitizeFiniteNumber(obj.duration, { min: 0, max: 864_000 }),
    width: sanitizeFiniteNumber(obj.width, { min: 1, max: 16_384 }),
    height: sanitizeFiniteNumber(obj.height, { min: 1, max: 16_384 }),
    estimatedFileSize: sanitizeFiniteNumber(obj.estimatedFileSize, { min: 0 }),
    isLive: Boolean(obj.isLive),
    isDrm: Boolean(obj.isDrm),
    playlistType,
    detectionSource: source as DetectionSource,
    tagName: optionalString(obj.tagName, 32),
    ownerElementIdentity: optionalString(obj.ownerElementIdentity, 64),
    frameUrl: sanitizeOptionalHttpUrl(obj.frameUrl, pageUrl),
    blobIndicator:
      blobIndicator && blobIndicator.toLowerCase().startsWith('blob:')
        ? blobIndicator
        : null,
  };
}

function sanitizeBatch(raw: unknown): BridgeMutationBatchPayload | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }

  const pageUrl = requiredPageUrl(obj.pageUrl);
  if (!pageUrl) {
    return null;
  }

  if (!Array.isArray(obj.candidates)) {
    return null;
  }

  const candidates: BridgeMediaCandidatePayload[] = [];
  const limit = DETECTION_TIMING.maxCandidatesPerBatch;
  for (const item of obj.candidates.slice(0, limit)) {
    const candidate = sanitizeCandidate({
      ...(asRecord(item) ?? {}),
      pageUrl,
    });
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return { pageUrl, candidates };
}

function sanitizeSourceKind(value: unknown): BridgeMediaSourceKind | null {
  return value === 'mse' || value === 'blob' ? value : null;
}

function sanitizeBlobIndicator(raw: unknown): BridgeBlobIndicatorPayload | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const pageUrl = requiredPageUrl(obj.pageUrl);
  const blobUrl = optionalString(obj.blobUrl, 512);
  if (!pageUrl || !blobUrl || !blobUrl.toLowerCase().startsWith('blob:')) {
    return null;
  }
  return {
    pageUrl,
    blobUrl,
    elementIdentity: optionalString(obj.elementIdentity, 64),
    isProtected: obj.isProtected === true,
    sourceKind: sanitizeSourceKind(obj.sourceKind),
  };
}

function sanitizeActiveVideoSrc(value: unknown, pageUrl: string): string | null {
  const raw = optionalString(value, 8_192);
  if (!raw) {
    return null;
  }
  if (raw.toLowerCase().startsWith('blob:')) {
    return raw.slice(0, 512);
  }
  try {
    const absolute = new URL(raw, pageUrl).toString();
    if (!isSafeMediaUrl(absolute) && !/^https?:\/\//i.test(absolute)) {
      return null;
    }
    // Allow http(s) page-relative media URLs; normalize when safe.
    return normalizeMediaUrl(absolute) ?? absolute.slice(0, 8_192);
  } catch {
    return null;
  }
}

function sanitizeAssociatedContentId(value: unknown): string | null {
  const raw = optionalString(value, 64);
  if (!raw) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{5,32}$/.test(raw)) {
    return null;
  }
  return raw;
}

function sanitizeActiveVideo(raw: unknown): BridgeActiveVideoPayload | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const pageUrl = requiredPageUrl(obj.pageUrl);
  const elementIdentity = optionalString(obj.elementIdentity, 64);
  if (!pageUrl || !elementIdentity) {
    return null;
  }

  const currentSrc = sanitizeActiveVideoSrc(obj.currentSrc, pageUrl);
  const src = sanitizeActiveVideoSrc(obj.src, pageUrl);
  const isBlob = Boolean(
    obj.isBlob ||
      (currentSrc && currentSrc.toLowerCase().startsWith('blob:')) ||
      (src && src.toLowerCase().startsWith('blob:')),
  );

  return {
    pageUrl,
    elementIdentity,
    currentSrc,
    src,
    isBlob,
    paused: typeof obj.paused === 'boolean' ? obj.paused : null,
    ended: typeof obj.ended === 'boolean' ? obj.ended : null,
    readyState: sanitizeFiniteNumber(obj.readyState, { min: 0, max: 4 }),
    videoWidth: sanitizeFiniteNumber(obj.videoWidth, { min: 0, max: 16_384 }),
    videoHeight: sanitizeFiniteNumber(obj.videoHeight, { min: 0, max: 16_384 }),
    muted: typeof obj.muted === 'boolean' ? obj.muted : null,
    currentTimeBucket: sanitizeFiniteNumber(obj.currentTimeBucket, {
      min: 0,
      max: 100_000,
    }),
    intersectionRatio: sanitizeFiniteNumber(obj.intersectionRatio, {
      min: 0,
      max: 1,
    }),
    viewportCenterDistance: sanitizeFiniteNumber(obj.viewportCenterDistance, {
      min: 0,
      max: 100_000,
    }),
    isDisplayed: obj.isDisplayed !== false,
    isVisibleStyle: obj.isVisibleStyle !== false,
    recentlyPlayed: Boolean(obj.recentlyPlayed),
    explicitAdMarker: Boolean(obj.explicitAdMarker),
    associatedContentId: sanitizeAssociatedContentId(obj.associatedContentId),
    isProtected: obj.isProtected === true,
    sourceKind: sanitizeSourceKind(obj.sourceKind),
  };
}

function sanitizeActiveIframePlayer(raw: unknown): BridgeActiveIframePlayerPayload | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const pageUrl = requiredPageUrl(obj.pageUrl);
  const iframeIdentity = optionalString(obj.iframeIdentity, 64);
  if (!pageUrl || !iframeIdentity) {
    return null;
  }

  const iframeSrcRaw = optionalString(obj.iframeSrc, 2_048);
  let iframeSrc: string | null = null;
  if (iframeSrcRaw) {
    const lower = iframeSrcRaw.toLowerCase();
    if (
      !lower.startsWith('blob:') &&
      !lower.startsWith('javascript:') &&
      !lower.startsWith('data:')
    ) {
      try {
        const abs = new URL(iframeSrcRaw, pageUrl);
        if (abs.protocol === 'http:' || abs.protocol === 'https:') {
          iframeSrc = `${abs.origin}${abs.pathname}`.slice(0, 2_048);
        }
      } catch {
        iframeSrc = iframeSrcRaw.split('?')[0]?.slice(0, 2_048) ?? null;
      }
    }
  }

  const frameClass =
    obj.frameClass === 'same-origin' || obj.frameClass === 'cross-origin'
      ? obj.frameClass
      : 'cross-origin';

  return {
    pageUrl,
    iframeIdentity,
    iframeSrc,
    frameClass,
    isDisplayed: obj.isDisplayed !== false,
    isVisibleStyle: obj.isVisibleStyle !== false,
    intersectionRatio: sanitizeFiniteNumber(obj.intersectionRatio, {
      min: 0,
      max: 1,
    }),
    viewportCenterDistance: sanitizeFiniteNumber(obj.viewportCenterDistance, {
      min: 0,
      max: 100_000,
    }),
    width: sanitizeFiniteNumber(obj.width, { min: 0, max: 16_384 }),
    height: sanitizeFiniteNumber(obj.height, { min: 0, max: 16_384 }),
    allowFullscreen: Boolean(obj.allowFullscreen),
    allow: optionalString(obj.allow, 256),
    looksPlayer: Boolean(obj.looksPlayer),
    sameOriginVideoCount: sanitizeFiniteNumber(obj.sameOriginVideoCount, {
      min: 0,
      max: 32,
    }),
    associatedContentId: sanitizeAssociatedContentId(obj.associatedContentId),
  };
}

function sanitizeError(raw: unknown): BridgeErrorPayload | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const code = optionalString(obj.code, 64) ?? 'unknown';
  const message = optionalString(obj.message, 500) ?? 'Detection error';
  return { code, message };
}

function sanitizeOptionalHttpUrl(
  value: unknown,
  pageUrl: string,
): string | null {
  const raw = optionalString(value, 8_192);
  if (!raw) {
    return null;
  }
  if (raw.toLowerCase().startsWith('blob:')) {
    return null;
  }
  try {
    const absolute = new URL(raw, pageUrl).toString();
    return isSafeMediaUrl(absolute) ? normalizeMediaUrl(absolute) : null;
  } catch {
    return null;
  }
}
