import type { HlsPlaylistType, MediaQualityVariant } from '../types';
import { buildMediaId } from '../utils/media-id';
import { isSafeMediaUrl, normalizeMediaUrl } from '../utils/url';
import { videoFormatFromMime } from '../resource/video-resource';

export type HlsVariantInfo = {
  uri: string;
  bandwidth: number | null;
  width: number | null;
  height: number | null;
  codecs: string | null;
  frameRate: number | null;
  audioGroup: string | null;
};

export type HlsParseResult = {
  playlistType: HlsPlaylistType;
  isMaster: boolean;
  isMedia: boolean;
  isEncrypted: boolean;
  isLive: boolean;
  variants: HlsVariantInfo[];
  /** Media playlist segment URIs — never surfaced as standalone detections. */
  segmentUris: string[];
};

/**
 * Lightweight HLS parser for master / media playlists.
 * Does not download segments. Flags encryption when EXT-X-KEY present.
 */
export function parseHlsManifest(
  content: string,
  manifestUrl: string,
): HlsParseResult | null {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const trimmed = content.trim();
  if (!trimmed.startsWith('#EXTM3U')) {
    return null;
  }

  const lines = trimmed.split(/\r?\n/);
  const isMaster = lines.some((line) => line.startsWith('#EXT-X-STREAM-INF'));
  const hasTargetDuration = lines.some((line) =>
    line.startsWith('#EXT-X-TARGETDURATION'),
  );
  const hasEndList = lines.some((line) => line.startsWith('#EXT-X-ENDLIST'));
  const isEncrypted = lines.some(
    (line) =>
      (line.trim().startsWith('#EXT-X-KEY:') || line.trim().startsWith('#EXT-X-SESSION-KEY:')) &&
      /METHOD=(?!NONE\b)/i.test(line),
  );

  let playlistType: HlsPlaylistType = 'unknown';
  if (isMaster) {
    playlistType = 'master';
  } else if (hasTargetDuration) {
    playlistType = 'media';
  }

  // Reject empty / non-structural playlists (#EXTM3U alone is not enough).
  if (!isMaster && !hasTargetDuration) {
    const hasMediaHint = lines.some(
      (line) =>
        line.startsWith('#EXTINF') ||
        line.startsWith('#EXT-X-MEDIA') ||
        line.startsWith('#EXT-X-I-FRAME-STREAM-INF'),
    );
    if (!hasMediaHint) {
      return null;
    }
  }

  const variants: HlsVariantInfo[] = [];
  const segmentUris: string[] = [];

  if (isMaster) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line?.startsWith('#EXT-X-STREAM-INF')) {
        continue;
      }

      const attrs = parseAttributeList(line.slice('#EXT-X-STREAM-INF:'.length));
      const next = lines[i + 1]?.trim();
      if (!next || next.startsWith('#')) {
        continue;
      }

      const safeUri = resolvePlaylistUri(next, manifestUrl);
      if (!safeUri) {
        continue;
      }

      const resolution = attrs.RESOLUTION?.split('x');
      const width = resolution?.[0] ? Number(resolution[0]) : null;
      const height = resolution?.[1] ? Number(resolution[1]) : null;
      const frameRate = attrs['FRAME-RATE']
        ? Number(attrs['FRAME-RATE'])
        : null;

      variants.push({
        uri: safeUri,
        bandwidth: attrs.BANDWIDTH ? Number(attrs.BANDWIDTH) : null,
        width: Number.isFinite(width) ? width : null,
        height: Number.isFinite(height) ? height : null,
        codecs: attrs.CODECS?.replace(/^"|"$/g, '') ?? null,
        frameRate: Number.isFinite(frameRate) ? frameRate : null,
        audioGroup: attrs.AUDIO?.replace(/^"|"$/g, '') ?? null,
      });
    }
  } else if (hasTargetDuration) {
    for (const line of lines) {
      const trimmedLine = line?.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }
      const safeUri = resolvePlaylistUri(trimmedLine, manifestUrl);
      if (safeUri) {
        segmentUris.push(safeUri);
      }
    }
  }

  return {
    playlistType,
    isMaster,
    isMedia: !isMaster && hasTargetDuration,
    isEncrypted,
    isLive: hasTargetDuration && !hasEndList,
    variants,
    segmentUris,
  };
}

export function mapHlsVariantsToQualities(
  mediaId: string,
  variants: HlsVariantInfo[],
): MediaQualityVariant[] {
  return variants
    .filter((variant) => isSafeMediaUrl(variant.uri))
    .map((variant) => ({
      id: buildMediaId({
        url: variant.uri,
        bitrate: variant.bandwidth,
        width: variant.width,
        height: variant.height,
        streamProtocol: 'hls',
        playlistType: 'variant',
      }),
      mediaId,
      bandwidth: variant.bandwidth,
      width: variant.width,
      height: variant.height,
      resolution:
        variant.width && variant.height
          ? `${variant.width}x${variant.height}`
          : null,
      codecs: variant.codecs,
      frameRate: variant.frameRate,
      audioGroup: variant.audioGroup,
      mimeType: 'application/vnd.apple.mpegurl',
      representationId: null,
      hasAudio: true,
      hasVideo: true,
      url: variant.uri,
      playlistType: 'variant' as const,
    }));
}

export function isHlsManifestUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.m3u8') || path.includes('.m3u8')) {
      return true;
    }
    return /(?:^|\/)(?:hls|playlist)(?:[/._-]|$)/i.test(path);
  } catch {
    return false;
  }
}

export function isHlsMimeType(mime: string | null | undefined): boolean {
  return videoFormatFromMime(mime) === 'hls';
}

/**
 * Architecture stub — CMAF is prepared but not implemented.
 */
export function isCmafHint(_url: string): boolean {
  return false;
}

function resolvePlaylistUri(relative: string, baseUrl: string): string | null {
  let absoluteUri = relative;
  try {
    absoluteUri = new URL(relative, baseUrl).toString();
  } catch {
    return null;
  }
  if (!isSafeMediaUrl(absoluteUri)) {
    return null;
  }
  return normalizeMediaUrl(absoluteUri);
}

function parseAttributeList(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/gi;
  let match: RegExpExecArray | null = regex.exec(raw);
  while (match) {
    const key = match[1]?.toUpperCase();
    const value = match[3] ?? match[2];
    if (key && value != null) {
      result[key] = value;
    }
    match = regex.exec(raw);
  }
  return result;
}
