/**
 * A DASH manifest a page embeds as text (Instagram's `video_dash_manifest`, Facebook's `dash_manifest_xml_string`).
 * The engine never downloads from manifest text, so only what it names is used: its single-file representations'
 * URLs (a separate video file and audio file are a split pair the engine proves and merges), and its protection and
 * live flags. Read by pattern — bounded, no XML parser, nothing fetched.
 */

import { decodeHtmlEntities } from './html-scan';
import { resolvePageUrl } from './media-url';

export type InlineDashRepresentation = {
  url: string;
  role: 'video' | 'audio' | 'muxed';
  width: number | null;
  height: number | null;
  bandwidth: number | null;
  label: string | null;
};

export type InlineDash = {
  protected: boolean;
  live: boolean;
  durationMs: number | null;
  representations: InlineDashRepresentation[];
};

const MAX_MANIFEST_LENGTH = 1024 * 1024;

export function looksLikeInlineDash(text: string): boolean {
  return text.length < MAX_MANIFEST_LENGTH && /<MPD[\s>]/.test(text) && /urn:mpeg:dash:schema:mpd/i.test(text);
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag) ?? new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return match ? decodeHtmlEntities(match[1]!) : null;
}

function positiveInt(value: string | null): number | null {
  const n = value == null ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `PT1H2M3.5S` → ms. */
export function isoDurationMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, d, h, m, s] = match;
  const total = (Number(d ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000;
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

function roleOf(mimeType: string | null, contentType: string | null, codecs: string | null): InlineDashRepresentation['role'] | null {
  const mime = (mimeType ?? '').toLowerCase();
  const content = (contentType ?? '').toLowerCase();
  const codec = (codecs ?? '').toLowerCase();
  const hasAudioCodec = /mp4a|opus|vorbis|ac-3|ec-3|flac/.test(codec);
  const hasVideoCodec = /avc|hvc|hev|vp0?8|vp0?9|av01|mp4v/.test(codec);
  if (mime.startsWith('video/') || content === 'video') {
    return hasAudioCodec ? 'muxed' : 'video';
  }
  if (mime.startsWith('audio/') || content === 'audio') {
    return 'audio';
  }
  if (hasVideoCodec) {
    return hasAudioCodec ? 'muxed' : 'video';
  }
  if (hasAudioCodec) {
    return 'audio';
  }
  return null;
}

export function parseInlineDash(text: string, baseUrl: string): InlineDash | null {
  if (!looksLikeInlineDash(text)) {
    return null;
  }
  const mpdTag = /<MPD\b[^>]*>/i.exec(text)?.[0] ?? '';
  const live = (attr(mpdTag, 'type') ?? 'static').toLowerCase() === 'dynamic';
  const durationMs = isoDurationMs(attr(mpdTag, 'mediaPresentationDuration'));
  const isProtected = /<(?:\w+:)?ContentProtection\b/i.test(text);
  const periods = text.match(/<Period\b/gi)?.length ?? 0;

  const representations: InlineDashRepresentation[] = [];
  if (periods <= 1) {
    const sets = text.split(/<AdaptationSet\b/i).slice(1);
    for (const set of sets) {
      const setTag = `<AdaptationSet${set.slice(0, set.indexOf('>') + 1)}`;
      const setMime = attr(setTag, 'mimeType');
      const setContent = attr(setTag, 'contentType');
      const setCodecs = attr(setTag, 'codecs');
      const body = set.split(/<\/AdaptationSet>/i)[0] ?? set;
      for (const rep of body.split(/<Representation\b/i).slice(1)) {
        const repTag = `<Representation${rep.slice(0, rep.indexOf('>') + 1)}`;
        const baseMatch = /<BaseURL[^>]*>([^<]+)<\/BaseURL>/i.exec(rep);
        if (!baseMatch) {
          continue;
        }
        // A segmented representation is not one file the page names; the engine plans those from an MPD URL.
        if (/<(?:SegmentTemplate|SegmentList)\b/i.test(rep)) {
          continue;
        }
        const url = resolvePageUrl(decodeHtmlEntities(baseMatch[1]!.trim()), baseUrl);
        const role = roleOf(attr(repTag, 'mimeType') ?? setMime, attr(repTag, 'contentType') ?? setContent, attr(repTag, 'codecs') ?? setCodecs);
        if (!url || !role) {
          continue;
        }
        representations.push({
          url,
          role,
          width: positiveInt(attr(repTag, 'width')),
          height: positiveInt(attr(repTag, 'height')),
          bandwidth: positiveInt(attr(repTag, 'bandwidth')),
          label: attr(repTag, 'FBQualityLabel') ?? attr(repTag, 'label'),
        });
      }
    }
  }
  return { protected: isProtected, live, durationMs, representations };
}

/**
 * The downloadable reading of an inline manifest: its best muxed file, else its best video file with its best
 * audio file (a split pair), else a video file when the manifest has no audio at all. Null when it names nothing
 * usable (several periods, segmented only, audio only).
 */
export function bestInlineDashSource(
  dash: InlineDash,
): { url: string; audioUrl: string | null; width: number | null; height: number | null; label: string | null } | null {
  const byQuality = (a: InlineDashRepresentation, b: InlineDashRepresentation) =>
    (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0);
  const muxed = dash.representations.filter((r) => r.role === 'muxed').sort(byQuality)[0];
  if (muxed) {
    return { url: muxed.url, audioUrl: null, width: muxed.width, height: muxed.height, label: muxed.label };
  }
  const video = dash.representations.filter((r) => r.role === 'video').sort(byQuality)[0];
  if (!video) {
    return null;
  }
  const audio = dash.representations
    .filter((r) => r.role === 'audio')
    .sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
  return { url: video.url, audioUrl: audio?.url ?? null, width: video.width, height: video.height, label: video.label };
}
