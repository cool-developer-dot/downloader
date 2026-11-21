/**
 * #368 Playlist Download / #369 Select from Playlist: the files a playlist file lists — M3U (a list of files, not an
 * HLS stream), PLS and XSPF. An HLS playlist (`#EXT-X-…` tags) is a stream, downloaded as one video, so it is reported
 * as such and never split into its segments. Pure.
 */

export type PlaylistEntry = { url: string; title: string | null };

export type PlaylistParse =
  | { kind: 'playlist'; format: 'm3u' | 'pls' | 'xspf' | 'feed'; entries: PlaylistEntry[] }
  | { kind: 'hls' }
  | { kind: 'none' };

export const MAX_PLAYLIST_ENTRIES = 500;

function absolute(raw: string, base: string): string | null {
  const value = raw.trim();
  // A playlist line is one link: markup, quotes or words separated by spaces are not.
  if (!value || /[\s<>"']/.test(value)) return null;
  try {
    const url = new URL(value, base);
    return /^(?:https?|ftp):$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function entities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/gi, (match, hex: string | undefined, dec: string | undefined) => {
      const code = hex ? parseInt(hex, 16) : Number(dec);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : match;
    })
    .replace(/&amp;/g, '&');
}

/** XML entities, then once more the ones titles often carry double-encoded (`&amp;#039;` → `'`). */
function decodeXml(text: string): string {
  return entities(entities(text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))).trim();
}

function unique(entries: PlaylistEntry[]): PlaylistEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => (seen.has(entry.url) ? false : (seen.add(entry.url), true))).slice(0, MAX_PLAYLIST_ENTRIES);
}

export function parsePlaylist(text: string, baseUrl: string): PlaylistParse {
  const body = text.replace(/^﻿/, '');
  const trimmed = body.trimStart();
  if (/#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|MEDIA|KEY|MAP|ENDLIST|PLAYLIST-TYPE)/i.test(body)) {
    return { kind: 'hls' };
  }
  // #363: an RSS 2.0 / Media RSS / Atom feed — its video enclosures (audio-only podcast items are left out).
  if (/<rss\b|<rdf:RDF\b/i.test(body.slice(0, 4096)) || (/<feed\b/i.test(body.slice(0, 4096)) && /www\.w3\.org\/2005\/Atom/i.test(body))) {
    return feedEntries(body, baseUrl);
  }
  if (/^<\?xml|^<playlist/i.test(trimmed) && /<trackList/i.test(body)) {
    const entries: PlaylistEntry[] = [];
    for (const track of body.match(/<track\b[\s\S]*?<\/track>/gi) ?? []) {
      const location = /<location>([\s\S]*?)<\/location>/i.exec(track)?.[1];
      const title = /<title>([\s\S]*?)<\/title>/i.exec(track)?.[1];
      const url = location ? absolute(decodeXml(location), baseUrl) : null;
      if (url) entries.push({ url, title: title ? decodeXml(title) || null : null });
    }
    return entries.length > 0 ? { kind: 'playlist', format: 'xspf', entries: unique(entries) } : { kind: 'none' };
  }
  if (/^\[playlist\]/i.test(trimmed)) {
    const files = new Map<string, string>();
    const titles = new Map<string, string>();
    for (const line of body.split(/\r?\n/)) {
      const match = /^(File|Title)(\d+)\s*=\s*(.+)$/i.exec(line.trim());
      if (!match) continue;
      (match[1]!.toLowerCase() === 'file' ? files : titles).set(match[2]!, match[3]!.trim());
    }
    const entries = [...files.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([n, raw]) => ({ url: absolute(raw, baseUrl), title: titles.get(n) ?? null }))
      .filter((entry): entry is PlaylistEntry => entry.url !== null);
    return entries.length > 0 ? { kind: 'playlist', format: 'pls', entries: unique(entries) } : { kind: 'none' };
  }
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const extended = lines[0]?.toUpperCase() === '#EXTM3U';
  const entries: PlaylistEntry[] = [];
  let title: string | null = null;
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#')) {
      const info = /^#EXTINF:[^,]*,(.*)$/i.exec(line);
      if (info) title = info[1]!.trim() || null;
      continue;
    }
    const url = absolute(line, baseUrl);
    if (url) entries.push({ url, title });
    title = null;
  }
  if (entries.length === 0) return { kind: 'none' };
  // A plain list of links is an M3U only when it looks like one: the header, or nothing but links.
  const onlyLinks = lines.every((line) => !line || line.startsWith('#') || absolute(line, baseUrl) !== null);
  return extended || onlyLinks ? { kind: 'playlist', format: 'm3u', entries: unique(entries) } : { kind: 'none' };
}

const VIDEO_FILE = /\.(?:mp4|m4v|mov|webm|mkv|flv|ts|m3u8|mpd|avi|wmv|3gp)(?:$|[?#])/i;

function attribute(element: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(element);
  return match?.[2] ? decodeXml(match[2]) || null : null;
}

function isVideoEnclosure(url: string, type: string | null): boolean {
  const t = type?.toLowerCase() ?? null;
  if (t?.startsWith('audio')) return false;
  if (t && (t.startsWith('video') || t.includes('mpegurl') || t.includes('dash+xml'))) return true;
  return VIDEO_FILE.test(url);
}

function feedEntries(body: string, baseUrl: string): PlaylistParse {
  const entries: PlaylistEntry[] = [];
  for (const item of body.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? []) {
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(item)?.[1];
    const candidates: { url: string; type: string | null }[] = [];
    for (const element of item.match(/<(?:enclosure|media:content)\b[^>]*>/gi) ?? []) {
      const url = attribute(element, 'url');
      const medium = attribute(element, 'medium');
      if (url) candidates.push({ url, type: attribute(element, 'type') ?? (medium === 'video' ? 'video/*' : medium) });
    }
    for (const element of item.match(/<link\b[^>]*rel=["']enclosure["'][^>]*>/gi) ?? []) {
      const url = attribute(element, 'href');
      if (url) candidates.push({ url, type: attribute(element, 'type') });
    }
    const link = /<link>([\s\S]*?)<\/link>/i.exec(item)?.[1];
    if (link && VIDEO_FILE.test(decodeXml(link))) candidates.push({ url: decodeXml(link), type: null });
    const video = candidates.find((c) => isVideoEnclosure(c.url, c.type));
    const url = video ? absolute(video.url, baseUrl) : null;
    if (url && /^https?:/i.test(url)) entries.push({ url, title: title ? decodeXml(title) || null : null });
  }
  return entries.length > 0 ? { kind: 'playlist', format: 'feed', entries: unique(entries) } : { kind: 'none' };
}

/** Whether a link names a playlist file by its extension (the bytes still decide). */
export function looksLikePlaylistUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    // `.xml` too: feeds are often `podcast.xml`; a file that is no playlist or feed just yields nothing.
    return /\.(?:m3u|m3u8|pls|xspf|rss|atom|xml)$/i.test(pathname) || /\/(?:feed|rss)\/?$/i.test(pathname);
  } catch {
    return false;
  }
}
