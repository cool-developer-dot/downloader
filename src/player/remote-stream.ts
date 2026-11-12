/**
 * Online streams (F17): a detected offer played in the VidoraX player without downloading it. The player knows a stream
 * only by an opaque media id `stream:<token>` (never its URL — URLs never cross navigation); the source lives here, in
 * memory, for this app run. A stream has no library row, no resume record and no Watch history entry.
 * Pure — no native imports.
 */

import { parseHlsPlaylist } from '@/downloads/engine/hls/playlist';
import type { MediaRequestContext } from '@/downloads/types/request-context';

/** What expo-video is told the source is (`VideoSource.contentType`). */
export type StreamContentType = 'progressive' | 'hls' | 'dash';

export type RemoteStream = {
  uri: string;
  /** Sent with every request the player makes (playlists, segments, ranges): Referer, User-Agent, Origin, Cookie. */
  headers: Record<string, string>;
  contentType: StreamContentType;
  title: string;
  /** The offer's thumbnail (http/https), shown by the media notification when background play is on. */
  thumbnailUrl: string | null;
};

/** The part of a quality option a stream needs (structurally a `DownloadQualityOption`). */
export type StreamableOption = {
  sourceUrl: string;
  downloadable: boolean;
  streamType: string;
  isHls: boolean;
  container: string;
  audioSourceUrl?: string | null;
  /** F6: a live stream offered for recording. */
  isLive?: boolean;
};

const ID_PREFIX = 'stream:';
/** An online stream may wait on the network for its first frame longer than a local file (12 s) does. */
export const STREAM_PREPARATION_TIMEOUT_MS = 30_000;
const TOKEN = /^[0-9a-f]{32}$/;

/**
 * Headers a page's media requests carry that a stream needs again. Anything else the detector saw (Range, Accept…) is
 * the player's own business.
 */
const FORWARDED_HEADERS = ['User-Agent', 'Referer', 'Origin', 'Cookie'] as const;

export function streamContentType(option: Pick<StreamableOption, 'streamType' | 'isHls' | 'container'>): StreamContentType {
  if (option.isHls || option.streamType === 'HLS' || option.container === 'hls') {
    return 'hls';
  }
  if (option.streamType === 'DASH' || option.container === 'dash') {
    return 'dash';
  }
  return 'progressive';
}

function isHttpUrl(value: string | null | undefined): boolean {
  const trimmed = value?.trim().toLowerCase() ?? '';
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

/** Why an offer has no Play button. */
export type StreamUnavailableReason = 'split' | 'not_downloadable' | 'no_url' | 'live';

/** Why an offer has no Play button, or null when it can be played. */
export function streamUnavailableReason(option: StreamableOption | null | undefined): StreamUnavailableReason | null {
  if (!option) {
    return 'not_downloadable';
  }
  // F6: a live stream is offered for recording only; playing it online is not part of the offer.
  if (option.isLive) {
    return 'live';
  }
  // A video file with a separate audio file is two downloads merged on the device — nothing a single source can play.
  if (option.audioSourceUrl) {
    return 'split';
  }
  // Protected, encrypted, live or otherwise refused offers are never offered for download — and never played either.
  if (!option.downloadable) {
    return 'not_downloadable';
  }
  if (!isHttpUrl(option.sourceUrl)) {
    return 'no_url';
  }
  return null;
}

export function isPlayableOffer(option: StreamableOption | null | undefined): boolean {
  return streamUnavailableReason(option) == null;
}

/**
 * Whether Play opens exactly this quality. An HLS option is its own variant playlist and a file is itself; a DASH option
 * is the whole manifest (the engine picks the representation when downloading), and expo-video cannot pin one — the
 * player then adapts to the network. Such an offer gets one Play, not one per quality.
 */
export function playsChosenQuality(option: StreamableOption | null | undefined): boolean {
  return isPlayableOffer(option) && streamContentType(option as StreamableOption) !== 'dash';
}

/**
 * Whether the stream's requests carry the browsing session's cookies — the download engine's own rule
 * (`toV2RequestContext` → `useCookies`), so playing sends exactly what downloading would.
 */
export function streamUsesCookies(context: MediaRequestContext | null | undefined): boolean {
  return Boolean(context?.cookiesRequired || context?.hasCookies);
}

/**
 * The page's headers a stream request needs (header names matched case-insensitively). Like the download engine, the
 * Referer falls back to the page itself.
 */
export function streamHeaders(
  context: MediaRequestContext | null | undefined,
  pageUrl?: string | null,
): Record<string, string> {
  const result: Record<string, string> = {};
  const source = context?.headers ?? {};
  for (const name of FORWARDED_HEADERS) {
    const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    const value = key ? source[key]?.trim() : '';
    if (value) {
      result[name] = value;
    }
  }
  if (!result['User-Agent'] && context?.userAgent?.trim()) {
    result['User-Agent'] = context.userAgent.trim();
  }
  if (!result.Referer && context?.referer?.trim()) {
    result.Referer = context.referer.trim();
  }
  if (!result.Referer && isHttpUrl(pageUrl)) {
    result.Referer = (pageUrl as string).trim();
  }
  return result;
}

const MEDIA_FILE = /\.(mp4|m4v|mov|webm|mkv|3gp|ts|m3u8|mpd|mp3|m4a|aac|ogg|opus|wav|flac|mpg|mpeg|vob|avi|wmv|flv)$/i;

function fileNameOf(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)).trim();
    return last || null;
  } catch {
    return null;
  }
}

function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname || null : null;
  } catch {
    return null;
  }
}

/**
 * The player's title. A page's offer is titled by the offer; a media file or manifest opened directly in the tab is
 * titled by its file name — the tab's title there can still be the previous page's (Prompt A / F1 "Found, not fixed").
 */
export function streamTitle(input: { offerTitle: string | null | undefined; pageUrl: string | null | undefined; mediaUrl: string }): string {
  const page = input.pageUrl?.trim() ?? '';
  const pageIsTheMedia = page !== '' && (page === input.mediaUrl.trim() || MEDIA_FILE.test(safePath(page)));
  if (pageIsTheMedia) {
    const name = fileNameOf(page) ?? fileNameOf(input.mediaUrl);
    if (name) {
      return name;
    }
  }
  const offer = input.offerTitle?.trim();
  if (offer) {
    return offer;
  }
  return fileNameOf(input.mediaUrl) ?? hostOf(page) ?? hostOf(input.mediaUrl) ?? 'Video';
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export type BuildRemoteStreamInput = {
  option: StreamableOption;
  /** Fresh source URL (a refreshed signature or resolved redirect); the option's own URL when absent. */
  sourceUrl?: string | null;
  requestContext: MediaRequestContext | null | undefined;
  offerTitle: string | null | undefined;
  pageUrl: string | null | undefined;
  thumbnailUrl: string | null | undefined;
  /**
   * The WebView's cookies for the stream's URL (read only when `streamUsesCookies`); expo-video has no cookie jar of
   * its own, so they travel as a Cookie header on every request of this stream.
   */
  cookieHeader?: string | null;
};

export function buildRemoteStream(
  input: BuildRemoteStreamInput,
): { ok: true; stream: RemoteStream } | { ok: false; reason: StreamUnavailableReason } {
  const reason = streamUnavailableReason(input.option);
  if (reason) {
    return { ok: false, reason };
  }
  const uri = (input.sourceUrl?.trim() || input.option.sourceUrl).trim();
  if (!isHttpUrl(uri)) {
    return { ok: false, reason: 'no_url' };
  }
  const thumbnail = input.thumbnailUrl?.trim();
  const headers = streamHeaders(input.requestContext, input.pageUrl);
  const cookie = input.cookieHeader?.trim();
  if (cookie) {
    headers.Cookie = cookie;
  }
  return {
    ok: true,
    stream: {
      uri,
      headers,
      contentType: streamContentType(input.option),
      title: streamTitle({ offerTitle: input.offerTitle, pageUrl: input.pageUrl, mediaUrl: uri }),
      thumbnailUrl: thumbnail && isHttpUrl(thumbnail) ? thumbnail : null,
    },
  };
}

// --- The chosen HLS quality ---------------------------------------------------------------------------------------

/**
 * An HLS offer can name the master playlist plus the chosen height (the engine picks that variant when it downloads).
 * Played as it is, the player would adapt to the network instead — so the variant is picked here the way the engine's
 * planner does: the exact height, else the tallest one below it; among equals, the bandwidth nearest the offer's.
 * Null keeps the URL as it is: not a master, nothing to match, or variants whose sound is a separate rendition (a
 * variant alone would be silent — the master then plays, adapting).
 */
export function chooseHlsVariant(
  playlistText: string,
  playlistUrl: string,
  chosen: { height: number | null | undefined; bitrate: number | null | undefined },
): { url: string } | { url: null; reason: 'not_master' | 'separate_audio' | 'no_match' } {
  let parsed;
  try {
    parsed = parseHlsPlaylist(playlistText, playlistUrl);
  } catch {
    return { url: null, reason: 'not_master' };
  }
  if (parsed.kind !== 'master' || parsed.variants.length === 0) {
    return { url: null, reason: 'not_master' };
  }
  if (/#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*URI=/i.test(playlistText)) {
    return { url: null, reason: 'separate_audio' };
  }
  const height = typeof chosen.height === 'number' && chosen.height > 0 ? chosen.height : null;
  if (height == null) {
    return { url: null, reason: 'no_match' };
  }
  const sized = parsed.variants.filter((v) => typeof v.height === 'number' && v.height > 0);
  const exact = sized.filter((v) => v.height === height);
  const below = sized.filter((v) => (v.height as number) < height);
  const tallestBelow = below.length > 0 ? Math.max(...below.map((v) => v.height as number)) : null;
  const pool = exact.length > 0 ? exact : below.filter((v) => v.height === tallestBelow);
  if (pool.length === 0) {
    return { url: null, reason: 'no_match' };
  }
  const target = typeof chosen.bitrate === 'number' && chosen.bitrate > 0 ? chosen.bitrate : null;
  const best = pool.reduce((a, b) => {
    if (target == null) {
      return (b.bandwidth ?? 0) > (a.bandwidth ?? 0) ? b : a;
    }
    return Math.abs((b.bandwidth ?? 0) - target) < Math.abs((a.bandwidth ?? 0) - target) ? b : a;
  });
  return { url: best.url };
}

// --- Ids and the in-memory registry -------------------------------------------------------------------------------

export function isStreamMediaId(mediaId: string | null | undefined): boolean {
  return typeof mediaId === 'string' && mediaId.startsWith(ID_PREFIX);
}

function newToken(random: () => number): string {
  let token = '';
  while (token.length < 32) {
    token += Math.floor(random() * 0x100000000)
      .toString(16)
      .padStart(8, '0');
  }
  return token.slice(0, 32);
}

const streams = new Map<string, RemoteStream>();
/** Streams opened this run, oldest first; only the latest few are kept (each holds a page's cookies). */
export const MAX_REMEMBERED_STREAMS = 8;

/** Keeps the stream for the player and returns its media id. */
export function rememberRemoteStream(stream: RemoteStream, random: () => number = Math.random): string {
  const id = `${ID_PREFIX}${newToken(random)}`;
  streams.set(id, stream);
  while (streams.size > MAX_REMEMBERED_STREAMS) {
    const oldest = streams.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    streams.delete(oldest);
  }
  return id;
}

export function knownRemoteStream(mediaId: string | null | undefined): RemoteStream | null {
  if (!isStreamMediaId(mediaId) || !TOKEN.test((mediaId as string).slice(ID_PREFIX.length))) {
    return null;
  }
  return streams.get(mediaId as string) ?? null;
}

export function forgetRemoteStreamsForTests(): void {
  streams.clear();
}

// --- Errors --------------------------------------------------------------------------------------------------------

/**
 * What a stream's player error means, from expo-video's message ("A playback exception has occurred: Source error
 * Response code: 403"). An HTTP refusal of the media is a link that has expired or needs the page again; a failed
 * connection is the network. Null: not stream-specific — the generic classification decides.
 */
export function classifyStreamError(error: unknown): 'STREAM_LINK_EXPIRED' | 'STREAM_NETWORK_ERROR' | null {
  const text =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
        ? ((error as { message: string }).message)
        : '';
  if (!text) {
    return null;
  }
  if (/response code:?\s*(401|403|404|410)\b/i.test(text)) {
    return 'STREAM_LINK_EXPIRED';
  }
  // Only a failed transfer: "Source error" alone also covers formats nothing can read (a ParserException's message
  // never names java.io.IOException; an HttpDataSourceException wrapping a socket failure does).
  if (
    /unable to connect|unknownhost|unable to resolve host|failed to connect|connection (reset|refused|abort|closed)|network is unreachable|timed? ?out|timeout|ssl ?handshake|unexpected end of stream|broken pipe|java\.io\.(IOException|EOFException)|java\.net\.\w+Exception/i.test(
      text,
    )
  ) {
    return 'STREAM_NETWORK_ERROR';
  }
  return null;
}
