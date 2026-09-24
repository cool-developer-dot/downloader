/**
 * Evidence-based general-web network resource classification.
 * No site-specific host allowlists. Extension is a signal, not a requirement.
 */

import { isMediaMimeType, parseExtensionFromUrl } from '../parsers/extension.parser';
import { isDashMimeType } from '../parsers/dash.parser';
import { isHlsMimeType } from '../parsers/hls.parser';
import { VIDEO_FORMATS } from '../resource/video-resource';
import {
  urlHasMediaQueryEvidence,
  urlHasPlaybackMediaEvidence,
  urlHasPlaybackPathEvidence,
} from './playback-media-evidence';

export type GeneralCandidateFamily =
  | 'progressive'
  | 'hls'
  | 'dash'
  | 'html'
  | 'script'
  | 'style'
  | 'image'
  | 'json'
  | 'api'
  | 'ad'
  | 'segment'
  | 'player-document'
  | 'unknown';

/** Authoritative conceptual families — one classifier, one vocabulary. */
export type DynamicResourceFamily =
  | 'PROGRESSIVE_MEDIA'
  | 'HLS_MANIFEST'
  | 'DASH_MANIFEST'
  | 'MEDIA_SEGMENT'
  | 'PLAYER_DOCUMENT'
  | 'HTML_DOCUMENT'
  | 'SCRIPT'
  | 'STYLE'
  | 'IMAGE'
  | 'JSON_API'
  | 'AD_RESOURCE'
  | 'UNKNOWN';

export type GeneralNetworkRejectionReason =
  | 'html_document'
  | 'player_document'
  | 'script'
  | 'style'
  | 'image'
  | 'json'
  | 'api'
  | 'ad'
  | 'segment'
  | 'arbitrary_extensionless'
  | 'non_media'
  | null;

export type GeneralNetworkClassification = {
  family: GeneralCandidateFamily;
  acceptForIngest: boolean;
  acceptForProbe: boolean;
  rejectionReason: GeneralNetworkRejectionReason;
  pathShape: string;
  hostClass: string;
  mimeHintClass: string;
  candidateFamily: GeneralCandidateFamily;
};

const SKIP_EXT = new Set([
  'js',
  'css',
  'map',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'json',
  'html',
  'htm',
  'xml',
]);

const MEDIA_EXT = new Set([
  ...Object.keys(VIDEO_FORMATS),
  'mp4',
  'webm',
  'mov',
  'm4v',
  'mkv',
  'avi',
  'mpeg',
  'mpg',
  'm3u8',
  'mpd',
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'ogv',
  'opus',
  'wav',
  'flac',
  '3gp',
  '3g2',
]);

const SEGMENT_EXT = new Set(['ts', 'm4s', 'm2ts', 'cmfv']);

const MEDIA_FAMILY_PATH_RE =
  /(?:^|\/)(?:hls|m3u8|manifest|playlist|stream(?:ing)?|vod|videoplayback|dashplaylist)(?:[/._-]|$)/i;

const VIDEO_MEDIA_PATH_RE = /(?:^|\/)video(?:[/._-]|$)/i;

const VIDEO_OBJECT_PATH_RE = /(?:^|\/)v\/t\d{2,}(?:[/._-]|$)/i;

const API_PATH_RE =
  /(?:^|\/)(?:api|graphql|metadata|beacon|analytics|tracking|telemetry|stats)(?:[/._-]|$)/i;

const AD_PATH_RE =
  /(?:^|\/)(?:ad(?:s|server|tag)?|vast|vmap|ima|sponsor|promoted)(?:[/._-]|$)/i;

const PLAYER_DOCUMENT_PATH_RE =
  /\/player\/[A-Za-z0-9_.-]+\/?(?:index\.html?)?$/i;

const SEGMENT_PATH_RE =
  /(?:^|\/)(?:seg(?:ment)?s?|chunk|frag(?:ment)?)(?:[_./-]|$)/i;

/** Init / ISO-BMFF fragment filenames — never whole-file progressive. */
const INIT_SEGMENT_NAME_RE =
  /(?:^|\/)(?:init|isinit)(?:[_./-]|$)|(?:^|\/)init[-_.]?\d*\.(?:mp4|m4s|cmfv)$/i;

const MAIN_FRAME_HTML_PATH_RE =
  /\/(?:video|watch|embed|media)\/[A-Za-z0-9_-]+\/?$/i;

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function mimeClass(mime: string | null | undefined): string {
  if (!mime) {
    return 'none';
  }
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (base.startsWith('video/')) {
    return 'video';
  }
  if (base.includes('mpegurl')) {
    return 'mpegurl';
  }
  if (base.includes('dash+xml')) {
    return 'dash';
  }
  if (base.startsWith('audio/')) {
    return 'audio';
  }
  if (base.startsWith('image/')) {
    return 'image';
  }
  if (base.startsWith('text/html')) {
    return 'html';
  }
  if (base.includes('json')) {
    return 'json';
  }
  if (base.startsWith('text/')) {
    return 'text';
  }
  if (base === '*/*' || base === '') {
    return 'wildcard';
  }
  return 'other';
}

function pathShapeOf(pathname: string): string {
  const lower = pathname.toLowerCase();
  if (/\.m3u8(?:$|\/)/.test(lower) || lower.endsWith('.m3u8')) {
    return 'hls-ext';
  }
  if (lower.endsWith('.mpd')) {
    return 'dash-ext';
  }
  if (/\.(mp4|webm|mov|m4v)(?:$)/.test(lower)) {
    return 'progressive-ext';
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return 'html';
  }
  if (MEDIA_FAMILY_PATH_RE.test(lower)) {
    return 'media-family';
  }
  if (VIDEO_MEDIA_PATH_RE.test(lower)) {
    return 'video-path';
  }
  if (API_PATH_RE.test(lower)) {
    return 'api';
  }
  if (!parseExtensionFromUrl(`https://x.invalid${pathname}`)) {
    return 'extensionless';
  }
  return 'other';
}

export function looksLikeMediaFamilyPath(url: string): boolean {
  const parsed = safeUrl(url);
  if (!parsed) {
    return false;
  }
  const path = parsed.pathname;
  return (
    MEDIA_FAMILY_PATH_RE.test(path) ||
    VIDEO_MEDIA_PATH_RE.test(path) ||
    VIDEO_OBJECT_PATH_RE.test(path) ||
    urlHasPlaybackPathEvidence(url)
  );
}

export function looksLikeHlsPlaylistPath(url: string): boolean {
  const parsed = safeUrl(url);
  if (!parsed) {
    return false;
  }
  const ext = parseExtensionFromUrl(url);
  if (ext && SEGMENT_EXT.has(ext)) {
    return false;
  }
  const path = parsed.pathname.toLowerCase();
  if (path.endsWith('.m3u8') || path.includes('.m3u8')) {
    return true;
  }
  return /(?:^|\/)(?:hls|playlist)(?:[/._-]|$)/i.test(path);
}

export function isInitOrFragmentMediaPath(url: string): boolean {
  const parsed = safeUrl(url);
  const path = (parsed?.pathname ?? url).toLowerCase();
  if (INIT_SEGMENT_NAME_RE.test(path)) {
    return true;
  }
  const last = path.split('/').pop() ?? '';
  return /^(?:init|isinit)[-_.]?\d*\.(?:mp4|m4s|cmfv)$/i.test(last);
}

export function toAuthoritativeResourceFamily(
  family: GeneralCandidateFamily,
): DynamicResourceFamily {
  switch (family) {
    case 'progressive':
      return 'PROGRESSIVE_MEDIA';
    case 'hls':
      return 'HLS_MANIFEST';
    case 'dash':
      return 'DASH_MANIFEST';
    case 'segment':
      return 'MEDIA_SEGMENT';
    case 'player-document':
      return 'PLAYER_DOCUMENT';
    case 'html':
      return 'HTML_DOCUMENT';
    case 'script':
      return 'SCRIPT';
    case 'style':
      return 'STYLE';
    case 'image':
      return 'IMAGE';
    case 'json':
    case 'api':
      return 'JSON_API';
    case 'ad':
      return 'AD_RESOURCE';
    default:
      return 'UNKNOWN';
  }
}

export function looksLikeDashManifestPath(url: string): boolean {
  const parsed = safeUrl(url);
  if (!parsed) {
    return false;
  }
  const ext = parseExtensionFromUrl(url);
  if (ext && SEGMENT_EXT.has(ext)) {
    return false;
  }
  const path = parsed.pathname.toLowerCase();
  if (path.endsWith('.mpd') || path.includes('.mpd')) {
    return true;
  }
  return /(?:^|\/)(?:dash|mpd)(?:[/._-]|$)/i.test(path);
}

export function isPlayerDocumentResource(
  url: string,
  mimeType?: string | null,
): boolean {
  const mime = mimeType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    return true;
  }
  const ext = parseExtensionFromUrl(url);
  if (ext === 'html' || ext === 'htm') {
    return true;
  }
  const parsed = safeUrl(url);
  if (!parsed) {
    return false;
  }
  const path = parsed.pathname;
  if (PLAYER_DOCUMENT_PATH_RE.test(path) && !MEDIA_EXT.has(ext ?? '')) {
    return true;
  }
  return false;
}

export function isMainFrameHtmlPagePath(
  url: string,
  isForMainFrame: boolean,
): boolean {
  if (!isForMainFrame) {
    return false;
  }
  const parsed = safeUrl(url);
  if (!parsed) {
    return false;
  }
  const ext = parseExtensionFromUrl(url);
  if (ext === 'html' || ext === 'htm') {
    return true;
  }
  if (ext && MEDIA_EXT.has(ext)) {
    return false;
  }
  return MAIN_FRAME_HTML_PATH_RE.test(parsed.pathname);
}

export type NativePrefilterReason =
  | 'NON_HTTP'
  | 'SKIP_EXTENSION'
  | 'SEGMENT'
  | 'API_PATH'
  | 'PLAYER_DOCUMENT'
  | 'MAIN_FRAME_HTML'
  | 'NO_MEDIA_EVIDENCE'
  | null;

export type NativePrefilterDecision = {
  observe: boolean;
  reason: NativePrefilterReason;
  pathClass: string;
  hostClass: string;
  acceptClass: string;
  resourceTypeHint: string;
};

/**
 * Native-equivalent gate: should this request be emitted from shouldInterceptRequest?
 * `isForMainFrame === false` means "subresource" (Android sets it only for the top-level document
 * request), so a ranged or media-shaped subresource counts as media evidence from any frame.
 */
export function nativeNetworkPrefilter(input: {
  url: string;
  mimeHint?: string | null;
  accept?: string | null;
  hasRange?: boolean;
  isForMainFrame?: boolean;
}): NativePrefilterDecision {
  const url = input.url.trim();
  const parsed = safeUrl(url);
  const path = parsed?.pathname ?? '';
  const hostClass = parsed ? classifyHostClass(parsed.hostname) : 'unknown';
  const pathClass = pathShapeOf(path);
  const acceptRaw = input.accept ?? input.mimeHint ?? '';
  const acceptClass = mimeClass(acceptRaw || null);
  const reject = (reason: NativePrefilterReason): NativePrefilterDecision => ({
    observe: false,
    reason,
    pathClass,
    hostClass,
    acceptClass,
    resourceTypeHint: pathClass,
  });

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return reject('NON_HTTP');
  }
  const ext = parseExtensionFromUrl(url);
  if (ext && SKIP_EXT.has(ext)) {
    return reject('SKIP_EXTENSION');
  }
  if (ext && SEGMENT_EXT.has(ext)) {
    return reject('SEGMENT');
  }
  if (isInitOrFragmentMediaPath(url)) {
    return reject('SEGMENT');
  }
  if (
    SEGMENT_PATH_RE.test(parsed?.pathname ?? url) &&
    !url.toLowerCase().includes('.m3u8') &&
    !url.toLowerCase().includes('.mpd')
  ) {
    return reject('SEGMENT');
  }
  if (isPlayerDocumentResource(url, input.mimeHint)) {
    return reject('PLAYER_DOCUMENT');
  }
  if (isMainFrameHtmlPagePath(url, Boolean(input.isForMainFrame))) {
    return reject('MAIN_FRAME_HTML');
  }
  if (API_PATH_RE.test(parsed?.pathname ?? '')) {
    return reject('API_PATH');
  }

  const accept = acceptRaw.toLowerCase();
  const acceptLooksMedia = /video\/|audio\/|mpegurl|dash\+xml/.test(accept);
  const pathLooksMedia = Boolean(ext && MEDIA_EXT.has(ext));
  const family = looksLikeMediaFamilyPath(url) || looksLikeHlsPlaylistPath(url) || looksLikeDashManifestPath(url);
  const playbackEvidence = urlHasPlaybackMediaEvidence(url);
  const subresourceHint = input.isForMainFrame === false && (Boolean(input.hasRange) || family || acceptLooksMedia || playbackEvidence);
  const rangeFamily = Boolean(input.hasRange) && family;

  if (!(pathLooksMedia || acceptLooksMedia || subresourceHint || rangeFamily || playbackEvidence)) {
    return reject('NO_MEDIA_EVIDENCE');
  }

  return {
    observe: true,
    reason: null,
    pathClass,
    hostClass,
    acceptClass,
    resourceTypeHint: subresourceHint && !pathLooksMedia ? 'range-subresource' : pathClass,
  };
}

export function shouldObserveNativeNetworkRequest(input: {
  url: string;
  mimeHint?: string | null;
  accept?: string | null;
  hasRange?: boolean;
  isForMainFrame?: boolean;
}): boolean {
  return nativeNetworkPrefilter(input).observe;
}

export function resourceFingerprintFromUrl(url: string): string | null {
  const parsed = safeUrl(url);
  if (!parsed) {
    return null;
  }
  const key = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function classifyGeneralNetworkResource(input: {
  url: string;
  mimeType?: string | null;
  hasRange?: boolean;
  isForMainFrame?: boolean;
}): GeneralNetworkClassification {
  const parsed = safeUrl(input.url);
  const path = parsed?.pathname ?? '';
  const ext = parseExtensionFromUrl(input.url);
  const mime = input.mimeType ?? null;
  const hostClass = parsed ? classifyHostClass(parsed.hostname) : 'unknown';
  const pathShape = pathShapeOf(path);
  const mimeHintClass = mimeClass(mime);

  const reject = (
    family: GeneralCandidateFamily,
    reason: GeneralNetworkRejectionReason,
  ): GeneralNetworkClassification => ({
    family,
    acceptForIngest: false,
    acceptForProbe: false,
    rejectionReason: reason,
    pathShape,
    hostClass,
    mimeHintClass,
    candidateFamily: family,
  });

  const accept = (
    family: GeneralCandidateFamily,
    probe = false,
  ): GeneralNetworkClassification => ({
    family,
    acceptForIngest: !probe,
    acceptForProbe: probe,
    rejectionReason: null,
    pathShape,
    hostClass,
    mimeHintClass,
    candidateFamily: family,
  });

  if (!parsed) {
    return reject('unknown', 'non_media');
  }

  if (ext && SKIP_EXT.has(ext)) {
    if (ext === 'js') {
      return reject('script', 'script');
    }
    if (ext === 'css') {
      return reject('style', 'style');
    }
    if (ext === 'html' || ext === 'htm') {
      return reject('html', 'html_document');
    }
    if (ext === 'json') {
      return reject('json', 'json');
    }
    if (
      ext === 'png' ||
      ext === 'jpg' ||
      ext === 'jpeg' ||
      ext === 'gif' ||
      ext === 'webp' ||
      ext === 'svg' ||
      ext === 'ico'
    ) {
      return reject('image', 'image');
    }
    return reject('unknown', 'non_media');
  }

  const mimeBase = mime?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mimeBase.startsWith('image/')) {
    return reject('image', 'image');
  }
  if (mimeBase === 'text/html' || mimeBase === 'application/xhtml+xml') {
    return reject('html', 'html_document');
  }
  if (mimeBase.includes('json') || mimeBase === 'application/json') {
    return reject('json', 'json');
  }
  if (isPlayerDocumentResource(input.url, mime)) {
    return reject('player-document', 'player_document');
  }
  if (isMainFrameHtmlPagePath(input.url, Boolean(input.isForMainFrame))) {
    return reject('html', 'html_document');
  }
  if (API_PATH_RE.test(path)) {
    return reject('api', 'api');
  }
  if (AD_PATH_RE.test(path)) {
    return reject('ad', 'ad');
  }
  if (
    isInitOrFragmentMediaPath(input.url) ||
    (ext && SEGMENT_EXT.has(ext)) ||
    (SEGMENT_PATH_RE.test(path) &&
      !input.url.toLowerCase().includes('.m3u8') &&
      !input.url.toLowerCase().includes('.mpd'))
  ) {
    return reject('segment', 'segment');
  }

  if (isHlsMimeType(mime) || looksLikeHlsPlaylistPath(input.url)) {
    return accept('hls');
  }
  if (isDashMimeType(mime) || looksLikeDashManifestPath(input.url)) {
    return accept('dash');
  }
  if (isMediaMimeType(mime) || (ext && MEDIA_EXT.has(ext) && ext !== 'm3u8' && ext !== 'mpd')) {
    return accept('progressive');
  }

  const familyPath = looksLikeMediaFamilyPath(input.url);
  const playbackQuery = urlHasMediaQueryEvidence(input.url);
  const playbackPath = urlHasPlaybackPathEvidence(input.url);
  if (input.hasRange && familyPath) {
    return accept('progressive');
  }
  // Query mime/format is strong even without a file extension.
  if (playbackQuery) {
    return accept('progressive');
  }
  if (playbackPath && (input.hasRange || input.isForMainFrame === false)) {
    return accept('progressive');
  }
  if (playbackPath) {
    return accept('progressive', true);
  }
  // Extensionless CDN progressive: video MIME already accepted above.
  // A ranged subresource request (any frame) is media request context; ownership decides the rest.
  if (!ext && input.hasRange && input.isForMainFrame === false) {
    return accept('progressive');
  }
  if (familyPath && input.isForMainFrame === false) {
    return accept('progressive', true);
  }

  if (!ext && !isMediaMimeType(mime) && !input.hasRange) {
    return reject('unknown', 'arbitrary_extensionless');
  }
  if (!ext && input.hasRange && !familyPath) {
    return reject('unknown', 'arbitrary_extensionless');
  }

  return reject('unknown', 'non_media');
}

export function classifyDynamicMediaResource(input: {
  url: string;
  mimeType?: string | null;
  hasRange?: boolean;
  isForMainFrame?: boolean;
}): GeneralNetworkClassification & { authoritativeFamily: DynamicResourceFamily } {
  const classified = classifyGeneralNetworkResource(input);
  return {
    ...classified,
    authoritativeFamily: toAuthoritativeResourceFamily(classified.family),
  };
}

export function classifyHostClass(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '');
  if (!h) {
    return 'unknown';
  }
  if (h.includes('cdn') || h.includes('akamai') || h.includes('cloudfront') || h.includes('fastly')) {
    return 'cdn-generic';
  }
  if (h.startsWith('geo.') || h.startsWith('player.') || h.startsWith('embed.')) {
    return 'player-host';
  }
  return 'site-host';
}

export function classifyHostRelation(pageHost: string, requestHost: string): string {
  const a = pageHost.toLowerCase().replace(/^www\./, '');
  const b = requestHost.toLowerCase().replace(/^www\./, '');
  if (!a || !b) {
    return 'unknown';
  }
  if (a === b) {
    return 'same-host';
  }
  if (b.endsWith(`.${a}`) || a.endsWith(`.${b}`)) {
    return 'related-host';
  }
  const aParts = a.split('.');
  const bParts = b.split('.');
  if (aParts.length >= 2 && bParts.length >= 2) {
    const aRoot = aParts.slice(-2).join('.');
    const bRoot = bParts.slice(-2).join('.');
    if (aRoot === bRoot) {
      return 'related-host';
    }
  }
  return 'cross-host';
}

export function classifyPathShape(url: string): string {
  const parsed = safeUrl(url);
  return pathShapeOf(parsed?.pathname ?? '');
}
