/**
 * Evidence-based playback URL signals.
 * Path/query shape only — not a hostname allowlist or site extractor.
 */

const PLAYBACK_PATH_RE =
  /(?:^|\/)(?:videoplayback|dashplaylist)(?:[/._-]|$)/i;

/** Facebook / Instagram CDN object paths (`/v/t51…`, `/v/t50…`). */
const VIDEO_OBJECT_PATH_RE = /(?:^|\/)v\/t\d{2,}(?:[/._-]|$)/i;

const MEDIA_MIME_QUERY_RE =
  /[?&](?:mime|content[_-]?type)=(video|audio|application(?:%2F|\/)(?:vnd\.apple\.mpegurl|x-mpegurl|dash\+xml))/i;

const MEDIA_FORMAT_QUERY_RE =
  /[?&](?:ext|format|container|file)=(mp4|webm|m3u8|mpd|mov|m4v|mkv|mp3|m4a|aac)(?:&|$)/i;

const PLAYBACK_ITAG_QUERY_RE = /[?&]itag=\d+/i;
const PLAYBACK_ITAG_SIZE_RE = /[?&](?:clen|dur|bitrate)=/i;

const BYTE_RANGE_QUERY_KEYS = new Set([
  'range',
  'rn',
  'rbuf',
  'alr',
  'ump',
  'keepalive',
  'bytestart',
  'byteend',
]);

/** A whole media file by its extension (segments excluded: they are never candidates on their own). */
const MEDIA_FILE_PATH_RE = /\.(?:mp4|m4v|m4a|mov|webm|mkv|mp3|aac|ogg|opus)$/i;

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function urlHasPlaybackPathEvidence(url: string): boolean {
  const parsed = safeUrl(url);
  const path = parsed?.pathname ?? url;
  return PLAYBACK_PATH_RE.test(path) || VIDEO_OBJECT_PATH_RE.test(path);
}

export function urlHasMediaQueryEvidence(url: string): boolean {
  if (MEDIA_MIME_QUERY_RE.test(url) || MEDIA_FORMAT_QUERY_RE.test(url)) {
    return true;
  }
  return PLAYBACK_ITAG_QUERY_RE.test(url) && PLAYBACK_ITAG_SIZE_RE.test(url);
}

export function urlHasPlaybackMediaEvidence(url: string): boolean {
  return urlHasPlaybackPathEvidence(url) || urlHasMediaQueryEvidence(url);
}

/**
 * Drop byte-range fragment params (`bytestart`/`byteend`, `range`…) from media URLs so ingest/download target the
 * whole object, not the slice one request read. Applies to playback paths, CDN video-object paths and media files by
 * extension; signatures and expiry query stay intact.
 */
export function canonicalizeObservedMediaUrl(url: string): string {
  const parsed = safeUrl(url.trim());
  if (!parsed) {
    return url;
  }
  const path = parsed.pathname;
  if (!PLAYBACK_PATH_RE.test(path) && !VIDEO_OBJECT_PATH_RE.test(path) && !MEDIA_FILE_PATH_RE.test(path)) {
    return url;
  }
  let changed = false;
  for (const key of [...parsed.searchParams.keys()]) {
    if (BYTE_RANGE_QUERY_KEYS.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
      changed = true;
    }
  }
  return changed ? parsed.toString() : url;
}
