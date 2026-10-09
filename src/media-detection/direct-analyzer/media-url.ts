/**
 * Whether a URL found on a fetched page names a video source, and of which kind. Generic: file extensions, MIME hints
 * in the query, and the name of the data field that holds the URL — never a list of sites. The engine's classifier
 * has the last word on every URL that passes here.
 */

import { stableResourcePath } from '../social-source/resource-identity';

export type DirectSourceKind = 'progressive' | 'hls' | 'dash';

export type MediaUrlHint = {
  /** null: the field says video but nothing in the URL says which container — the bytes decide. */
  kind: DirectSourceKind | null;
  /** `strong`: the URL itself says media; `keyed`: only the field it came from does. */
  strength: 'strong' | 'keyed';
};

const PROGRESSIVE_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', '3gp', 'avi', 'wmv', 'flv', 'ogv']);

/** Images, documents, scripts, subtitles, audio and segments: never a whole video. */
const NON_VIDEO_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'heic',
  'js', 'mjs', 'css', 'json', 'html', 'htm', 'php', 'asp', 'aspx', 'xml', 'txt',
  'vtt', 'srt', 'ttml', 'woff', 'woff2', 'ttf', 'otf', 'pdf', 'zip',
  'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'm4s', 'ts', 'cmfv', 'cmfa',
]);

/** Data fields that hold a video's playable URL. */
const VIDEO_URL_KEY =
  /^(?:play_?addr|play_?url|playable_?url\w*|video_?url|video_?src|video_?file|download_?addr|download_?url|content_?url|stream_?url|hls(?:_?(?:url|src|playlist|manifest|stream)\w*)?|dash(?:_?(?:url|src|manifest|playlist|mpd)\w*)?|manifest_?url|mp4(?:_?(?:url|src))?|progressive(?:_?(?:url|src))?)$/i;

/** Generic field names that only count under a video-ish parent (`video_versions[].url`, `video.src`). */
const GENERIC_URL_KEY = /^(?:src|url|urls|url_?list|file|source|sources|href|link)$/i;

const VIDEO_PARENT_KEY = /(?:video|clip|media|stream|play|movie|reel|hls|dash|mp4)/i;

/** Anything a video page links that is not the video: artwork, captions, audio, ads, tracking. */
const EXCLUDED_KEY =
  /(?:thumb|poster|cover|image|img|avatar|icon|logo|sprite|caption|subtitle|vtt|lyric|music|audio|sound|song|profile|banner|still|storyboard|gif|sticker|emoji|font|css|script|preview_?frame|\bads?_|advert|tracking|pixel|beacon|analytics|share_?url)/i;

function extensionOf(pathname: string): string | null {
  const last = pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot < 0 || dot === last.length - 1) {
    return null;
  }
  return last.slice(dot + 1).toLowerCase();
}

/** A MIME type the page put in the query (`mime_type=video_mp4`, `mime=video%2Fmp4`, `type=application/x-mpegURL`). */
function queryKind(search: string): DirectSourceKind | null {
  const q = search.toLowerCase();
  if (/(?:^|[?&])(?:mime_?type|mime|type|format|content_?type)=(?:video(?:_|%2f|\/)(?:mp4|webm|quicktime)|mp4)(?:&|$)/.test(q)) {
    return 'progressive';
  }
  if (/(?:^|[?&])(?:mime_?type|mime|type|format)=(?:application(?:_|%2f|\/)(?:x-)?mpegurl|hls|m3u8)(?:&|$)/.test(q)) {
    return 'hls';
  }
  if (/(?:^|[?&])(?:mime_?type|mime|type|format)=(?:application(?:_|%2f|\/)dash(?:%2b|\+)xml|dash|mpd)(?:&|$)/.test(q)) {
    return 'dash';
  }
  return null;
}

/** An absolute http(s) URL for `raw` on `base`, or null (blob:, data:, javascript: and junk are never sources). */
export function resolvePageUrl(raw: string, base: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 4096 || /^(?:blob|data|javascript|about|mailto|tel):/i.test(value)) {
    return null;
  }
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The media hint for a URL found under `keyPath` (the data field names leading to it, nearest last; empty for markup
 * such as `<video src>`). Null when it is not a video source.
 */
export function classifyMediaUrl(url: string, keyPath: readonly string[] = []): MediaUrlHint | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  // A site root is never a video file.
  if (parsed.pathname === '/' || parsed.pathname === '') {
    return null;
  }
  const recentKeys = keyPath.slice(-3);
  if (recentKeys.some((key) => EXCLUDED_KEY.test(key))) {
    return null;
  }
  const extension = extensionOf(parsed.pathname);
  if (extension === 'm3u8') {
    return { kind: 'hls', strength: 'strong' };
  }
  if (extension === 'mpd') {
    return { kind: 'dash', strength: 'strong' };
  }
  if (extension && PROGRESSIVE_EXTENSIONS.has(extension)) {
    return { kind: 'progressive', strength: 'strong' };
  }
  if (extension && NON_VIDEO_EXTENSIONS.has(extension)) {
    return null;
  }
  const fromQuery = queryKind(parsed.search);
  if (fromQuery) {
    return { kind: fromQuery, strength: 'strong' };
  }
  const key = recentKeys[recentKeys.length - 1];
  if (!key) {
    return null;
  }
  if (VIDEO_URL_KEY.test(key)) {
    return { kind: /hls|m3u8/i.test(key) ? 'hls' : /dash|mpd|manifest/i.test(key) ? 'dash' : null, strength: 'keyed' };
  }
  if (GENERIC_URL_KEY.test(key) && recentKeys.slice(0, -1).some((parent) => VIDEO_PARENT_KEY.test(parent))) {
    return { kind: null, strength: 'keyed' };
  }
  return null;
}

/** A quality label a data field's name implies (`browser_native_hd_url` → HD). */
export function qualityFromKey(key: string | null | undefined): string | null {
  if (!key) {
    return null;
  }
  if (/(?:^|_)(?:hd|high|hq)(?:_|$)/i.test(key) || /(?:HD|High)(?:Url|Src|Addr)?$/.test(key)) {
    return 'HD';
  }
  if (/(?:^|_)(?:sd|low|lq)(?:_|$)/i.test(key) || /(?:SD|Low)(?:Url|Src|Addr)?$/.test(key)) {
    return 'SD';
  }
  const resolution = /(\d{3,4})p/i.exec(key);
  return resolution ? `${resolution[1]}p` : null;
}

/**
 * The file a URL names whatever signature it carries (host, path and content selectors; rotating credential fields
 * dropped) — two URLs with the same key are the same resource.
 */
export function resourceKey(url: string): string {
  return stableResourcePath(url) ?? url;
}
