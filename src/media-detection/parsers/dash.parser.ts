import type { MediaQualityVariant } from '../types';
import { buildMediaId } from '../utils/media-id';
import { isSafeMediaUrl, normalizeMediaUrl } from '../utils/url';

export type DashRepresentation = {
  id: string | null;
  bandwidth: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  codecs: string | null;
  mimeType: string | null;
  contentType: 'video' | 'audio' | 'unknown';
  baseUrl: string | null;
};

export type DashParseResult = {
  isValid: boolean;
  representations: DashRepresentation[];
  videoRepresentations: DashRepresentation[];
  audioRepresentations: DashRepresentation[];
  hasSeparateAudio: boolean;
  isEncrypted: boolean;
};

/**
 * Lightweight MPEG-DASH MPD parser.
 * Validates MPD structure without a DOM dependency.
 * Does not download media segments.
 */
export function parseDashManifest(
  content: string,
  manifestUrl: string,
): DashParseResult | null {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const trimmed = content.trim();
  if (!/<MPD\b/i.test(trimmed)) {
    return null;
  }

  if (!/<[A-Za-z]/.test(trimmed)) {
    return null;
  }

  const isEncrypted =
    /ContentProtection/i.test(trimmed) ||
    /cenc:default_KID/i.test(trimmed) ||
    /schemeIdUri=["']urn:mpeg:dash:mp4protection/i.test(trimmed);

  const mpdBase = firstDirectBaseUrl(trimmed, manifestUrl) ?? manifestUrl;
  const adaptations = splitTopLevelBlocks(trimmed, 'AdaptationSet');
  const representations: DashRepresentation[] = [];

  if (adaptations.length === 0) {
    const topReps = splitTopLevelBlocks(trimmed, 'Representation');
    for (const block of topReps) {
      const rep = parseRepresentationBlock(block, mpdBase, 'unknown');
      if (rep) {
        representations.push(rep);
      }
    }
  } else {
    for (const adaptation of adaptations) {
      const contentType = resolveAdaptationContentType(adaptation);
      const adaptationBase =
        firstDirectBaseUrl(adaptation, mpdBase) ?? mpdBase;
      const reps = splitTopLevelBlocks(adaptation, 'Representation');
      for (const block of reps) {
        const rep = parseRepresentationBlock(
          block,
          adaptationBase,
          contentType,
        );
        if (rep) {
          representations.push(rep);
        }
      }
    }
  }

  if (representations.length === 0 && !isEncrypted) {
    return null;
  }

  for (const rep of representations) {
    if (
      rep.contentType === 'unknown' &&
      rep.width != null &&
      rep.height != null
    ) {
      rep.contentType = 'video';
    } else if (
      rep.contentType === 'unknown' &&
      rep.mimeType?.toLowerCase().startsWith('audio/')
    ) {
      rep.contentType = 'audio';
    }
  }

  const videoRepresentations = representations.filter(
    (r) => r.contentType === 'video',
  );
  const audioRepresentations = representations.filter(
    (r) => r.contentType === 'audio',
  );
  const hasSeparateAudio =
    videoRepresentations.length > 0 && audioRepresentations.length > 0;

  return {
    isValid: true,
    representations,
    videoRepresentations,
    audioRepresentations,
    hasSeparateAudio,
    isEncrypted,
  };
}

export function mapDashRepresentationsToQualities(
  mediaId: string,
  parsed: DashParseResult,
): MediaQualityVariant[] {
  const source =
    parsed.videoRepresentations.length > 0
      ? parsed.videoRepresentations
      : parsed.representations.filter((r) => r.contentType !== 'audio');

  return source
    .filter((rep) => rep.baseUrl == null || isSafeMediaUrl(rep.baseUrl))
    .map((rep) => {
      const url = rep.baseUrl ?? '';
      return {
        id: buildMediaId({
          url: url || `${mediaId}_${rep.id ?? 'rep'}`,
          bitrate: rep.bandwidth,
          width: rep.width,
          height: rep.height,
          streamProtocol: 'dash',
          playlistType: 'variant',
        }),
        mediaId,
        bandwidth: rep.bandwidth,
        width: rep.width,
        height: rep.height,
        resolution:
          rep.width && rep.height ? `${rep.width}x${rep.height}` : null,
        codecs: rep.codecs,
        frameRate: rep.frameRate,
        audioGroup: null,
        mimeType: rep.mimeType,
        representationId: rep.id,
        hasAudio: !(parsed.hasSeparateAudio && rep.contentType === 'video'),
        hasVideo:
          rep.contentType === 'video' ||
          (rep.width != null && rep.height != null),
        url,
        playlistType: 'variant' as const,
      };
    })
    .filter((q) => q.url.length > 0 || q.representationId != null);
}

export function isDashManifestUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.mpd') || path.includes('.mpd')) {
      return true;
    }
    return /(?:^|\/)(?:dash|mpd)(?:[/._-]|$)/i.test(path);
  } catch {
    return false;
  }
}

export function isDashMimeType(mime: string | null | undefined): boolean {
  if (!mime) {
    return false;
  }
  const base = mime.split(';')[0]?.trim().toLowerCase();
  return base === 'application/dash+xml';
}

function parseRepresentationBlock(
  block: string,
  baseUrl: string,
  inheritedType: DashRepresentation['contentType'],
): DashRepresentation | null {
  const openTag = block.match(/^<Representation\b([^>]*)>/i)?.[1] ?? '';
  const id = readAttr(openTag, 'id');
  const bandwidth = readNumberAttr(openTag, 'bandwidth');
  const width = readNumberAttr(openTag, 'width');
  const height = readNumberAttr(openTag, 'height');
  const frameRate = parseFrameRate(readAttr(openTag, 'frameRate'));
  const codecs = readAttr(openTag, 'codecs');
  const mimeType = readAttr(openTag, 'mimeType');
  const contentType =
    inheritedType !== 'unknown' ? inheritedType : mimeToContentType(mimeType);

  const localBase = firstDirectBaseUrl(block, baseUrl);

  return {
    id,
    bandwidth,
    width,
    height,
    frameRate,
    codecs,
    mimeType,
    contentType,
    baseUrl: localBase,
  };
}

function resolveAdaptationContentType(
  block: string,
): DashRepresentation['contentType'] {
  const openTag = block.match(/^<AdaptationSet\b([^>]*)>/i)?.[1] ?? '';
  const contentType = readAttr(openTag, 'contentType')?.toLowerCase();
  if (contentType === 'video' || contentType === 'audio') {
    return contentType;
  }
  const mime = readAttr(openTag, 'mimeType');
  return mimeToContentType(mime);
}

function mimeToContentType(
  mime: string | null,
): DashRepresentation['contentType'] {
  if (!mime) {
    return 'unknown';
  }
  const base = mime.toLowerCase();
  if (base.startsWith('video/')) {
    return 'video';
  }
  if (base.startsWith('audio/')) {
    return 'audio';
  }
  return 'unknown';
}

/** Only direct-child BaseURL elements (not nested Representation BaseURLs). */
function firstDirectBaseUrl(xml: string, parentBase: string): string | null {
  // Remove nested Representation / AdaptationSet / Period blocks before scanning.
  const flattened = xml
    .replace(/<Representation\b[\s\S]*?<\/Representation>/gi, '')
    .replace(/<AdaptationSet\b[\s\S]*?<\/AdaptationSet>/gi, '')
    .replace(/<Period\b[\s\S]*?<\/Period>/gi, '');

  const match = /<BaseURL[^>]*>([^<]+)<\/BaseURL>/i.exec(flattened);
  // Also allow BaseURL as first child inside the element itself when no nested strip needed
  const fallback = /<BaseURL[^>]*>([^<]+)<\/BaseURL>/i.exec(xml);
  const raw = (match?.[1] ?? fallback?.[1])?.trim();
  if (!raw) {
    return null;
  }
  try {
    const absolute = new URL(raw, parentBase).toString();
    if (!isSafeMediaUrl(absolute)) {
      return null;
    }
    return normalizeMediaUrl(absolute);
  } catch {
    return null;
  }
}

/**
 * Split top-level (non-nested) blocks for a given tag within `xml`.
 */
function splitTopLevelBlocks(xml: string, tagName: string): string[] {
  const blocks: string[] = [];
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  let match: RegExpExecArray | null = openRe.exec(xml);

  while (match) {
    const start = match.index;
    const openFull = match[0];
    if (openFull.endsWith('/>')) {
      blocks.push(openFull);
      match = openRe.exec(xml);
      continue;
    }

    let depth = 1;
    let cursor = start + openFull.length;
    const openToken = new RegExp(`<${tagName}\\b`, 'gi');
    const closeToken = new RegExp(`</${tagName}\\s*>`, 'gi');

    while (cursor < xml.length && depth > 0) {
      openToken.lastIndex = cursor;
      closeToken.lastIndex = cursor;
      const nextOpen = openToken.exec(xml);
      const nextClose = closeToken.exec(xml);
      if (!nextClose) {
        break;
      }
      if (nextOpen && nextOpen.index < nextClose.index) {
        depth += 1;
        cursor = nextOpen.index + 1;
      } else {
        depth -= 1;
        if (depth === 0) {
          blocks.push(xml.slice(start, nextClose.index + nextClose[0].length));
          // Continue search after this block
          openRe.lastIndex = nextClose.index + nextClose[0].length;
          break;
        }
        cursor = nextClose.index + nextClose[0].length;
      }
    }

    match = openRe.exec(xml);
  }

  return blocks;
}

function readAttr(block: string, name: string): string | null {
  const re = new RegExp(`(?:^|[\\s])${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const match = re.exec(block);
  const value = match?.[1]?.trim();
  return value || null;
}

function readNumberAttr(block: string, name: string): number | null {
  const raw = readAttr(block, name);
  if (!raw) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseFrameRate(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  if (raw.includes('/')) {
    const [a, b] = raw.split('/');
    const num = Number(a);
    const den = Number(b);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
