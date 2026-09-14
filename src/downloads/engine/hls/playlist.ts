/**
 * HLS playlist parsing for the download engine.
 * Master variants + VOD media segments. Rejects encryption / live / byterange.
 * Does not invent missing metadata or fabricate quality ladders.
 */

import { isSafeHttpUrl } from '../resource-guard';
import { DownloadEngineError } from '../errors';
import { HLS_TRANSFER } from './constants';

const MAX_DIMENSION = 16_384;

export type HlsVariant = {
  url: string;
  bandwidth: number | null;
  averageBandwidth: number | null;
  resolution: string | null;
  width: number | null;
  height: number | null;
  codecs: string | null;
  frameRate: number | null;
  /** @deprecated Prefer `url`. */
  uri: string;
};

export type HlsSegment = {
  index: number;
  url: string;
  duration: number | null;
  isInitSegment: false;
  /** @deprecated Prefer `url`. */
  uri: string;
  /** @deprecated Prefer `duration`. */
  durationSeconds: number | null;
};

export type HlsMediaPlaylist = {
  kind: 'media';
  playlistUrl: string;
  segments: HlsSegment[];
  /** Present for fMP4; written once before media segments. */
  initSegmentUrl: string | null;
  /** 'ts' = MPEG-TS concat; 'fmp4' = init + media concat. */
  containerHint: 'ts' | 'fmp4';
};

export type HlsMasterPlaylist = {
  kind: 'master';
  playlistUrl: string;
  variants: HlsVariant[];
};

export type HlsResolvedPlaylist = HlsMediaPlaylist | HlsMasterPlaylist;

export function parseAttributeList(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) {
    return result;
  }
  const regex = /([A-Z0-9-]+)=("([^"]*)"|[^,]*)/gi;
  let match: RegExpExecArray | null = regex.exec(raw);
  while (match) {
    const key = match[1]?.toUpperCase();
    const value = match[3] ?? match[2];
    if (key && value != null) {
      result[key] = value.trim();
    }
    match = regex.exec(raw);
  }
  return result;
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (raw == null || raw === '') {
    return null;
  }
  if (!/^\d+$/.test(raw.trim())) {
    return null;
  }
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return value;
}

function parsePositiveDimension(raw: string | undefined): number | null {
  const value = parsePositiveInt(raw);
  if (value == null || value > MAX_DIMENSION) {
    return null;
  }
  return value;
}

function parseResolution(
  raw: string | undefined,
): { width: number | null; height: number | null; label: string | null } {
  if (!raw) {
    return { width: null, height: null, label: null };
  }
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(raw.trim());
  if (!match) {
    return { width: null, height: null, label: null };
  }
  const width = parsePositiveDimension(match[1]);
  const height = parsePositiveDimension(match[2]);
  if (width == null || height == null) {
    return { width, height, label: null };
  }
  return { width, height, label: `${width}x${height}` };
}

function parseFrameRate(raw: string | undefined): number | null {
  if (raw == null || raw === '') {
    return null;
  }
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0 || value > 240) {
    return null;
  }
  return value;
}

function parseDuration(raw: string | undefined): number | null {
  if (raw == null || raw === '') {
    return null;
  }
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function resolveSafeHlsUrl(raw: string, baseUrl: string): string {
  let absolute: string;
  try {
    absolute = new URL(raw.trim(), baseUrl).toString();
  } catch {
    throw new DownloadEngineError(
      'INVALID_HLS_PLAYLIST',
      'Invalid HLS URI.',
    );
  }
  if (!isSafeHttpUrl(absolute)) {
    throw new DownloadEngineError(
      'INVALID_RESOURCE',
      'HLS URI failed security checks.',
    );
  }
  return absolute;
}

function nextUriLine(lines: string[], startIndex: number): { uri: string; index: number } | null {
  for (let j = startIndex; j < lines.length; j += 1) {
    const candidate = lines[j]?.trim();
    if (!candidate) {
      continue;
    }
    if (candidate.startsWith('#')) {
      return null;
    }
    return { uri: candidate, index: j };
  }
  return null;
}

type KeyInspection = 'none' | 'encryption' | 'drm';

function inspectKeyTag(line: string): KeyInspection {
  const trimmed = line.trim();
  if (
    !trimmed.startsWith('#EXT-X-KEY:') &&
    !trimmed.startsWith('#EXT-X-SESSION-KEY:')
  ) {
    return 'none';
  }
  const attrs = parseAttributeList(trimmed.slice(trimmed.indexOf(':') + 1));
  const method = (attrs.METHOD ?? '').toUpperCase();
  if (!method || method === 'NONE') {
    return 'none';
  }

  const keyFormat = (attrs.KEYFORMAT ?? '').toLowerCase();
  if (
    keyFormat.includes('com.apple.streamingkeydelivery') ||
    keyFormat.includes('urn:uuid') ||
    keyFormat.includes('widevine') ||
    keyFormat.includes('playready') ||
    keyFormat.includes('clearkey') ||
    keyFormat.includes('com.microsoft.playready')
  ) {
    return 'drm';
  }

  if (
    method === 'SAMPLE-AES' ||
    method === 'SAMPLE-AES-CTR' ||
    method === 'AES-128'
  ) {
    return 'encryption';
  }

  return 'drm';
}

function rejectUnsupportedConstructs(lines: string[]): void {
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('#')) {
      continue;
    }

    const keyKind = inspectKeyTag(line);
    if (keyKind === 'drm') {
      throw new DownloadEngineError(
        'UNSUPPORTED_DRM',
        'DRM-protected streams can’t be saved.',
      );
    }
    if (keyKind === 'encryption') {
      throw new DownloadEngineError(
        'UNSUPPORTED_HLS_ENCRYPTION',
        'Encrypted HLS streams can’t be saved.',
      );
    }

    if (line.startsWith('#EXT-X-BYTERANGE')) {
      throw new DownloadEngineError(
        'UNSUPPORTED_HLS_BYTERANGE',
        'Byte-range HLS segments aren’t supported.',
      );
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-MAP:'.length));
      if (attrs.BYTERANGE) {
        throw new DownloadEngineError(
          'UNSUPPORTED_HLS_BYTERANGE',
          'Byte-range HLS init segments aren’t supported.',
        );
      }
    }

    if (line.startsWith('#EXT-X-GAP')) {
      throw new DownloadEngineError(
        'HLS_UNSUPPORTED',
        'HLS gap segments aren’t supported.',
      );
    }
  }
}

function sniffContainerHint(
  segments: HlsSegment[],
  initSegmentUrl: string | null,
): 'ts' | 'fmp4' {
  if (initSegmentUrl) {
    return 'fmp4';
  }
  const sample = segments[0]?.url ?? '';
  const path = (() => {
    try {
      return new URL(sample).pathname.toLowerCase();
    } catch {
      return sample.toLowerCase();
    }
  })();
  if (path.endsWith('.m4s') || path.endsWith('.mp4') || path.endsWith('.cmfv')) {
    return 'fmp4';
  }
  return 'ts';
}

function parseMasterPlaylist(
  lines: string[],
  playlistUrl: string,
): HlsMasterPlaylist {
  const variants: HlsVariant[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line?.startsWith('#EXT-X-STREAM-INF')) {
      continue;
    }
    const attrs = parseAttributeList(
      line.includes(':') ? line.slice(line.indexOf(':') + 1) : '',
    );
    const next = nextUriLine(lines, i + 1);
    if (!next) {
      continue;
    }
    i = next.index;

    let url: string;
    try {
      url = resolveSafeHlsUrl(next.uri, playlistUrl);
    } catch (error) {
      if (
        error instanceof DownloadEngineError &&
        error.code === 'INVALID_RESOURCE'
      ) {
        continue;
      }
      throw error;
    }

    if (seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);

    const { width, height, label } = parseResolution(attrs.RESOLUTION);
    const bandwidth = parsePositiveInt(attrs.BANDWIDTH);
    const averageBandwidth = parsePositiveInt(attrs['AVERAGE-BANDWIDTH']);
    const frameRate = parseFrameRate(attrs['FRAME-RATE']);
    const codecs = attrs.CODECS?.replace(/^"|"$/g, '').trim() || null;

    variants.push({
      url,
      uri: url,
      bandwidth,
      averageBandwidth,
      resolution: label,
      width,
      height,
      codecs,
      frameRate,
    });
  }

  if (variants.length === 0) {
    throw new DownloadEngineError(
      'INVALID_HLS_PLAYLIST',
      'HLS master playlist has no usable variants.',
    );
  }

  return { kind: 'master', playlistUrl, variants };
}

function parseMediaPlaylist(
  lines: string[],
  playlistUrl: string,
  hasEndList: boolean,
): HlsMediaPlaylist {
  if (!hasEndList) {
    throw new DownloadEngineError(
      'LIVE_HLS_UNSUPPORTED',
      'Live HLS streams can’t be saved as a single file.',
    );
  }

  let initSegmentUrl: string | null = null;
  const segments: HlsSegment[] = [];
  const seenIndexes = new Set<number>();
  let pendingDuration: number | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (!line) {
      continue;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-MAP:'.length));
      if (!attrs.URI) {
        throw new DownloadEngineError(
          'INVALID_HLS_PLAYLIST',
          'HLS init segment is missing a URI.',
        );
      }
      initSegmentUrl = resolveSafeHlsUrl(
        attrs.URI.replace(/^"|"$/g, ''),
        playlistUrl,
      );
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const raw = line.slice('#EXTINF:'.length).split(',')[0];
      pendingDuration = parseDuration(raw);
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    const url = resolveSafeHlsUrl(line, playlistUrl);
    const index = segments.length;
    if (seenIndexes.has(index)) {
      continue;
    }
    seenIndexes.add(index);

    segments.push({
      index,
      url,
      uri: url,
      duration: pendingDuration,
      durationSeconds: pendingDuration,
      isInitSegment: false,
    });
    pendingDuration = null;

    if (segments.length > HLS_TRANSFER.maxSegments) {
      throw new DownloadEngineError(
        'HLS_UNSUPPORTED',
        'This HLS playlist has too many segments to download safely.',
      );
    }
  }

  if (segments.length === 0) {
    throw new DownloadEngineError(
      'INVALID_HLS_PLAYLIST',
      'HLS media playlist has no segments.',
    );
  }

  return {
    kind: 'media',
    playlistUrl,
    segments,
    initSegmentUrl,
    containerHint: sniffContainerHint(segments, initSegmentUrl),
  };
}

/**
 * Parse a playlist body. Does not fetch. Throws DownloadEngineError on reject.
 */
export function parseHlsPlaylist(
  content: string,
  playlistUrl: string,
): HlsResolvedPlaylist {
  if (!content || typeof content !== 'string') {
    throw new DownloadEngineError(
      'INVALID_HLS_PLAYLIST',
      'Empty HLS playlist.',
    );
  }

  const trimmed = stripBom(content).trim();
  if (!trimmed.startsWith('#EXTM3U')) {
    throw new DownloadEngineError(
      'INVALID_HLS_PLAYLIST',
      'Response is not a valid HLS playlist.',
    );
  }

  if (trimmed.length > HLS_TRANSFER.maxPlaylistBytes) {
    throw new DownloadEngineError(
      'INVALID_HLS_PLAYLIST',
      'HLS playlist exceeds the supported size.',
    );
  }

  const lines = trimmed.split(/\r?\n/);
  rejectUnsupportedConstructs(lines);

  const isMaster = lines.some((line) =>
    line.trim().startsWith('#EXT-X-STREAM-INF'),
  );
  const hasTargetDuration = lines.some((line) =>
    line.trim().startsWith('#EXT-X-TARGETDURATION'),
  );
  const hasEndList = lines.some((line) =>
    line.trim().startsWith('#EXT-X-ENDLIST'),
  );

  if (isMaster) {
    return parseMasterPlaylist(lines, playlistUrl);
  }

  if (!hasTargetDuration) {
    throw new DownloadEngineError(
      'INVALID_HLS_PLAYLIST',
      'Unrecognized HLS playlist structure.',
    );
  }

  return parseMediaPlaylist(lines, playlistUrl, hasEndList);
}

/**
 * Select a master variant. Prefer matching preferredUri when present;
 * otherwise highest bandwidth (existing product default). Does not invent tiers.
 */
export function selectHlsVariant(
  variants: HlsVariant[],
  preferredUri?: string | null,
): HlsVariant {
  if (variants.length === 0) {
    throw new DownloadEngineError(
      'INVALID_HLS_PLAYLIST',
      'No HLS variants available.',
    );
  }

  if (preferredUri) {
    const exact = variants.find(
      (v) => v.url === preferredUri || v.uri === preferredUri,
    );
    if (exact) {
      return exact;
    }
  }

  if (variants.length === 1) {
    return variants[0]!;
  }

  return variants.slice().sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0]!;
}

export function outputExtensionForHint(hint: 'ts' | 'fmp4'): string {
  return hint === 'fmp4' ? 'mp4' : 'ts';
}
