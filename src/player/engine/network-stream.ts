/**
 * P14 #663 Network Stream: a video link the user types or pastes, played straight from the web without downloading
 * it (screen 52, "Open stream"). Pure: parsing the link and reading the engine's probe. The same refusals as
 * downloads: YouTube and protected (DRM) videos are never played.
 */

import type { ProbeResult } from '@modules/vidorax-media';

import type { StreamContentType } from '../remote-stream';

export type NetworkStreamLink =
  | { ok: true; url: string }
  | { ok: false; reason: 'empty' | 'not_http' | 'invalid' | 'youtube' };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** YouTube's hosts, including its mobile, music, short-link and privacy-mode ones. */
const YOUTUBE_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|youtubekids\.com)$/i;

export function isYouTubeHost(host: string): boolean {
  return YOUTUBE_HOST.test(host.trim().replace(/\.$/, ''));
}

/**
 * The link as the player will open it. A bare `example.com/video.mp4` gets `https://`; only web links play here
 * (`ftp:`, `rtsp:`, `file:` and app links are refused as `not_http`).
 */
export function parseNetworkStreamLink(text: string): NetworkStreamLink {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }
  const withScheme = SCHEME.test(trimmed) && !/^[^/:]+:\d+(\/|$)/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'https:' && scheme !== 'http:') {
    return { ok: false, reason: 'not_http' };
  }
  if (!parsed.hostname || /\s/.test(trimmed)) {
    return { ok: false, reason: 'invalid' };
  }
  if (isYouTubeHost(parsed.hostname)) {
    return { ok: false, reason: 'youtube' };
  }
  return { ok: true, url: parsed.toString() };
}

const PROGRESSIVE_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'webm', 'mkv', '3gp', 'ts', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav',
]);

/** A guess from the link's path alone (`.m3u8` HLS, `.mpd` DASH, a media file); null when the path says nothing. */
export function guessStreamContentType(url: string): StreamContentType | null {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : '';
  if (extension === 'm3u8' || extension === 'm3u') {
    return 'hls';
  }
  if (extension === 'mpd') {
    return 'dash';
  }
  return PROGRESSIVE_EXTENSIONS.has(extension) ? 'progressive' : null;
}

export type NetworkStreamRefusal = 'drm' | 'blocked' | 'not_media' | 'unsupported' | 'not_found' | 'http' | 'network';

export type NetworkStreamPlan =
  | { ok: true; url: string; contentType: StreamContentType }
  | { ok: false; reason: NetworkStreamRefusal };

/**
 * How to play a link, from the engine's probe (it reads the server's answer and the first bytes). The probe judges for
 * downloading, so two of its refusals still play: a live HLS stream (`LIVE_UNSUPPORTED`: it can't be saved, but it can
 * be watched) and a format it can't save but the player may still open, when the link names a playable type.
 * No probe (an older build, or it timed out): the guess from the path, else a plain file.
 */
export function planNetworkStream(url: string, probe: ProbeResult | null): NetworkStreamPlan {
  const guess = guessStreamContentType(url);
  if (!probe) {
    return { ok: true, url, contentType: guess ?? 'progressive' };
  }
  if (probe.ok) {
    const target = probe.finalUrl?.trim() || url;
    switch (probe.kind) {
      case 'progressive':
        return { ok: true, url: target, contentType: 'progressive' };
      case 'hls':
      case 'live':
        return { ok: true, url: target, contentType: 'hls' };
      case 'dash':
        return { ok: true, url: target, contentType: 'dash' };
      default:
        // A split pair (separate picture and sound files) or an FTP file: the player opens one web link only.
        return { ok: false, reason: 'unsupported' };
    }
  }
  switch (probe.reason) {
    case 'DRM_PROTECTED':
      return { ok: false, reason: 'drm' };
    case 'POLICY_BLOCKED':
      return { ok: false, reason: 'blocked' };
    case 'LIVE_UNSUPPORTED':
      return { ok: true, url, contentType: 'hls' };
    case 'NOT_MEDIA':
      return { ok: false, reason: 'not_media' };
    case 'HTTP_404':
      return { ok: false, reason: 'not_found' };
    case 'HTTP_403':
    case 'HTTP_ERROR':
      return { ok: false, reason: 'http' };
    case 'NETWORK':
      return { ok: false, reason: 'network' };
    default:
      return guess ? { ok: true, url, contentType: guess } : { ok: false, reason: 'unsupported' };
  }
}
